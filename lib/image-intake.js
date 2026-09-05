/**
 * 图片企业名单接入。
 *
 * Browser 只负责把用户明确选择/粘贴的图片暂存到 Host；真实文字识别由
 * Agent-owned 高层工具在当前会话执行上下文中调用企查查智能文档解析 MCP。
 * 本地图片必须走官方 qcc-document-mcp（file_path），远端 qcc-document 只接受
 * 公网 file_url，不能直接读取 Host 临时文件。图片使用 0600 临时文件，识别
 * 完成、失败、取消或 TTL 到期后立即删除；不会进入 storageDomain 或导出制品。
 */
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const TOOL_IMAGE_EXTRACT = 'data_cleaning_extract_image_companies';
export const IMAGE_PROVIDER_QCC_DOCUMENT_LOCAL = 'qcc-document-mcp';
export const QCC_DOCUMENT_REMOTE_PARSE = 'mcp__qcc-document__parse_document';
export const QCC_DOCUMENT_LOCAL_TOOL_PAIRS = Object.freeze([
  Object.freeze({
    parse: 'mcp__document__parse_document',
    result: 'mcp__document__get_parse_result',
  }),
  Object.freeze({
    parse: 'mcp__qcc-document-mcp__parse_document',
    result: 'mcp__qcc-document-mcp__get_parse_result',
  }),
  Object.freeze({
    parse: 'mcp__qcc-document-local__parse_document',
    result: 'mcp__qcc-document-local__get_parse_result',
  }),
  Object.freeze({
    parse: 'mcp__document-mcp__parse_document',
    result: 'mcp__document-mcp__get_parse_result',
  }),
]);

export const IMAGE_LIMITS = Object.freeze({
  maxBytes: 8 * 1024 * 1024,
  maxEntries: 100,
  ttlMs: 15 * 60 * 1000,
});

const IMAGE_ROOT = join(tmpdir(), 'dsh-data-cleaning-agent-images');

export class ImageIntakeError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = 'ImageIntakeError';
    this.code = code;
    this.status = status;
    Object.assign(this, details);
  }
}

function safeName(value) {
  return String(value ?? '企业名单图片')
    .replace(/[\u0000-\u001f\u007f/\\]/g, '_')
    .trim()
    .slice(0, 160) || '企业名单图片';
}

export function sniffImage(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return null;
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: 'image/png', extension: 'png' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mimeType: 'image/webp', extension: 'webp' };
  }
  return null;
}

function decodeImage(content) {
  const raw = String(content ?? '').replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
  if (!raw || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || raw.length % 4 === 1) {
    throw new ImageIntakeError('DC_IMAGE_BASE64', '图片内容不是有效的 Base64 数据。');
  }
  const bytes = Buffer.from(raw, 'base64');
  if (!bytes.length) throw new ImageIntakeError('DC_IMAGE_EMPTY', '图片内容为空。');
  if (bytes.length > IMAGE_LIMITS.maxBytes) {
    throw new ImageIntakeError('DC_IMAGE_TOO_LARGE', '图片不能超过 8 MiB。', 413);
  }
  const detected = sniffImage(bytes);
  if (!detected) {
    throw new ImageIntakeError('DC_IMAGE_TYPE', '仅支持真实 PNG、JPEG 或 WebP 图片。', 415);
  }
  return { bytes, ...detected };
}

function unwrapProviderValue(result) {
  if (result?.isError === true) {
    const message = result?.error?.message || result?.message || '图片识别 Provider 调用失败。';
    throw new ImageIntakeError('DC_IMAGE_PROVIDER_FAILED', String(message), 502);
  }
  let value = result?.value ?? result;
  if (value?.structuredContent !== undefined) value = value.structuredContent;
  if (value && Array.isArray(value.content)) {
    const text = value.content.filter((item) => item?.type === 'text').map((item) => item.text).join('\n');
    if (text) {
      try { value = JSON.parse(text); } catch { value = { ocr: { full_text: text } }; }
    }
  }
  return value;
}

export function providerText(result) {
  const value = unwrapProviderValue(result);
  const markdown = [
    ...(Array.isArray(value?.details) ? value.details : []),
    value,
  ].map((detail) => String(detail?.result_md ?? detail?.resultMd ?? '').trim()).filter(Boolean).join('\n');
  if (markdown) return markdown;
  const lines = Array.isArray(value?.ocr?.lines)
    ? value.ocr.lines.map((line) => String(line?.text ?? '').trim()).filter(Boolean)
    : [];
  const text = String(value?.ocr?.full_text ?? lines.join('\n') ?? '').trim();
  if (!text) {
    throw new ImageIntakeError('DC_IMAGE_NO_TEXT', '图片中未识别到可用文字，请换用更清晰的原图。', 422);
  }
  return text;
}

