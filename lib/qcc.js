/**
 * G5 Host Bridge：通过 DSH 公共 ToolRuntime 程序化调用 QCC MCP 工具。
 *
 * 安全与兼容边界：
 * - 只允许 qcc_oauth_* 与 mcp__qcc-*__*；不能把它变成任意工具代理。
 * - 每次调用都重新 ctx.tools.get()，不缓存 ToolDefinition / mcp-client 内部对象。
 * - 原样转发 AbortSignal，统一超时、取消和 ToolRuntime isError 结果。
 * - 批量补全只在 Host/Web 内处理明细；模型仍只接收摘要。
 */

export const QCC_TOOL_NAMES = Object.freeze({
  oauthConnect: 'qcc_oauth_connect',
  oauthStatus: 'qcc_oauth_status',
  entityLookup: 'mcp__qcc-company__get_company_by_query',
  registration: 'mcp__qcc-company__get_company_registration_info',
  riskScan: 'mcp__qcc-risk__get_company_risk_scan',
});

const EXACT_MATCH = '唯一精确匹配';
const MULTI_MATCH = '多候选';
const NO_MATCH = '未匹配';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_TOOL_WAIT_MS = 1_500;
const DEFAULT_POLL_MS = 50;
const DEFAULT_MAX_ROWS = 100;
const MAX_CONCURRENCY = 4;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function textBlocks(content) {
  return Array.isArray(content)
    ? content.filter((block) => block?.type === 'text').map((block) => String(block.text ?? ''))
    : [];
}

function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** 把 MCP CallToolResult 或结构化输出归一为业务 JSON。 */
export function decodeQccToolValue(value) {
  if (value?.structuredContent !== undefined) return value.structuredContent;

  const texts = textBlocks(value?.content);
  if (texts.length === 1) {
    const parsed = tryJson(texts[0]);
    return parsed === undefined ? texts[0] : parsed;
  }
  if (texts.length > 1) {
    const parsed = texts.map(tryJson);
    return parsed.every((item) => item !== undefined) ? parsed : texts.join('\n');
  }

  return value;
}

function isAllowedQccTool(name) {
  return /^qcc_oauth_[a-z0-9_]+$/.test(name)
    || /^mcp__qcc-[a-z0-9-]+__[a-z0-9_]+$/.test(name);
}

function delay(ms, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('aborted'));
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal.reason ?? new Error('aborted'));
    };
    timer.unref?.();
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function linkedSignal(parent, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(parent?.reason ?? new Error('aborted'));
  if (parent?.aborted) onAbort();
  else parent?.addEventListener('abort', onAbort, { once: true });

  const timer = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? setTimeout(() => {
      timedOut = true;
      controller.abort(new Error(`QCC tool timed out after ${timeoutMs}ms`));
    }, timeoutMs)
    : null;
  timer?.unref?.();

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup() {
      if (timer) clearTimeout(timer);
      parent?.removeEventListener('abort', onAbort);
    },
  };
}

export class QccBridgeError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'QccBridgeError';
    this.code = code;
    this.toolName = options.toolName ?? null;
    this.upstreamCode = options.upstreamCode ?? null;
    this.retryable = Boolean(options.retryable);
    this.connectRequired = Boolean(options.connectRequired);
    this.details = options.details ?? null;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      toolName: this.toolName,
      upstreamCode: this.upstreamCode,
      retryable: this.retryable,
      connectRequired: this.connectRequired,
      details: this.details,
    };
  }
}

function normalizedFailure(result, toolName, state) {
  const upstreamCode = String(result?.error?.info?.code ?? '');
  if (state.timedOut()) {
    return new QccBridgeError('QCC_TIMEOUT', `QCC tool timed out: ${toolName}`, {
      toolName,
      upstreamCode: upstreamCode || null,
      retryable: true,
    });
  }
  if (state.parentSignal?.aborted || upstreamCode === 'ABORTED' || upstreamCode === 'ABORTED_BEFORE_DISPATCH') {
    return new QccBridgeError('QCC_ABORTED', `QCC tool call was cancelled: ${toolName}`, {
      toolName,
      upstreamCode: upstreamCode || null,
      retryable: false,
    });
  }
  const message = String(result?.error?.message ?? `QCC tool failed: ${toolName}`);
  return new QccBridgeError('QCC_TOOL_FAILED', message, {
    toolName,
    upstreamCode: upstreamCode || null,
    retryable: upstreamCode === 'UNKNOWN_TOOL' || upstreamCode === 'TOOL_TIMEOUT',
    connectRequired: upstreamCode === 'UNKNOWN_TOOL',
  });
}

