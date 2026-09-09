/**
 * Agent-owned QCC command bridge.
 *
 * DSH Code Mode only permits dynamic MCP calls as nested executions of an
 * Agent-owned tool call.  The Web workbench therefore stages rows under an
 * opaque command id, sends only that id through the visible conversation,
 * and lets this high-level tool perform the paid calls with exec.token.
 */
import { randomUUID } from 'node:crypto';
import { WorkflowError } from './workflow.js';
import { QccBridgeError } from './qcc.js';
import { fieldLabel, normalizeFieldSelection } from './workflow-contract.js';

export const TOOL_QCC_COMMAND = 'data_cleaning_qcc_run';

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_COMMANDS = 50;

function clone(value) {
  return structuredClone(value);
}

function safeError(error) {
  if (error instanceof QccBridgeError) return error.toJSON();
  if (error instanceof WorkflowError) return { code: error.code, message: error.message, retryable: false };
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
      workflowOwned: input.workflowOwned === true,
      workflowRevision: input.workflowRevision,
      rows: clone(rows),
      headers: Array.isArray(input.headers) ? input.headers.map(String) : [],
      nameField: String(input.nameField ?? 'name'),
      fieldSelection: normalizeFieldSelection(input.fieldSelection),
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
      workflowOwned: input.workflowOwned === true,
      workflowRevision: input.workflowRevision,
      companyName: requiredText(input.companyName, 'QCC_REVIEW_NOT_PENDING', 'A company name is required'),
      selectedCreditNo: requiredText(input.selectedCreditNo, 'QCC_CANDIDATE_INVALID', 'A selected credit number is required'),
    };
  }
  const companyNames = [...new Set((Array.isArray(input.companyNames) ? input.companyNames : [])
    .map((name) => String(name).trim()).filter(Boolean))];
  if (companyNames.length === 0) throw new QccBridgeError('QCC_RETRY_EMPTY', 'At least one failed company must be selected');
  return { kind, taskId, runId, companyNames, workflowOwned: input.workflowOwned === true, workflowRevision: input.workflowRevision };
}

export function serializeQccCommandPrompt(command) {
  const input = command.input ?? {};
  const action = command.kind === 'resolve'
    ? '确认并继续处理已选的企业主体'
    : command.kind === 'retry'
      ? '重试已选的可恢复失败项'
      : '执行企业主体匹配与字段补全';
  const rowCount = command.kind === 'enrich'
    ? (Array.isArray(input.rows) ? input.rows.length : 0)
    : command.kind === 'retry'
      ? (Array.isArray(input.companyNames) ? input.companyNames.length : 0)
      : 1;
  const fields = command.kind === 'enrich'
    ? normalizeFieldSelection(input.fieldSelection).map(fieldLabel)
    : [];
  return [
    '请执行已在「数据清洗补全工作台」确认的企业数据任务。',
    '',
    `处理内容：${action}。`,
    `任务编号：${command.taskId}。`,
    `处理数量：${rowCount} 条企业记录。`,
    ...(fields.length ? [`需要补全：${fields.join('、')}。`] : []),
    ...(command.estimate ? [`Host 调用估算：${command.estimate.uniqueCompanies} 家去重主体，最多 ${command.estimate.estimatedCalls} 次；本次调用上限 ${command.estimate.maxCalls} 次。`] : []),
    '执行边界：名单与字段范围已安全暂存在本机 Host。生成说明不会查询；发送本说明即确认按上述范围使用自己连接的企查查 MCP 账号及额度，额度或费用由该账号自行承担。',
    '',
    '你可以在发送前补充任务备注。如需修改名单、匹配规则或补全字段，请先返回工作台调整后重新生成。',
    `安全任务凭证：${command.commandId}`,
    '',
    `发送本说明后，请仅调用一次数据清洗补全执行工具（${TOOL_QCC_COMMAND}），参数只传递上述安全任务凭证。`,
    '完成后请在对话中列出工具返回的 XLSX 文件名、预览和下载链接；只使用实际返回的链接，不编造文件或要求源文件路径。',
    '不要要求重复粘贴企业名单，不要直接调用 mcp__qcc-* 工具，不要重试、扩大名单或追加字段。',
    input.workflowOwned
      ? '发送即执行已确认方案，不再询问额度或写回确认。Host 会自动生成新的清洗补全结果 XLSX，原始上传文件不修改。不要寻找源文件路径、运行 Bash、编写导出脚本或另行覆盖源文件。'
      : '这是兼容模式命令，返回工作台查看结果并导出。不要另行寻找或覆盖源文件；如需自动交付新 Excel，请在最新版工作台重新生成任务说明。',
    '高层工具返回后只汇报真实状态，并提示返回数据清洗补全工作台下载；主体多候选或真实授权异常才需要人工处理。',
  ].join('\n');
}