function providerEnvelope(result) {
  const value = unwrapProviderValue(result);
  if (typeof value === 'string') return { status: 'success', details: [{ result_md: value }] };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ImageIntakeError('DC_IMAGE_DOCUMENT_CONTRACT', '企查查智能文档解析返回了无法识别的结果。', 502);
  }
  return value;
}

function documentStatus(value) {
  const raw = String(value?.status ?? value?.state ?? '').trim().toLowerCase();
  if (['success', 'succeeded', 'completed', 'complete', 'done'].includes(raw)) return 'success';
  if (['failed', 'failure', 'error', 'cancelled', 'canceled'].includes(raw)) return 'failed';
  if (['processing', 'pending', 'queued', 'running', 'accepted', 'submitted'].includes(raw)) return 'processing';
  if (providerTextOrEmpty(value)) return 'success';
  return raw || 'processing';
}

function providerTextOrEmpty(value) {
  try { return providerText(value); } catch { return ''; }
}

function providerTaskId(value) {
  return String(value?.task_id ?? value?.taskId ?? '').trim();
}

function documentFailure(value) {
  const code = String(value?.error?.code ?? value?.code ?? '').trim();
  const auth = /(?:^|\D)(?:401|403)(?:\D|$)|AUTH|TOKEN|CREDENTIAL/i.test(`${code} ${value?.message ?? ''}`);
  if (auth) {
    return new ImageIntakeError(
      'DC_IMAGE_QCC_AUTH_REQUIRED',
      '企查查本地文档解析连接未授权或授权已失效，请配置 qcc-document-mcp 后重试。',
      401,
    );
  }
  return new ImageIntakeError(
    'DC_IMAGE_DOCUMENT_FAILED',
    code ? `企查查智能文档解析失败（错误码 ${code}），请检查图片后重试。` : '企查查智能文档解析失败，请检查图片后重试。',
    502,
  );
}

function delay(ms, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('aborted'));
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(signal.reason ?? new Error('aborted'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function definitionParameters(definition) {
  return definition?.parameters ?? definition?.schema?.parameters ?? definition?.inputSchema ?? null;
}

function supportsLocalPath(definition, name) {
  const parameters = definitionParameters(definition);
  if (parameters?.properties?.file_path) return true;
  // 官方 npm 服务的稳定 serverName；旧 DSH 投射可能不保留完整 input schema。
  return /(?:qcc-)?document-(?:mcp|local)__parse_document$/.test(String(name ?? ''));
}

const CREDIT_RE = /\b[0-9A-HJ-NPQRTUWXY]{18}\b/gi;
const COMPANY_END = '(?:有限责任公司|股份有限公司|集团有限公司|有限公司|集团公司|公司|普通合伙|有限合伙|合伙企业|个人独资企业|农民专业合作社|合作社|事务所|研究院|研究所|中心|商行|工厂|厂)';
const COMPANY_RE = new RegExp(`[\\p{Script=Han}A-Za-z0-9（）()·&＋+—\\-]{2,72}${COMPANY_END}`, 'gu');
const HEADER_RE = /^(?:序号|企业名称|公司名称|单位名称|统一社会信用代码|信用代码|注册号|名称|企业名单)$/i;

function cleanCell(value) {
  return String(value ?? '')
    .replace(/^\s*(?:[-•·●▪◦]|\d{1,4}[.)、：:]?)\s*/, '')
    .replace(/^(?:企业名称|公司名称|单位名称|统一社会信用代码|信用代码|注册号)\s*[:：]\s*/i, '')
    .replace(/[\s\u00a0]+/g, '')
    .trim();
}

/** 从 OCR 文本确定性提取一企一行的名称/信用代码，不推断不存在的主体。 */
export function extractCompanyEntries(text, maxEntries = IMAGE_LIMITS.maxEntries) {
  const entries = [];
  const seen = new Set();
  const push = (name, creditNo) => {
    const cleanName = cleanCell(name);
    const cleanCredit = String(creditNo ?? '').trim().toUpperCase();
    if (!cleanName && !cleanCredit) return;
    if (cleanName && HEADER_RE.test(cleanName)) return;
    const display = [cleanName, cleanCredit].filter(Boolean).join(' | ');
    const key = `${cleanName.toLowerCase()}|${cleanCredit}`;
    if (!seen.has(key) && entries.length < maxEntries) {
      seen.add(key);
      entries.push(display);
    }
  };

  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const credits = [...line.matchAll(CREDIT_RE)].map((match) => match[0].toUpperCase());
    const names = [];
    for (const cell of line.split(/\t|[|｜]|\s{2,}|[，,；;]/)) {
      const compact = cleanCell(cell);
      for (const match of compact.matchAll(COMPANY_RE)) names.push(match[0]);
    }
    if (!names.length) {
      const compact = cleanCell(line.replace(CREDIT_RE, ''));
      for (const match of compact.matchAll(COMPANY_RE)) names.push(match[0]);
    }
    if (names.length === 1 && credits.length === 1) push(names[0], credits[0]);
    else {
      for (const name of names) push(name, '');
      for (const credit of credits) push('', credit);
    }
    if (entries.length >= maxEntries) break;
  }
  return entries;
}