function candidateView(candidate) {
  const item = isRecord(candidate) ? candidate : {};
  return {
    companyName: String(item.企业名称 ?? ''),
    creditNo: String(item.统一社会信用代码 ?? ''),
    establishDate: String(item.成立日期 ?? ''),
    legalRep: Array.isArray(item.法定代表人名称)
      ? item.法定代表人名称.map(String)
      : item.法定代表人名称 ? [String(item.法定代表人名称)] : [],
    status: String(item.状态 ?? ''),
  };
}

export function classifyEntityMatch(value) {
  if (!isRecord(value)) {
    throw new QccBridgeError('QCC_CONTRACT_MISMATCH', 'QCC entity lookup returned a non-object result');
  }
  const kind = String(value.匹配结果 ?? '');
  if (kind === EXACT_MATCH) {
    const entity = isRecord(value.企业信息) ? value.企业信息 : {};
    const companyName = String(entity.企业名称 ?? '').trim();
    const creditNo = String(entity.统一社会信用代码 ?? '').trim();
    if (!companyName && !creditNo) {
      throw new QccBridgeError('QCC_CONTRACT_MISMATCH', 'QCC exact match omitted entity identity');
    }
    return { status: 'exact', companyName, creditNo };
  }
  if (kind === MULTI_MATCH) {
    const candidates = Array.isArray(value.企业信息) ? value.企业信息.map(candidateView) : [];
    if (candidates.length === 0) {
      throw new QccBridgeError('QCC_CONTRACT_MISMATCH', 'QCC multi-match result omitted candidates');
    }
    return { status: 'ambiguous', candidates };
  }
  if (kind === NO_MATCH || value.无匹配项 !== undefined) return { status: 'unresolved' };
  throw new QccBridgeError('QCC_CONTRACT_MISMATCH', `Unknown QCC match result: ${kind || '(empty)'}`);
}

export function mapRegistrationFields(value, fallback = {}) {
  if (!isRecord(value)) {
    throw new QccBridgeError('QCC_CONTRACT_MISMATCH', 'QCC registration tool returned a non-object result');
  }
  if (value.无匹配项 !== undefined) {
    throw new QccBridgeError('QCC_ENTITY_NOT_FOUND', 'Locked QCC entity could not be resolved by registration tool');
  }
  return {
    credit_no: String(value.统一社会信用代码 ?? fallback.creditNo ?? ''),
    legal_rep: String(value.法定代表人 ?? value.负责人 ?? value.经营者 ?? ''),
    reg_capital: String(
      value.注册资本 ?? value.注册资金 ?? value.开办资金 ?? value.成员出资总额 ?? value.资金数额 ?? '',
    ),
    establish_date: String(value.成立日期 ?? ''),
    reg_status: String(value.登记状态 ?? value.执业状态 ?? value.证书状态 ?? ''),
    biz_status: String(value.经营状态 ?? ''),
  };
}

export function mapRiskTags(value) {
  if (!isRecord(value)) return '';
  const rows = Array.isArray(value.风险因子扫描) ? value.风险因子扫描 : [];
  return rows
    .filter((row) => Number(row?.条目数) > 0)
    .map((row) => `${String(row?.风险因子 ?? '')}:${String(row?.条目数 ?? '')}`)
    .filter((item) => !item.startsWith(':'))
    .join('；');
}

async function mapConcurrent(items, concurrency, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  const run = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return output;
}

export class QccHostBridge {
  constructor({
    tools,
    logger,
    callIdFactory,
    defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
    toolWaitMs = DEFAULT_TOOL_WAIT_MS,
    pollMs = DEFAULT_POLL_MS,
  }) {
    if (!tools || typeof tools.get !== 'function' || typeof tools.execute !== 'function') {
      throw new TypeError('QccHostBridge requires ctx.tools get/execute');
    }
    this.tools = tools;
    this.logger = logger ?? console;
    this.sequence = 0;
    this.callIdFactory = callIdFactory ?? ((name) => {
      this.sequence += 1;
      const suffix = name.split('__').at(-1)?.slice(0, 24) || 'oauth';
      return `dc-qcc-${Date.now()}-${this.sequence}-${suffix}`;
    });
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.toolWaitMs = toolWaitMs;
    this.pollMs = pollMs;
  }

  has(name) {
    try {
      return Boolean(this.tools.get(name));
    } catch {
      return false;
    }
  }

