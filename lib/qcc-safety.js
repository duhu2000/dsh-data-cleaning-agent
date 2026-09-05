/**
 * G5 安全输出工具。
 *
 * 仅用于日志、审计和 E2E 报告；同源业务响应仍由调用方按契约返回。
 * 这里不尝试“识别所有秘密”，而是采用两层防线：敏感键整值抹除，字符串再做
 * Bearer/JWT/OAuth 参数、信用代码、邮箱、手机号和已知企业名替换。
 */

const SECRET_KEY = /(?:^|_)(?:access_token|refresh_token|id_token|token|authorization|cookie|secret|client_secret|code_verifier|api_key|apikey|password)(?:$|_)/i;
const CREDIT_NO = /\b[0-9A-Z]{18}\b/g;
const PHONE = /(?<!\d)1[3-9]\d{9}(?!\d)/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const URL_SECRET = /([?&](?:code|token|access_token|refresh_token|id_token|client_secret)=)[^&\s]+/gi;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function companyAliases(companyNames) {
  const seen = new Set();
  return (Array.isArray(companyNames) ? companyNames : [])
    .map((name) => String(name ?? '').trim())
    .filter((name) => name && !seen.has(name) && seen.add(name))
    .sort((a, b) => b.length - a.length)
    .map((name, index) => ({
      pattern: new RegExp(escapeRegExp(name), 'g'),
      replacement: `[COMPANY_${String(index + 1).padStart(2, '0')}]`,
    }));
}

export function redactSensitiveText(value, options = {}) {
  let text = String(value ?? '');
  text = text
    .replace(BEARER, 'Bearer [REDACTED]')
    .replace(JWT, '[JWT_REDACTED]')
    .replace(URL_SECRET, '$1[REDACTED]')
    .replace(CREDIT_NO, '[CREDIT_NO_REDACTED]')
    .replace(PHONE, '[PHONE_REDACTED]')
    .replace(EMAIL, '[EMAIL_REDACTED]');
  for (const alias of companyAliases(options.companyNames)) {
    text = text.replace(alias.pattern, alias.replacement);
  }
  return text;
}

export function redactSensitive(value, options = {}) {
  const seen = new WeakSet();

  const visit = (input, key = '') => {
    if (SECRET_KEY.test(key)) return '[REDACTED]';
    if (typeof input === 'string') return redactSensitiveText(input, options);
    if (input === null || typeof input !== 'object') return input;
    if (seen.has(input)) return '[CIRCULAR]';
    seen.add(input);
    if (Array.isArray(input)) return input.map((item) => visit(item));
    return Object.fromEntries(Object.entries(input).map(([childKey, child]) => [childKey, visit(child, childKey)]));
  };

  return visit(value);
}

export function safeAuditEvent(event) {
  const source = event && typeof event === 'object' ? event : {};
  const safeCatalogLabels = (value) => (Array.isArray(value) ? value : [])
    .slice(0, 64)
    .map((item) => redactSensitiveText(String(item ?? '')).slice(0, 128))
    .filter(Boolean);
  const safe = {
    at: String(source.at ?? new Date().toISOString()),
    event: 'qcc-tool-call',
    toolName: String(source.toolName ?? ''),
    callId: String(source.callId ?? ''),
    attempt: Number(source.attempt ?? 0),
    outcome: String(source.outcome ?? 'unknown'),
    code: source.code ? String(source.code) : null,
    upstreamCode: source.upstreamCode ? String(source.upstreamCode) : null,
    durationMs: Math.max(0, Number(source.durationMs ?? 0)),
  };
  if (source.catalogVersion || Array.isArray(source.missing) || Array.isArray(source.unknown)) {
    safe.catalogVersion = source.catalogVersion ? String(source.catalogVersion).slice(0, 64) : null;
    safe.missing = safeCatalogLabels(source.missing);
    safe.unknown = safeCatalogLabels(source.unknown);
  }
  return safe;
}