export class QccCommandStore {
  constructor({ bridge, runs, clock = () => Date.now(), ttlMs = DEFAULT_TTL_MS, maxCommands = DEFAULT_MAX_COMMANDS, lifecycle } = {}) {
    if (!bridge || !runs) throw new TypeError('QccCommandStore requires bridge and runs');
    this.bridge = bridge;
    this.runs = runs;
    this.clock = clock;
    this.ttlMs = ttlMs;
    this.maxCommands = maxCommands;
    this.commands = new Map();
    this.lifecycle = lifecycle;
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
    const estimate = normalized.kind === 'enrich'
      ? this.bridge.previewEnrichment(normalized.rows, normalized)
      : null;
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
      estimate,
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
      estimate: record.estimate,
      progress: record.progress ?? null,
      workflowOwned: record.input.workflowOwned === true,
      delivery: record.delivery ?? null,
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
    record.promise = Promise.resolve().then(() => this.lifecycle?.beforeRun(record))
      .then(() => this.execute(record, execution))
      .then(async (run) => {
        record.runId = run.runId;
        record.delivery = await this.lifecycle?.complete(record, run);
        record.state = 'completed';
        record.updatedAt = new Date(this.clock()).toISOString();
        record.touchedAtMs = this.clock();
        return this.toolResult(record, run);
      })
      .catch(async (error) => {
        try { await this.lifecycle?.failed(record, error); } catch { /* Preserve the original execution failure. */ }
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
    record.progress = { completedUnique: 0, totalUnique: record.estimate?.uniqueCompanies || 0 };
    const result = await this.bridge.enrichRows(record.input.rows, {
      nameField: record.input.nameField,
      includeRisk: record.input.includeRisk,
      fieldSelection: record.input.fieldSelection,
      concurrency: record.input.concurrency,
      maxRows: 100,
      execution,
      onAudit: (event) => audit.push(event),
      onProgress: (progress) => { record.progress = progress; },
    });
    return this.runs.createRun({
      headers: record.input.headers,
      nameField: record.input.nameField,
      includeRisk: record.input.includeRisk,
      fieldSelection: record.input.fieldSelection,
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
      ...(record.delivery ? { deliveryState: record.delivery.state, artifactCount: record.delivery.artifacts.length,
        artifacts: record.delivery.artifacts.filter(a => a.format === 'xlsx').map(a => ({ fileName: a.fileName, url: `/data-cleaning/api/workflow/tasks/${encodeURIComponent(record.taskId)}/artifacts/${encodeURIComponent(a.id)}` })) } : {}),
    });
  }
}

export function registerQccCommandTool(tools, commands) {
  return tools.register({
    name: TOOL_QCC_COMMAND,
    description: 'Execute one already-staged data-cleaning QCC command. Call only when a visible readable workbench task summary supplies a dcq-* commandId. The Host owns rows, billing confirmation, idempotency and result artifacts.',
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
          deliveryState: { type: 'string' },
          artifactCount: { type: 'integer' },
          artifacts: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { fileName: { type: 'string' }, url: { type: 'string' } }, required: ['fileName', 'url'] } },
          summary: {
            type: 'object',
            additionalProperties: false,
            properties: {
              totalRows: { type: 'integer' },
              uniqueCompanies: { type: 'integer' },
              enriched: { type: 'integer' },
              fieldReview: { type: 'integer' },
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
        text: `数据清洗补全：${value.summary?.enriched ?? 0}/${value.summary?.totalRows ?? 0} 条已补全。${value.artifactCount ? 'Host 已生成新的结果 XLSX，请返回工作台「结果下载」。源文件未修改，无需再次确认或提供路径。' : value.deliveryState === 'review_required' ? '存在多候选，请返回工作台确认主体。' : '请返回工作台查看任务状态。'}\n${(value.artifacts || []).map(a => `${String(a.fileName).replace(/[^a-zA-Z0-9\u4e00-\u9fff._ -]/g, '_')}：[预览 / 打开](${a.url}?preview=1) · [下载 Excel](${a.url})`).join('\n')}`,
      }],
    },
    async execute(args, exec) {
      return commands.run(args.commandId, exec);
    },
  });
}