  capabilities() {
    const capabilities = {
      oauthConnect: this.has(QCC_TOOL_NAMES.oauthConnect),
      oauthStatus: this.has(QCC_TOOL_NAMES.oauthStatus),
      entityLookup: this.has(QCC_TOOL_NAMES.entityLookup),
      registration: this.has(QCC_TOOL_NAMES.registration),
      riskScan: this.has(QCC_TOOL_NAMES.riskScan),
    };
    const ready = capabilities.entityLookup && capabilities.registration;
    return {
      ...capabilities,
      ready,
      state: ready ? 'ready' : capabilities.oauthConnect || capabilities.oauthStatus
        ? 'not-connected-or-refreshing'
        : 'oauth-plugin-missing',
    };
  }

  async waitForTool(name, { signal, waitMs = this.toolWaitMs } = {}) {
    const deadline = Date.now() + Math.max(0, waitMs);
    do {
      if (signal?.aborted) throw signal.reason ?? new Error('aborted');
      try {
        const definition = this.tools.get(name);
        if (definition) return definition;
      } catch {
        // 动态 entry 更新窗口内 get 可能短暂失败，继续按预算等待。
      }
      if (Date.now() >= deadline) break;
      await delay(Math.min(this.pollMs, Math.max(1, deadline - Date.now())), signal);
    } while (Date.now() <= deadline);

    throw new QccBridgeError('QCC_TOOL_UNAVAILABLE', `QCC tool is unavailable: ${name}`, {
      toolName: name,
      retryable: true,
      connectRequired: name.startsWith('mcp__qcc-'),
    });
  }

  async call(name, args = {}, options = {}) {
    if (!isAllowedQccTool(name)) {
      throw new QccBridgeError('QCC_TOOL_NOT_ALLOWED', `Tool is outside the QCC bridge allowlist: ${name}`, {
        toolName: name,
      });
    }
    if (!isRecord(args)) throw new QccBridgeError('QCC_INVALID_ARGS', 'QCC tool arguments must be an object');

    const parentSignal = options.signal;
    const state = linkedSignal(parentSignal, options.timeoutMs ?? this.defaultTimeoutMs);
    let callId = null;
    let attempt = 0;
    try {
      while (attempt < 2) {
        attempt += 1;
        callId = this.callIdFactory(name);
        await this.waitForTool(name, { signal: state.signal, waitMs: options.waitForToolMs ?? this.toolWaitMs });
        const result = await this.tools.execute({
          name,
          callId,
          signal: state.signal,
          arguments: args,
        });
        if (result?.isError !== true) {
          return { callId, toolName: name, data: decodeQccToolValue(result?.value) };
        }
        const upstreamCode = String(result?.error?.info?.code ?? '');
        if (upstreamCode === 'UNKNOWN_TOOL' && attempt === 1 && !state.signal.aborted) {
          await delay(this.pollMs, state.signal);
          continue;
        }
        throw normalizedFailure(result, name, { ...state, parentSignal });
      }
      throw new QccBridgeError('QCC_TOOL_UNAVAILABLE', `QCC tool disappeared during refresh: ${name}`, {
        toolName: name,
        retryable: true,
        connectRequired: true,
      });
    } catch (error) {
      if (error instanceof QccBridgeError) throw error;
      if (state.timedOut()) {
        throw new QccBridgeError('QCC_TIMEOUT', `QCC tool timed out: ${name}`, {
          toolName: name,
          retryable: true,
          cause: error,
        });
      }
      if (parentSignal?.aborted || state.signal.aborted) {
        throw new QccBridgeError('QCC_ABORTED', `QCC tool call was cancelled: ${name}`, {
          toolName: name,
          cause: error,
        });
      }
      throw new QccBridgeError('QCC_RUNTIME_ERROR', `QCC tool runtime failed: ${name}`, {
        toolName: name,
        retryable: true,
        cause: error,
      });
    } finally {
      state.cleanup();
    }
  }

  async enrichCompany(companyName, options = {}) {
    const lookup = await this.call(
      QCC_TOOL_NAMES.entityLookup,
      { searchKey: companyName },
      options,
    );
    const match = classifyEntityMatch(lookup.data);
    if (match.status !== 'exact') return match;

    const lockedKey = match.creditNo || match.companyName;
    const registration = await this.call(
      QCC_TOOL_NAMES.registration,
      { searchKey: lockedKey },
      options,
    );
    const fields = mapRegistrationFields(registration.data, match);
    if (options.includeRisk) {
      const risk = await this.call(QCC_TOOL_NAMES.riskScan, { searchKey: lockedKey }, options);
      fields.risk_tags = mapRiskTags(risk.data);
    } else {
      fields.risk_tags = '';
    }
    return {
      status: 'enriched',
      companyName: match.companyName,
      fields,
    };
  }

