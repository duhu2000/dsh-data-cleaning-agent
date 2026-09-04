/**
 * Agent-owned QCC command bridge.
 *
 * DSH Code Mode only permits dynamic MCP calls as nested executions of an
 * Agent-owned tool call.  The Web workbench therefore stages rows under an
 * opaque command id, sends only that id through the visible conversation,
 * and lets this high-level tool perform the paid calls with exec.token.
 */
import { randomUUID } from 'node:crypto';
import { QccBridgeError } from './qcc.js';

export const TOOL_QCC_COMMAND = 'data_cleaning_qcc_run';

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_COMMANDS = 50;

function clone(value) {
  return structuredClone(value);
}

function safeError(error) {
  if (error instanceof QccBridgeError) return error.toJSON();
  return new QccBridgeError('QCC_COMMAND_FAILED', 'Data-cleaning QCC command failed', {
    retryable: false,
  }).toJSON();
}

function requiredText(value, code, message) {
  const text = String(value ?? '').trim();
  if (!text) throw new QccBridgeError(code, message);
  return text;
}

function normalizedInput(input = {}) {
  const kind = String(input.kind ?? 'enrich');
  if (!['enrich', 'resolve', 'retry'].includes(kind)) {
    throw new QccBridgeError('QCC_COMMAND_KIND_INVALID', 'Unsupported data-cleaning QCC command kind');
  }
  const taskId = requiredText(input.taskId, 'QCC_COMMAND_TASK_REQUIRED', 'A workflow taskId is required');
  if (kind === 'enrich') {
    const rows = Array.isArray(input.rows) ? input.rows : [];
    if (rows.length === 0) throw new QccBridgeError('QCC_INVALID_ROWS', 'At least one row is required');
    if (rows.length > 100) throw new QccBridgeError('QCC_BATCH_TOO_LARGE', 'QCC batch exceeds 100 rows');
    return {
      kind,
      taskId,
      rows: clone(rows),
      headers: Array.isArray(input.headers) ? input.headers.map(String) : [],
      nameField: String(input.nameField ?? 'name'),
      includeRisk: input.includeRisk === true,
      concurrency: Math.min(4, Math.max(1, Math.trunc(Number(input.concurrency ?? 2)))),
    };
  }
  const runId = requiredText(input.runId, 'QCC_RUN_NOT_FOUND', 'A G5 runId is required');
  if (kind === 'resolve') {
    return {
      kind,
      taskId,
      runId,
      companyName: requiredText(input.companyName, 'QCC_REVIEW_NOT_PENDING', 'A company name is required'),
      selectedCreditNo: requiredText(input.selectedCreditNo, 'QCC_CANDIDATE_INVALID', 'A selected credit number is required'),
    };
  }
  const companyNames = [...new Set((Array.isArray(input.companyNames) ? input.companyNames : [])
    .map((name) => String(name).trim()).filter(Boolean))];
  if (companyNames.length === 0) throw new QccBridgeError('QCC_RETRY_EMPTY', 'At least one failed company must be selected');
  return { kind, taskId, runId, companyNames };
}

export function serializeQccCommandPrompt(command) {
  const visible = {
    schemaVersion: 1,
    commandId: command.commandId,
    taskId: command.taskId,
    kind: command.kind,
  };
  return [
    '请执行数据清洗补全企查查任务。',
    '',
    '类型化任务意图（schemaVersion 1）：',
    '```json',
    JSON.stringify(visible, null, 2),
    '```',
    '',
    `请准确调用一次 ${TOOL_QCC_COMMAND} 并只传递 commandId。`,
    '企业名单和字段选择已安全暂存在本机 Host，不得要求用户在对话中重复粘贴，不得直接调用任何 mcp__qcc-* 工具。',
    '高层工具返回后立即结束本轮；不得重试、扩大名单或追加字段。',
  ].join('\n');
}

export class QccCommandStore {
  constructor({ bridge, runs, clock = () => Date.now(), ttlMs = DEFAULT_TTL_MS, maxCommands = DEFAULT_MAX_COMMANDS } = {}) {
    if (!bridge || !runs) throw new TypeError('QccCommandStore requires bridge and runs');
    this.bridge = bridge;
    this.runs = runs;
    this.clock = clock;
    this.ttlMs = ttlMs;
    this.maxCommands = maxCommands;
    this.commands = new Map();
  }

  cleanup(reserveSlot = false) {
    const cutoff = this.clock() - this.ttlMs;
    for (const [id, command] of this.commands) {
      if (command.state !== 'running' && command.touchedAtMs < cutoff) this.commands.delete(id);
    }
    const limit = reserveSlot ? this.maxCommands - 1 : this.maxCommands;
    while (this.commands.size > limit) {
      const removable = [...this.commands].find(([, command]) => command.state !== 'running');
      if (!removable) throw new QccBridgeError('QCC_COMMAND_CAPACITY', 'QCC command queue is full', { retryable: true });
      this.commands.delete(removable[0]);
    }
  }

