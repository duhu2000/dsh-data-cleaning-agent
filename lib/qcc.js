/**
 * G5 Host Bridge：通过 DSH 公共 ToolRuntime 程序化调用 QCC MCP 工具。
 *
 * 安全与兼容边界：
 * - 只允许 qcc_oauth_* 与 mcp__qcc-*__*；不能把它变成任意工具代理。
 * - 每次调用都重新 ctx.tools.get()，不缓存 ToolDefinition / mcp-client 内部对象。
 * - 原样转发 AbortSignal，统一超时、取消和 ToolRuntime isError 结果。
 * - 批量补全只在 Host/Web 内处理明细；模型仍只接收摘要。
 */
import { safeAuditEvent } from './qcc-safety.js';
import {
  QCC_PHASE2_COMPANY_TOOLS,
  QCC_PHASE2_HISTORY_TOOLS,
  qccToolRuntimeCandidates,
} from './qcc-phase2.js';
import {
  QCC_PHASE3_ALL_CANONICAL_TOOLS,
  QCC_PHASE3_DOMAIN_META,
  QCC_PHASE3_TOOL_NAMES,
} from './qcc-phase3.js';
import {
  RELATED_RISK_FACTORS,
  RELATED_RISK_KEY_FACTORS,
  RISK_FACTOR_CATALOG_VERSION,
  SELF_RISK_FACTORS,
  selectedSourceTools,
} from './qcc-field-catalog.js';

export const QCC_TOOL_NAMES = Object.freeze({
  oauthConnect: 'qcc_oauth_connect',
  oauthStatus: 'qcc_oauth_status',
  entityLookup: 'mcp__qcc-company__get_company_by_query',
  registration: 'mcp__qcc-company__get_company_registration_info',
  profile: 'mcp__qcc-company__get_company_profile',
  contact: 'mcp__qcc-company__get_contact_info',
  listing: 'mcp__qcc-company__get_listing_info',
  taxInvoice: 'mcp__qcc-company__get_tax_invoice_info',
  importExportCredit: 'mcp__qcc-operation__get_import_export_credit',
  riskScan: 'mcp__qcc-risk__get_company_risk_scan',
  relatedRiskScan: 'mcp__qcc-risk__get_company_related_risk_scan',
});

const EXACT_MATCH = '唯一精确匹配';
const MULTI_MATCH = '多候选';
const NO_MATCH = '未匹配';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_TOOL_WAIT_MS = 1_500;
const DEFAULT_POLL_MS = 50;
const DEFAULT_MAX_ROWS = 100;
const DEFAULT_MAX_CALLS = 300;
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
    || /^mcp__qcc-[a-z0-9-]+__[a-z0-9_]+$/.test(name)
    || /^mcp__(?:company|risk|ipr|operation|history|executive)__[a-z0-9_]+$/.test(name);
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
    // 该 Promise 被业务流程显式 await，定时器必须保持事件循环存活。
    // Node 22 下 unref 会让程序在重注册等待期间提前退出。
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