function publicRecord(record, now = Date.now()) {
  return structuredClone({
    commandId: record.commandId,
    state: record.state,
    fileName: record.fileName,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    provider: record.provider,
    parseTool: record.parseTool,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresInMs: Math.max(0, record.expiresAt - now),
    result: record.result,
    error: record.error,
  });
}

function safeFailure(error) {
  if (error instanceof ImageIntakeError && error.code !== 'DC_IMAGE_PROVIDER_FAILED') {
    return { code: error.code, message: error.message };
  }
  return {
    code: 'DC_IMAGE_PROVIDER_FAILED',
    message: '企查查智能文档解析当前不可用或配置无效。请连接本地 qcc-document-mcp，或改用文本/Excel 名单。',
  };
}

export class ImageIntakeStore {
  constructor({
    tools,
    clock = () => Date.now(),
    ttlMs = IMAGE_LIMITS.ttlMs,
    pollMs = 500,
    maxPolls = 60,
  } = {}) {
    if (!tools || typeof tools.get !== 'function' || typeof tools.execute !== 'function') {
      throw new TypeError('ImageIntakeStore requires ctx.tools get/execute');
    }
    this.tools = tools;
    this.clock = clock;
    this.ttlMs = ttlMs;
    this.pollMs = pollMs;
    this.maxPolls = maxPolls;
    this.records = new Map();
  }

  toolDefinition(name) {
    try { return this.tools.get(name); } catch { return undefined; }
  }

  providerDefinition(preferredParseTool) {
    const pairs = preferredParseTool
      ? [...QCC_DOCUMENT_LOCAL_TOOL_PAIRS].sort((left) => left.parse === preferredParseTool ? -1 : 1)
      : QCC_DOCUMENT_LOCAL_TOOL_PAIRS;
    for (const pair of pairs) {
      const parse = this.toolDefinition(pair.parse);
      const result = this.toolDefinition(pair.result);
      if (parse && result && supportsLocalPath(parse, parse.name ?? pair.parse)) {
        return {
          provider: IMAGE_PROVIDER_QCC_DOCUMENT_LOCAL,
          parse,
          result,
          parseName: parse.name ?? pair.parse,
          resultName: result.name ?? pair.result,
        };
      }
    }
    return null;
  }

  remoteDefinition() {
    const candidates = [
      QCC_DOCUMENT_REMOTE_PARSE,
      ...QCC_DOCUMENT_LOCAL_TOOL_PAIRS.map((pair) => pair.parse),
    ];
    for (const name of candidates) {
      const definition = this.toolDefinition(name);
      const parameters = definitionParameters(definition);
      if (definition && parameters?.properties?.file_url && !parameters?.properties?.file_path) {
        return definition;
      }
    }
    return this.toolDefinition(QCC_DOCUMENT_REMOTE_PARSE);
  }

  capabilities() {
    const definition = this.providerDefinition();
    return {
      ready: Boolean(definition),
      provider: definition?.provider ?? null,
      parseTool: definition?.parseName ?? null,
      resultTool: definition?.resultName ?? null,
      remoteUrlOnlyConnected: Boolean(this.remoteDefinition()),
      localFileConnectorRequired: !definition,
      nativeAttachmentUi: true,
      pasteAndDrop: true,
      formats: ['image/png', 'image/jpeg', 'image/webp'],
      limits: IMAGE_LIMITS,
      persistence: 'ephemeral-host-file',
      billing: 'current-user-qcc-document-account',
    };
  }