  prepare(input) {
    this.cleanup(true);
    const normalized = normalizedInput(input);
    const commandId = `dcq-${randomUUID()}`;
    const at = new Date(this.clock()).toISOString();
    const record = {
      commandId,
      taskId: normalized.taskId,
      kind: normalized.kind,
      state: 'prepared',
      createdAt: at,
      updatedAt: at,
      touchedAtMs: this.clock(),
      input: normalized,
      runId: null,
      error: null,
      promise: null,
    };
    this.commands.set(commandId, record);
    return { ...this.publicRecord(record), prompt: serializeQccCommandPrompt(record) };
  }

  require(commandId) {
    this.cleanup();
    const record = this.commands.get(String(commandId ?? ''));
    if (!record) throw new QccBridgeError('QCC_COMMAND_NOT_FOUND', 'QCC command was not found or expired');
    record.touchedAtMs = this.clock();
    return record;
  }

  publicRecord(record) {
    return clone({
      commandId: record.commandId,
      taskId: record.taskId,
      kind: record.kind,
      state: record.state,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      runId: record.runId,
      error: record.error,
      expiresInMs: this.ttlMs,
    });
  }

  status(commandId) {
    const record = this.require(commandId);
    const output = this.publicRecord(record);
    if (record.runId) output.run = this.runs.get(record.runId);
    return output;
  }

  async run(commandId, execution) {
    const record = this.require(commandId);
    if (!execution?.agent || !execution?.token) {
      throw new QccBridgeError('QCC_AGENT_EXECUTION_REQUIRED', 'QCC commands require an Agent-owned DSH tool execution');
    }
    if (record.promise) return record.promise;
    record.state = 'running';
    record.updatedAt = new Date(this.clock()).toISOString();
    record.promise = this.execute(record, execution)
      .then((run) => {
        record.runId = run.runId;
        record.state = 'completed';
        record.updatedAt = new Date(this.clock()).toISOString();
        record.touchedAtMs = this.clock();
        return this.toolResult(record, run);
      })
      .catch((error) => {
        record.error = safeError(error);
        record.state = 'failed';
        record.updatedAt = new Date(this.clock()).toISOString();
        record.touchedAtMs = this.clock();
        throw error;
      });
    return record.promise;
  }

  async execute(record, execution) {
    const options = { execution };
    if (record.kind === 'resolve') {
      return this.runs.resolveCandidate(record.input.runId, record.input, this.bridge, options);
    }
    if (record.kind === 'retry') {
      return this.runs.retryCompanies(record.input.runId, record.input.companyNames, this.bridge, options);
    }
    const audit = [];
    const result = await this.bridge.enrichRows(record.input.rows, {
      nameField: record.input.nameField,
      includeRisk: record.input.includeRisk,
      concurrency: record.input.concurrency,
      maxRows: 100,
      execution,
      onAudit: (event) => audit.push(event),
    });
    return this.runs.createRun({
      headers: record.input.headers,
      nameField: record.input.nameField,
      includeRisk: record.input.includeRisk,
      concurrency: record.input.concurrency,
      result,
      audit,
    });
  }

  toolResult(record, run) {
    return clone({
      commandId: record.commandId,
      taskId: record.taskId,
      runId: run.runId,
      state: run.state,
      summary: run.summary,
    });
  }
}

export function registerQccCommandTool(tools, commands) {
  return tools.register({
    name: TOOL_QCC_COMMAND,
    description: 'Execute one already-staged data-cleaning QCC command. Call only when a visible typed intent supplies commandId. The Host owns rows, billing confirmation, idempotency and result artifacts.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { commandId: { type: 'string' } },
      required: ['commandId'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          commandId: { type: 'string' },
          taskId: { type: 'string' },
          runId: { type: 'string' },
          state: { type: 'string' },
          summary: {
            type: 'object',
            additionalProperties: false,
            properties: {
              totalRows: { type: 'integer' },
              uniqueCompanies: { type: 'integer' },
              enriched: { type: 'integer' },
              ambiguous: { type: 'integer' },
              unresolved: { type: 'integer' },
              failed: { type: 'integer' },
              missingName: { type: 'integer' },
              includeRisk: { type: 'boolean' },
            },
            required: ['totalRows', 'uniqueCompanies', 'enriched', 'ambiguous', 'unresolved', 'failed', 'missingName', 'includeRisk'],
          },
        },
        required: ['commandId', 'taskId', 'runId', 'state', 'summary'],
      },
      render: (_args, value) => [{
        type: 'text',
        text: `数据清洗补全企查查任务已完成：${value.summary?.enriched ?? 0}/${value.summary?.totalRows ?? 0} 条已补全，状态 ${value.state}。`,
      }],
    },
    async execute(args, exec) {
      return commands.run(args.commandId, exec);
    },
  });
}