function messageFailureCode(message) {
  const text = String(message ?? '').trim();
  if (!text) return '';
  const cases = [
    [/only\s+[`'\"]?run_code|requires task-based execution|direct(?:ly)?[^.]{0,48}(?:not allowed|not callable|denied)/i, 'DSH_EXECUTION_DENIED'],
    [/(?:^|\D)401(?:\D|$)|unauthori[sz]ed|auth(?:entication|orization)? required|invalid token|token expired/i, '401'],
    [/(?:^|\D)403(?:\D|$)|forbidden|permission denied|resource not authorized/i, '403'],
    [/(?:^|\D)429(?:\D|$)|rate[ -]?limit|too many requests/i, '429'],
    [/quota[^.]{0,32}(?:exhausted|insufficient|limit)|insufficient quota/i, 'QUOTA_EXHAUSTED'],
    [/unknown tool|tool unavailable|method not found|mcp error\s*-32601/i, 'UNKNOWN_TOOL'],
    [/timed?\s*out|deadline exceeded/i, 'TIMEOUT'],
    [/mcp error\s*-32602|invalid (?:argument|parameter)|validation error|bad request/i, 'INVALID_ARGUMENT'],
    [/(?:^|\D)5\d\d(?:\D|$)|service unavailable|upstream unavailable|connection (?:error|failed)/i, 'UPSTREAM_UNAVAILABLE'],
  ];
  return cases.find(([pattern]) => pattern.test(text))?.[1] ?? 'UNCLASSIFIED_TOOL_ERROR';
}

function upstreamFailureCode(result) {
  const structured = String(
    result?.error?.info?.code
      ?? result?.error?.info?.status
      ?? result?.error?.info?.httpStatus
      ?? '',
  ).trim().toUpperCase();
  return structured || messageFailureCode(result?.error?.message);
}

function failureDetails(result) {
  const retryAfter = Number(result?.error?.info?.retryAfterMs ?? result?.error?.info?.retry_after_ms);
  return Number.isFinite(retryAfter) && retryAfter >= 0 ? { retryAfterMs: retryAfter } : null;
}

function normalizedFailure(result, toolName, state) {
  const upstreamCode = upstreamFailureCode(result);
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
  if (/^(?:401|UNAUTHORIZED|AUTH_REQUIRED|INVALID_TOKEN|TOKEN_EXPIRED)$/.test(upstreamCode)) {
    return new QccBridgeError('QCC_AUTH_REQUIRED', 'QCC authorization is missing or expired; reconnect before retrying', {
      toolName,
      upstreamCode,
      retryable: true,
      connectRequired: true,
    });
  }
  if (/^(?:403|FORBIDDEN|PERMISSION_DENIED|RESOURCE_NOT_AUTHORIZED)$/.test(upstreamCode)) {
    return new QccBridgeError('QCC_PERMISSION_DENIED', 'The connected QCC account is not authorized for this resource', {
      toolName,
      upstreamCode,
    });
  }
  if (/^(?:429|RATE_LIMITED|TOO_MANY_REQUESTS)$/.test(upstreamCode)) {
    return new QccBridgeError('QCC_RATE_LIMITED', 'QCC rate limit reached; retry manually after the indicated delay', {
      toolName,
      upstreamCode,
      retryable: true,
      details: failureDetails(result),
    });
  }
  if (/^(?:QUOTA_EXHAUSTED|INSUFFICIENT_QUOTA|QUOTA_LIMIT)$/.test(upstreamCode)) {
    return new QccBridgeError('QCC_QUOTA_EXHAUSTED', 'QCC quota is exhausted; increase quota before retrying', {
      toolName,
      upstreamCode,
    });
  }
  if (/^(?:TOOL_TIMEOUT|TIMEOUT|DEADLINE_EXCEEDED)$/.test(upstreamCode)) {
    return new QccBridgeError('QCC_TIMEOUT', `QCC tool timed out: ${toolName}`, {
      toolName,
      upstreamCode,
      retryable: true,
    });
  }
  if (/^(?:UNKNOWN_TOOL|TOOL_UNAVAILABLE)$/.test(upstreamCode)) {
    return new QccBridgeError('QCC_TOOL_UNAVAILABLE', 'QCC tool disappeared during OAuth refresh; retry manually when ready', {
      toolName,
      upstreamCode,
      retryable: true,
      connectRequired: true,
    });
  }
  if (upstreamCode === 'DSH_EXECUTION_DENIED') {
    return new QccBridgeError('QCC_EXECUTION_DENIED', 'DSH denied this programmatic QCC tool execution', {
      toolName,
      upstreamCode,
      retryable: false,
    });
  }
  if (/^(?:5\d\d|SERVICE_UNAVAILABLE|UPSTREAM_UNAVAILABLE|CONNECTION_ERROR)$/.test(upstreamCode)) {
    return new QccBridgeError('QCC_UPSTREAM_UNAVAILABLE', 'QCC upstream service is temporarily unavailable', {
      toolName,
      upstreamCode,
      retryable: true,
    });
  }
  if (/^(?:400|BAD_REQUEST|INVALID_ARGUMENT|VALIDATION_ERROR)$/.test(upstreamCode)) {
    return new QccBridgeError('QCC_UPSTREAM_REJECTED', 'QCC rejected the tool request contract', {
      toolName,
      upstreamCode,
    });
  }
  return new QccBridgeError('QCC_TOOL_FAILED', `QCC tool failed: ${toolName}`, {
    toolName,
    upstreamCode: upstreamCode || null,
    retryable: false,
  });
}

function emitAudit(options, event) {
  try {
    options?.onAudit?.(safeAuditEvent(event));
  } catch {
    // 审计 sink 失败不能改变计费工具调用的业务结果。
  }
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
  const text = (...keys) => {
    for (const key of keys) {
      const item = value[key];
      if (item !== undefined && item !== null && String(item).trim()) return String(item);
    }
    return '';
  };
  return {
    company_name: text('企业名称') || String(fallback.companyName ?? ''),
    credit_no: text('统一社会信用代码', '信用代码') || String(fallback.creditNo ?? ''),
    reg_no: text('工商注册号', '注册号'),
    org_no: text('组织机构代码'),
    tax_no: text('纳税人识别号'),
    reg_status: text('登记状态', '执业状态', '证书状态'),
    legal_rep: text('法定代表人', '负责人', '经营者'),
    reg_capital: text('注册资本', '注册资金', '开办资金', '成员出资总额', '资金数额'),
    paid_capital: text('实缴资本'),
    establish_date: text('成立日期'),
    company_type: text('企业类型', '公司类型'),
    approval_date: text('核准日期'),
    registration_authority: text('登记机关'),
    taxpayer_qualification: text('纳税人资质'),
    payment_line_no: text('支付系统行号'),
    import_export_company_code: text('进出口企业代码'),
    short_name: text('企业简称'),
    english_name: text('英文名', '英文名称'),
    registered_address: text('注册地址', '住所', '经营场所'),
    mailing_address: text('通信地址'),
    region: text('所属地区'),
    business_scope: text('经营范围'),
    industry_category: text('国标行业'),
    operating_period: text('营业期限', '经营期限'),
    company_size: text('人员规模'),
    insured_count: text('参保人数'),
    branch_insured_count: text('分支机构参保人数'),
  };
}

export function mapProfileFields(value) {
  if (!isRecord(value)) {
    throw new QccBridgeError('QCC_CONTRACT_MISMATCH', 'QCC profile tool returned a non-object result');
  }
  if (value.无匹配项 !== undefined) return {};
  return {
    // 工具只返回“企查查行业”这一最细层级展示值，不得猜测为一级或二级行业。
    qcc_industry: String(value.企查查行业 ?? ''),
    company_profile: String(value.企业简介 ?? value.简介 ?? ''),
    industry_chain_overview: String(value.产业链概览 ?? ''),
  };
}

function scalarText(value, ...keys) {
  if (!isRecord(value)) return '';
  for (const key of keys) {
    const item = value[key];
    if (item !== undefined && item !== null && String(item).trim()) return String(item);
  }
  return '';
}

function scalarMap(value, mapping) {
  if (!isRecord(value) || value.无匹配项 !== undefined || value.地域限制 !== undefined) return {};
  return Object.fromEntries(mapping.map(([id, ...keys]) => [id, scalarText(value, ...keys)]));
}

export function mapContactFields(value) {
  if (!isRecord(value)) return {};
  const contact = isRecord(value.联系方式信息) ? value.联系方式信息 : {};
  const phone = Array.isArray(contact.电话) && isRecord(contact.电话[0]) ? contact.电话[0] : {};
  const email = Array.isArray(contact.邮箱) && isRecord(contact.邮箱[0]) ? contact.邮箱[0] : {};
  const website = Array.isArray(contact.网址)
    ? contact.网址.find((item) => isRecord(item) && item.是否是官网 === '是') ?? {}
    : {};
  return {
    contact_preferred_phone: scalarText(phone, '电话号码'),
    contact_phone_invalid_flag: scalarText(phone, '是否无效'),
    contact_phone_tags: Array.isArray(phone.标签)
      ? phone.标签.map((item) => String(item).trim()).filter(Boolean).join('；')
      : '',
    contact_preferred_email: scalarText(email, '邮箱'),
    contact_official_website: scalarText(website, '网址'),
    contact_official_website_icp: scalarText(website, 'ICP备案'),
  };
}

export function mapListingFields(value) {
  return scalarMap(value, [
    ['listing_date', '上市日期'],
    ['listing_short_name', '股票简称'],
    ['listing_stock_code', '股票代码'],
    ['listing_exchange', '上市交易所'],
    ['listing_board', '上市板块'],
    ['listing_former_short_name', '上市曾用名'],
    ['listing_total_market_value', '总市值'],
    ['listing_total_shares', '总股本'],
    ['listing_predicted_pe', '预测市盈率'],
    ['listing_float_market_value', '流通值'],
    ['listing_float_shares', '流通股'],
    ['listing_pb_ratio', '市净率'],
    ['listing_eps', 'EPS'],
    ['listing_voting_rights_difference', '表决权差异'],
    ['listing_registration_based', '是否注册制'],
  ]);
}

export function mapTaxInvoiceFields(value) {
  return scalarMap(value, [
    ['tax_company_name', '企业名称'],
    ['tax_identification_no', '纳税人识别号'],
    ['tax_company_type', '企业类型'],
    ['tax_business_status', '经营状态'],
    ['invoice_address', '地址'],
    ['invoice_phone', '联系电话'],
    ['invoice_bank', '开户行'],
    ['invoice_bank_account', '开户行账号'],
  ]);
}

export function mapImportExportCreditFields(value) {
  return scalarMap(value, [
    ['import_export_credit_no', '统一社会信用代码'],
    ['import_export_customs', '所在地海关'],
    ['import_export_admin_division', '行政区划'],
    ['import_export_address', '地址'],
    ['import_export_economic_area', '经济区划'],
    ['import_export_trade_type', '经营类别'],
    ['import_export_statistical_economic_area', '统计经济区划'],
    ['import_export_industry', '行业种类'],
    ['import_export_ecommerce_type', '跨境贸易电子商务类型'],
    ['import_export_credit_grade', '信用等级'],
    ['import_export_filing_date', '备案日期'],
  ]);
}

function countValue(value) {
  if (value === '' || value === null || value === undefined) return '';
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : '';
}

function selfRiskRows(value) {
  return Array.isArray(value?.风险因子扫描) ? value.风险因子扫描.filter(isRecord) : [];
}

export function inspectSelfRiskCatalog(value) {
  const applicable = Array.isArray(value?.风险因子扫描);
  const actual = new Set(selfRiskRows(value).map((row) => String(row.风险因子 ?? '').trim()).filter(Boolean));
  const expected = new Set(SELF_RISK_FACTORS.map(([, label]) => label));
  return {
    applicable,
    version: RISK_FACTOR_CATALOG_VERSION,
    missing: [...expected].filter((label) => !actual.has(label)),
    unknown: [...actual].filter((label) => !expected.has(label)),
  };
}

export function mapCompanyRiskScanFields(value) {
  if (!isRecord(value) || !Array.isArray(value.风险因子扫描)) return {};
  const counts = new Map(selfRiskRows(value).map((row) => [String(row.风险因子 ?? '').trim(), countValue(row.条目数)]));
  const hits = SELF_RISK_FACTORS.flatMap(([, label]) => {
    const count = counts.get(label);
    return typeof count === 'number' && count > 0 ? [`${label}(${count})`] : [];
  });
  return {
    risk_recorded_factor_count: countValue(value.有记录因子数),
    risk_no_record_factor_count: countValue(value.无记录因子数),
    risk_hit_summary: hits.join('；'),
    ...Object.fromEntries(SELF_RISK_FACTORS.map(([id, label]) => [`risk_${id}_count`, counts.get(label) ?? ''])),
  };
}

export function inspectRelatedRiskCatalog(value) {
  const applicable = isRecord(value?.维度计数汇总);
  // QCC MCP 当前契约名为“重要风险”；“关键风险”仅作早期预发环境兼容，
  // 不得反向把兼容名称当成稳定上游契约。
  const importantSource = value?.维度计数汇总?.重要风险 ?? value?.维度计数汇总?.关键风险;
  const important = isRecord(importantSource) ? importantSource : {};
  const locating = Array.isArray(value?.重点维度关联方定位) ? value.重点维度关联方定位.filter(isRecord) : [];
  const importantActual = new Set(Object.keys(important));
  const keyActual = new Set(locating.map((row) => String(row.维度 ?? '').trim()).filter(Boolean));
  const importantExpected = new Set(RELATED_RISK_FACTORS.map(([, label]) => label));
  const keyExpected = new Set(RELATED_RISK_KEY_FACTORS.map(([, label]) => label));
  return {
    applicable,
    version: RISK_FACTOR_CATALOG_VERSION,
    missing: [
      ...[...importantExpected].filter((label) => !importantActual.has(label)).map((label) => `重要风险:${label}`),
      ...[...keyExpected].filter((label) => !keyActual.has(label)).map((label) => `重点维度:${label}`),
    ],
    unknown: [
      ...[...importantActual].filter((label) => !importantExpected.has(label)).map((label) => `重要风险:${label}`),
      ...[...keyActual].filter((label) => !keyExpected.has(label)).map((label) => `重点维度:${label}`),
    ],
  };
}

export function mapCompanyRelatedRiskScanFields(value) {
  if (!isRecord(value) || !isRecord(value.维度计数汇总)) return {};
  const importantSource = value.维度计数汇总.重要风险 ?? value.维度计数汇总.关键风险;
  const important = isRecord(importantSource) ? importantSource : {};
  const locating = Array.isArray(value.重点维度关联方定位) ? value.重点维度关联方定位.filter(isRecord) : [];
  const partyCounts = new Map(locating.map((row) => [String(row.维度 ?? '').trim(), countValue(row.命中关联方数)]));
  const hits = RELATED_RISK_FACTORS.flatMap(([, label]) => {
    const count = countValue(important[label]);
    return typeof count === 'number' && count > 0 ? [`${label}(${count})`] : [];
  });
  const partyCount = countValue(value.有风险关联方数);
  return {
    related_risk_party_count: partyCount,
    related_risk_summary: `${partyCount === '' ? '' : `有风险关联方${partyCount}个`}${hits.length ? `${partyCount === '' ? '' : '；'}${hits.join('；')}` : ''}`,
    ...Object.fromEntries(RELATED_RISK_FACTORS.map(([id, label]) => [`related_risk_${id}_count`, countValue(important[label])])),
    ...Object.fromEntries(RELATED_RISK_KEY_FACTORS.map(([id, label]) => [`related_risk_${id}_party_count`, partyCounts.get(label) ?? ''])),
  };
}

const LEGACY_ENRICHMENT_FIELDS = Object.freeze([
  'credit_no', 'legal_rep', 'reg_capital', 'establish_date', 'reg_status',
]);
const SOURCE_TOOL_CONFIG = Object.freeze({
  get_company_registration_info: Object.freeze({ name: QCC_TOOL_NAMES.registration, map: mapRegistrationFields }),
  get_company_profile: Object.freeze({ name: QCC_TOOL_NAMES.profile, map: mapProfileFields }),
  get_contact_info: Object.freeze({ name: QCC_TOOL_NAMES.contact, map: mapContactFields, args: { excludeInvalidPhone: false } }),
  get_listing_info: Object.freeze({ name: QCC_TOOL_NAMES.listing, map: mapListingFields }),
  get_tax_invoice_info: Object.freeze({ name: QCC_TOOL_NAMES.taxInvoice, map: mapTaxInvoiceFields }),
  get_import_export_credit: Object.freeze({ name: QCC_TOOL_NAMES.importExportCredit, map: mapImportExportCreditFields }),
  get_company_risk_scan: Object.freeze({ name: QCC_TOOL_NAMES.riskScan, map: mapCompanyRiskScanFields, inspect: inspectSelfRiskCatalog }),
  get_company_related_risk_scan: Object.freeze({ name: QCC_TOOL_NAMES.relatedRiskScan, map: mapCompanyRelatedRiskScanFields, inspect: inspectRelatedRiskCatalog }),
});

export function sourceToolsForFieldSelection(fieldSelection, includeRisk = false) {
  const selected = Array.isArray(fieldSelection) && fieldSelection.length ? fieldSelection : LEGACY_ENRICHMENT_FIELDS;
  const tools = selectedSourceTools(selected, LEGACY_ENRICHMENT_FIELDS);
  if (includeRisk && !tools.includes('get_company_risk_scan')) tools.push('get_company_risk_scan');
  return tools;
}

export function estimateQccCalls(uniqueCompanies, fieldSelection, includeRisk = false) {
  const companies = Math.max(0, Math.trunc(Number(uniqueCompanies) || 0));
  const sourceTools = sourceToolsForFieldSelection(fieldSelection, includeRisk);
  return {
    uniqueCompanies: companies,
    sourceTools,
    callsPerCompany: 1 + sourceTools.length,
    estimatedCalls: companies * (1 + sourceTools.length),
  };
}

function mergeMappedFields(...sources) {
  const output = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source ?? {})) {
      if (!Object.hasOwn(output, key) || (value !== '' && value !== null && value !== undefined)) output[key] = value;
    }
  }
  return output;
}

function projectSelectedFields(fields, fieldSelection) {
  const selected = Array.isArray(fieldSelection) && fieldSelection.length
    ? [...new Set(fieldSelection.map(String))]
    : LEGACY_ENRICHMENT_FIELDS;
  return Object.fromEntries(selected.map((field) => [field, fields[field] ?? '']));
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
    return Boolean(this.definitionFor(name));
  }

  definitionFor(name) {
    for (const candidate of qccToolRuntimeCandidates(name)) {
      try {
        const definition = this.tools.get(candidate);
        if (definition) return definition;
      } catch {
        // 一个候选在动态重注册窗口内失败时，仍继续探测已验证的兼容名称。
      }
    }
    return undefined;
  }

  capabilities() {
    const capabilities = {
      oauthConnect: this.has(QCC_TOOL_NAMES.oauthConnect),
      oauthStatus: this.has(QCC_TOOL_NAMES.oauthStatus),
      entityLookup: this.has(QCC_TOOL_NAMES.entityLookup),
      registration: this.has(QCC_TOOL_NAMES.registration),
      profile: this.has(QCC_TOOL_NAMES.profile),
      contact: this.has(QCC_TOOL_NAMES.contact),
      listing: this.has(QCC_TOOL_NAMES.listing),
      taxInvoice: this.has(QCC_TOOL_NAMES.taxInvoice),
      importExportCredit: this.has(QCC_TOOL_NAMES.importExportCredit),
      riskScan: this.has(QCC_TOOL_NAMES.riskScan),
      relatedRiskScan: this.has(QCC_TOOL_NAMES.relatedRiskScan),
    };
    const ready = capabilities.entityLookup && capabilities.registration;
    return {
      ...capabilities,
      ready,
      phase2: this.phase2Capabilities(),
      state: ready ? 'ready' : capabilities.oauthConnect || capabilities.oauthStatus
        ? 'not-connected-or-refreshing'
        : 'oauth-plugin-missing',
    };
  }

  /** 只读取 ToolRuntime 注册表，不执行 QCC 工具、不产生付费调用。 */
  phase2Capabilities() {
    const describe = ([id, name]) => {
      const definition = this.definitionFor(name);
      return { id, name, runtimeName: definition?.name ?? null, registered: Boolean(definition) };
    };
    const companyTools = Object.entries(QCC_PHASE2_COMPANY_TOOLS).map(describe);
    const historyTools = Object.entries(QCC_PHASE2_HISTORY_TOOLS).map(describe);
    const companyRegistered = companyTools.filter((tool) => tool.registered).length;
    const historyRegistered = historyTools.filter((tool) => tool.registered).length;
    const companyReady = companyRegistered === companyTools.length;
    const historyToolsReady = historyRegistered === historyTools.length;
    const oauthPluginPresent = this.has(QCC_TOOL_NAMES.oauthConnect) || this.has(QCC_TOOL_NAMES.oauthStatus);
    return {
      companyTools,
      historyTools,
      companyRegistered,
      companyTotal: companyTools.length,
      historyRegistered,
      historyTotal: historyTools.length,
      companyReady,
      historyToolsReady,
      historyAuthorizationVerified: false,
      state: companyReady
        ? historyToolsReady ? 'tool-surface-ready' : 'current-ready-history-tools-missing'
        : oauthPluginPresent ? 'not-connected-or-refreshing' : 'oauth-plugin-missing',
    };
  }

  /** 只读取 ToolRuntime 注册表，不执行 QCC 工具、不产生付费调用。 */
  phase3Capabilities() {
    const byDomain = {};
    for (const domain of Object.keys(QCC_PHASE3_TOOL_NAMES)) {
      const tools = QCC_PHASE3_TOOL_NAMES[domain].map((name) => {
        const canonical = `mcp__qcc-${domain}__${name}`;
        const definition = this.definitionFor(canonical);
        return { name, canonical, runtimeName: definition?.name ?? null, registered: Boolean(definition) };
      });
      const registered = tools.filter((tool) => tool.registered).length;
      byDomain[domain] = {
        tools,
        registered,
        total: tools.length,
        ready: registered === tools.length,
        ...QCC_PHASE3_DOMAIN_META[domain],
      };
    }
    const totalRegistered = Object.values(byDomain).reduce((sum, d) => sum + d.registered, 0);
    const total = QCC_PHASE3_ALL_CANONICAL_TOOLS.length;
    return {
      byDomain,
      totalRegistered,
      total,
      ready: totalRegistered === total,
    };
  }

  async waitForTool(name, { signal, waitMs = this.toolWaitMs } = {}) {
    const deadline = Date.now() + Math.max(0, waitMs);
    do {
      if (signal?.aborted) throw signal.reason ?? new Error('aborted');
      try {
        const definition = this.definitionFor(name);
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
    let activeToolName = name;
    let attempt = 0;
    let attemptStarted = 0;
    let attemptAudited = false;
    try {
      while (attempt < 2) {
        attempt += 1;
        callId = null;
        activeToolName = name;
        attemptStarted = Date.now();
        attemptAudited = false;
        try {
          const definition = await this.waitForTool(name, {
            signal: state.signal,
            waitMs: options.waitForToolMs ?? this.toolWaitMs,
          });
          activeToolName = definition?.name ?? name;
          callId = this.callIdFactory(activeToolName);
        } catch (error) {
          emitAudit(options, {
            toolName: activeToolName,
            callId,
            attempt,
            outcome: 'not-dispatched',
            code: error?.code ?? 'QCC_TOOL_UNAVAILABLE',
            upstreamCode: error?.upstreamCode,
            durationMs: Date.now() - attemptStarted,
          });
          attemptAudited = true;
          throw error;
        }
        const execution = options.execution;
        if (execution && (!execution.agent || !execution.token)) {
          throw new QccBridgeError(
            'QCC_AGENT_EXECUTION_REQUIRED',
            'Nested QCC calls require an Agent-owned DSH tool execution',
            { toolName: activeToolName },
          );
        }
        const result = await this.tools.execute({
          name: activeToolName,
          callId,
          signal: state.signal,
          arguments: args,
          ...(execution ? {
            rootCallId: execution.rootCallId,
            parent: execution.token,
            agent: execution.agent,
          } : {}),
        });
        if (result?.isError !== true) {
          emitAudit(options, {
            toolName: activeToolName,
            callId,
            attempt,
            outcome: 'success',
            durationMs: Date.now() - attemptStarted,
          });
          attemptAudited = true;
          return { callId, toolName: activeToolName, data: decodeQccToolValue(result?.value) };
        }
        const upstreamCode = upstreamFailureCode(result);
        if (upstreamCode === 'UNKNOWN_TOOL' && attempt === 1 && !state.signal.aborted) {
          emitAudit(options, {
            toolName: activeToolName,
            callId,
            attempt,
            outcome: 'refresh-race',
            code: 'QCC_TOOL_UNAVAILABLE',
            upstreamCode,
            durationMs: Date.now() - attemptStarted,
          });
          attemptAudited = true;
          await delay(this.pollMs, state.signal);
          continue;
        }
        const failure = normalizedFailure(result, activeToolName, { ...state, parentSignal });
        emitAudit(options, {
          toolName: activeToolName,
          callId,
          attempt,
          outcome: 'failed',
          code: failure.code,
          upstreamCode: failure.upstreamCode,
          durationMs: Date.now() - attemptStarted,
        });
        attemptAudited = true;
        throw failure;
      }
      throw new QccBridgeError('QCC_TOOL_UNAVAILABLE', `QCC tool disappeared during refresh: ${name}`, {
        toolName: name,
        retryable: true,
        connectRequired: true,
      });
    } catch (error) {
      if (error instanceof QccBridgeError) throw error;
      let normalized;
      if (state.timedOut()) {
        normalized = new QccBridgeError('QCC_TIMEOUT', `QCC tool timed out: ${name}`, {
          toolName: name,
          retryable: true,
          cause: error,
        });
      } else if (parentSignal?.aborted || state.signal.aborted) {
        normalized = new QccBridgeError('QCC_ABORTED', `QCC tool call was cancelled: ${name}`, {
          toolName: name,
          cause: error,
        });
      } else {
        normalized = new QccBridgeError('QCC_RUNTIME_ERROR', `QCC tool runtime failed: ${name}`, {
          toolName: name,
          retryable: true,
          cause: error,
        });
      }
      if (!attemptAudited) emitAudit(options, {
        toolName: activeToolName,
        callId,
        attempt,
        outcome: 'failed',
        code: normalized.code,
        durationMs: Date.now() - attemptStarted,
      });
      throw normalized;
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
    return this.enrichMatchedCompany(match, options);
  }

  async enrichMatchedCompany(match, options = {}) {
    const lockedKey = String(match?.creditNo || match?.companyName || '').trim();
    const sourceTools = sourceToolsForFieldSelection(options.fieldSelection, options.includeRisk);
    let mapped = {};
    let legacyRiskTags = '';
    for (const sourceTool of sourceTools) {
      const config = SOURCE_TOOL_CONFIG[sourceTool];
      if (!config) continue;
      const response = await this.call(config.name, { searchKey: lockedKey, ...(config.args ?? {}) }, options);
      const fields = config.map(response.data, match);
      mapped = mergeMappedFields(mapped, fields);
      if (sourceTool === 'get_company_risk_scan') legacyRiskTags = mapRiskTags(response.data);
      if (config.inspect) {
        const catalog = config.inspect(response.data);
        if (catalog.applicable && (catalog.missing.length || catalog.unknown.length)) {
          emitAudit(options, {
            toolName: response.toolName,
            callId: response.callId,
            outcome: 'catalog-drift',
            code: 'QCC_RISK_CATALOG_DRIFT',
            catalogVersion: catalog.version,
            missing: catalog.missing,
            unknown: catalog.unknown,
          });
        }
      }
    }
    const fields = projectSelectedFields(mapped, options.fieldSelection);
    if (options.includeRisk) fields.risk_tags = legacyRiskTags;
    return { status: 'enriched', companyName: String(match?.companyName ?? ''), fields };
  }

  async enrichLockedCompany(selection, options = {}) {
    const companyName = String(selection?.companyName ?? '').trim();
    const creditNo = String(selection?.creditNo ?? '').trim();
    if (!creditNo) {
      throw new QccBridgeError('QCC_CANDIDATE_INVALID', 'A selected QCC candidate must include a credit number');
    }
    return this.enrichMatchedCompany({ companyName, creditNo }, options);
  }

  async enrichRows(rows, options = {}) {
    if (!Array.isArray(rows)) throw new QccBridgeError('QCC_INVALID_ROWS', 'rows must be an array');
    const maxRows = Math.max(1, Math.trunc(options.maxRows ?? DEFAULT_MAX_ROWS));
    if (rows.length > maxRows) {
      throw new QccBridgeError('QCC_BATCH_TOO_LARGE', `QCC batch exceeds ${maxRows} rows`, {
        details: { maxRows, receivedRows: rows.length },
      });
    }

    const nameField = String(options.nameField ?? 'name');
    const normalized = rows.map((row, index) => ({
      index,
      row: isRecord(row) ? { ...row } : {},
      companyName: String(isRecord(row) ? row[nameField] ?? '' : '').trim(),
    }));
    const names = [...new Set(normalized.map((item) => item.companyName).filter(Boolean))];
    const estimate = estimateQccCalls(names.length, options.fieldSelection, options.includeRisk);
    const maxCalls = Math.max(1, Math.trunc(options.maxCalls ?? DEFAULT_MAX_CALLS));
    if (estimate.estimatedCalls > maxCalls) {
      throw new QccBridgeError('QCC_CALL_BUDGET_EXCEEDED', `QCC call estimate exceeds ${maxCalls}`, {
        details: { ...estimate, maxCalls },
      });
    }

    const requiredTools = [
      QCC_TOOL_NAMES.entityLookup,
      ...estimate.sourceTools
        .map((sourceTool) => SOURCE_TOOL_CONFIG[sourceTool]?.name)
        .filter(Boolean),
    ];
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

    return { summary, rows: outputRows, reviewQueue, errors, estimate };
  }
}