  scheduleExpiry(record) {
    if (record.timer) clearTimeout(record.timer);
    const delay = Math.max(1, Math.min(2_147_483_647, record.expiresAt - this.clock()));
    record.timer = setTimeout(() => {
      this.expire(record.commandId).catch(() => {});
    }, delay);
    record.timer.unref?.();
  }

  async expire(commandId) {
    const record = this.records.get(commandId);
    if (!record) return;
    if (record.state === 'running') {
      record.expiresAt = this.clock() + 60_000;
      this.scheduleExpiry(record);
      return;
    }
    if (record.timer) clearTimeout(record.timer);
    await this.removeFile(record);
    this.records.delete(commandId);
  }

  async cleanup() {
    const now = this.clock();
    for (const [id, record] of this.records) {
      if (record.expiresAt <= now && record.state !== 'running') {
        if (record.timer) clearTimeout(record.timer);
        await this.removeFile(record);
        this.records.delete(id);
      }
    }
  }

  async removeFile(record) {
    if (!record?.path) return;
    const path = record.path;
    record.path = null;
    try { await unlink(path); } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  async prepare(input = {}) {
    await this.cleanup();
    const provider = this.providerDefinition();
    if (!provider) {
      const remoteOnly = Boolean(this.remoteDefinition());
      throw new ImageIntakeError(
        remoteOnly ? 'DC_IMAGE_LOCAL_DOCUMENT_PROVIDER_REQUIRED' : 'DC_IMAGE_PROVIDER_UNAVAILABLE',
        remoteOnly
          ? '当前只连接了远端 qcc-document，它不能读取本地图片。请在 MCP 连接器中配置本地 qcc-document-mcp。'
          : '当前 DSH 没有可用的企查查本地文档解析连接。请配置 qcc-document-mcp，或改用文本/Excel 名单。',
        503,
      );
    }
    const decoded = decodeImage(input.content);
    const commandId = `dci-${randomUUID()}`;
    const at = new Date(this.clock()).toISOString();
    await mkdir(IMAGE_ROOT, { recursive: true, mode: 0o700 });
    const path = join(IMAGE_ROOT, `${commandId}.${decoded.extension}`);
    await writeFile(path, decoded.bytes, { mode: 0o600, flag: 'wx' });
    const record = {
      commandId,
      state: 'prepared',
      fileName: safeName(input.fileName),
      mimeType: decoded.mimeType,
      sizeBytes: decoded.bytes.length,
      provider: provider.provider,
      parseTool: provider.parseName,
      resultTool: provider.resultName,
      path,
      createdAt: at,
      updatedAt: at,
      expiresAt: this.clock() + this.ttlMs,
      result: null,
      error: null,
      promise: null,
      timer: null,
    };
    this.records.set(commandId, record);
    this.scheduleExpiry(record);
    return publicRecord(record, this.clock());
  }

  require(commandId) {
    const record = this.records.get(String(commandId ?? ''));
    if (!record || (record.expiresAt <= this.clock() && record.state !== 'running')) {
      if (record && record.state !== 'running') this.expire(record.commandId).catch(() => {});
      throw new ImageIntakeError('DC_IMAGE_COMMAND_NOT_FOUND', '图片识别任务不存在或已过期。', 404);
    }
    return record;
  }

  status(commandId) {
    return publicRecord(this.require(commandId), this.clock());
  }

  async run(commandId, exec) {
    const record = this.require(commandId);
    if (!exec?.agent || !exec?.token) {
      throw new ImageIntakeError('DC_IMAGE_AGENT_EXECUTION_REQUIRED', '图片识别必须由当前 DSH Agent 会话执行。', 409);
    }
    if (record.promise) return record.promise;
    if (record.state === 'completed') return { commandId, ...record.result };
    const provider = this.providerDefinition(record.parseTool);
    if (!provider) {
      throw new ImageIntakeError('DC_IMAGE_PROVIDER_UNAVAILABLE', '企查查本地文档解析连接已离线。', 503);
    }
    record.state = 'running';
    record.updatedAt = new Date(this.clock()).toISOString();
    const execute = (name, args) => this.tools.execute({
      name,
      callId: `dc-image-${randomUUID()}`,
      rootCallId: exec.rootCallId,
      parent: exec.token,
      agent: exec.agent,
      signal: exec.signal,
      arguments: args,
    });
    record.promise = execute(provider.parseName, {
      file_path: record.path,
      wait: true,
    }).then(async (parseResult) => {
      let envelope = providerEnvelope(parseResult);
      let status = documentStatus(envelope);
      const taskId = providerTaskId(envelope);
      for (let poll = 0; status === 'processing' && poll < this.maxPolls; poll += 1) {
        if (!taskId) {
          throw new ImageIntakeError('DC_IMAGE_DOCUMENT_CONTRACT', '企查查文档解析未返回 task_id。', 502);
        }
        await delay(this.pollMs, exec.signal);
        envelope = providerEnvelope(await execute(provider.resultName, { task_id: taskId }));
        status = documentStatus(envelope);
      }
      if (status === 'processing') {
        throw new ImageIntakeError('DC_IMAGE_DOCUMENT_TIMEOUT', '企查查文档解析仍在处理中，请稍后重新识别。', 504);
      }
      if (status === 'failed') throw documentFailure(envelope);
      const text = providerText(envelope);
      const entries = extractCompanyEntries(text);
      if (!entries.length) {
        throw new ImageIntakeError('DC_IMAGE_NO_COMPANY', '图片文字已识别，但未提取到企业全称或 18 位统一社会信用代码。', 422);
      }
      record.result = {
        entries,
        entryCount: entries.length,
        truncated: entries.length >= IMAGE_LIMITS.maxEntries,
      };
      record.state = 'completed';
      record.error = null;
      record.updatedAt = new Date(this.clock()).toISOString();
      await this.removeFile(record);
      return { commandId, ...structuredClone(record.result) };
    }).catch(async (error) => {
      record.state = 'failed';
      const failure = safeFailure(error);
      record.error = failure;
      record.updatedAt = new Date(this.clock()).toISOString();
      await this.removeFile(record);
      throw new ImageIntakeError(failure.code, failure.message, 502);
    });
    return record.promise;
  }

  async remove(commandId) {
    const record = this.records.get(String(commandId ?? ''));
    if (!record) return false;
    if (record.state === 'running') {
      throw new ImageIntakeError('DC_IMAGE_OPERATION_IN_PROGRESS', '图片正在识别，暂不能移除。', 409);
    }
    if (record.timer) clearTimeout(record.timer);
    await this.removeFile(record);
    this.records.delete(record.commandId);
    return true;
  }

  async dispose() {
    for (const record of this.records.values()) if (record.timer) clearTimeout(record.timer);
    await Promise.all([...this.records.values()].map((record) => this.removeFile(record).catch(() => {})));
    this.records.clear();
  }
}

export function serializeImageExtractionPrompt(command) {
  return [
    '请使用企查查智能文档解析识别我刚刚在向导中安全暂存的企业名单图片，并把结果交回数据清洗补全工作台供我逐条核验。',
    '',
    `图片文件：${command.fileName}。`,
    '识别目标：逐行提取企业全称、18 位统一社会信用代码或注册号；不得猜测模糊字符。',
    '本步骤会使用当前用户自己连接的企查查 qcc-document-mcp；文档解析额度或费用由该账号自行承担。',
    `安全图片凭证：${command.commandId}`,
    '',
    `发送本说明后，请仅调用一次图片名单识别工具（${TOOL_IMAGE_EXTRACT}），参数只传递上述安全图片凭证。`,
    '高层工具会在 Host 内准确调用一次 parse_document，并只在异步处理中查询 get_parse_result；不要绕过高层工具直接调用任何 mcp__qcc-* 工具。',
  ].join('\n');
}

export function registerImageIntakeTool(tools, store) {
  return tools.register({
    name: TOOL_IMAGE_EXTRACT,
    description: 'Parse one already-staged local company-list image through QCC qcc-document-mcp. Call only when a visible data-cleaning prompt supplies a dci-* commandId. The Host owns the temporary image, calls parse_document once, and polls get_parse_result only while the returned task is processing.',
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
          entries: { type: 'array', items: { type: 'string' } },
          entryCount: { type: 'integer' },
          truncated: { type: 'boolean' },
        },
        required: ['commandId', 'entries', 'entryCount', 'truncated'],
      },
      render: (_args, value) => [{
        type: 'text',
        text: `企查查智能文档解析已识别图片企业名单：${value.entryCount} 条，已同步回数据清洗补全工作台等待核验。`,
      }],
    },
    async execute(args, exec) {
      return store.run(args.commandId, exec);
    },
  });
}