  async enrichRows(rows, options = {}) {
    if (!Array.isArray(rows)) throw new QccBridgeError('QCC_INVALID_ROWS', 'rows must be an array');
    const maxRows = Math.max(1, Math.trunc(options.maxRows ?? DEFAULT_MAX_ROWS));
    if (rows.length > maxRows) {
      throw new QccBridgeError('QCC_BATCH_TOO_LARGE', `QCC batch exceeds ${maxRows} rows`, {
        details: { maxRows, receivedRows: rows.length },
      });
    }

    const requiredTools = [QCC_TOOL_NAMES.entityLookup, QCC_TOOL_NAMES.registration];
    if (options.includeRisk) requiredTools.push(QCC_TOOL_NAMES.riskScan);
    try {
      await Promise.all(requiredTools.map((name) => this.waitForTool(name, {
        signal: options.signal,
        waitMs: options.waitForToolMs ?? this.toolWaitMs,
      })));
    } catch (error) {
      if (options.signal?.aborted) throw new QccBridgeError('QCC_ABORTED', 'QCC batch was cancelled');
      const missingTools = requiredTools.filter((name) => !this.has(name));
      throw new QccBridgeError('QCC_NOT_CONNECTED', 'QCC MCP tools are not ready; connect QCC or wait for refresh', {
        connectRequired: true,
        retryable: true,
        details: { missingTools },
        cause: error,
      });
    }

    const nameField = String(options.nameField ?? 'name');
    const normalized = rows.map((row, index) => ({
      index,
      row: isRecord(row) ? { ...row } : {},
      companyName: String(isRecord(row) ? row[nameField] ?? '' : '').trim(),
    }));
    const names = [...new Set(normalized.map((item) => item.companyName).filter(Boolean))];
    const concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, Math.trunc(options.concurrency ?? 2)));
    let completedUnique = 0;

    const resolutions = await mapConcurrent(names, concurrency, async (companyName) => {
      if (options.signal?.aborted) throw new QccBridgeError('QCC_ABORTED', 'QCC batch was cancelled');
      let result;
      try {
        result = await this.enrichCompany(companyName, options);
      } catch (error) {
        if (options.signal?.aborted || error?.code === 'QCC_ABORTED') throw error;
        const normalizedError = error instanceof QccBridgeError
          ? error
          : new QccBridgeError('QCC_RUNTIME_ERROR', 'QCC enrichment failed', { cause: error, retryable: true });
        result = { status: 'failed', error: normalizedError.toJSON() };
      }
      completedUnique += 1;
      options.onProgress?.({ completedUnique, totalUnique: names.length });
      return [companyName, result];
    });
    const byName = new Map(resolutions);

    const outputRows = normalized.map(({ row, companyName }) => {
      if (!companyName) return { ...row, qcc_match_status: 'missing-name' };
      const result = byName.get(companyName);
      if (result?.status === 'enriched') {
        return {
          ...row,
          ...result.fields,
          qcc_match_status: 'enriched',
          qcc_source: 'qcc-mcp',
        };
      }
      return { ...row, qcc_match_status: result?.status ?? 'failed' };
    });

    const indexesFor = (name) => normalized.filter((item) => item.companyName === name).map((item) => item.index);
    const reviewQueue = resolutions
      .filter(([, result]) => result.status === 'ambiguous')
      .map(([companyName, result]) => ({ companyName, rowIndexes: indexesFor(companyName), candidates: result.candidates }));
    const errors = resolutions
      .filter(([, result]) => result.status === 'failed')
      .map(([companyName, result]) => ({ companyName, rowIndexes: indexesFor(companyName), error: result.error }));

    const summary = {
      totalRows: rows.length,
      uniqueCompanies: names.length,
      enriched: outputRows.filter((row) => row.qcc_match_status === 'enriched').length,
      ambiguous: outputRows.filter((row) => row.qcc_match_status === 'ambiguous').length,
      unresolved: outputRows.filter((row) => row.qcc_match_status === 'unresolved').length,
      failed: outputRows.filter((row) => row.qcc_match_status === 'failed').length,
      missingName: outputRows.filter((row) => row.qcc_match_status === 'missing-name').length,
      includeRisk: Boolean(options.includeRisk),
    };

    return { summary, rows: outputRows, reviewQueue, errors };
  }
}
