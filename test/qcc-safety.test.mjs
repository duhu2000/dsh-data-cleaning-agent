import test from 'node:test';
import assert from 'node:assert/strict';
import { redactSensitive, redactSensitiveText, safeAuditEvent } from '../lib/qcc-safety.js';

test('脱敏器移除嵌套凭据、Bearer、JWT、OAuth 参数和已知企业名', () => {
  const source = {
    access_token: 'raw-access-token',
    nested: {
      authorization: 'Bearer abc.def.ghi',
      callback: 'http://127.0.0.1/callback?code=oauth-code&state=ok',
      company: '真实测试企业有限公司',
      credit: '91320100MA1234567X',
      email: 'owner@example.com',
      phone: '13800138000',
    },
  };
  const output = redactSensitive(source, { companyNames: ['真实测试企业有限公司'] });
  const json = JSON.stringify(output);
  for (const secret of [
    'raw-access-token', 'abc.def.ghi', 'oauth-code', '真实测试企业有限公司',
    '91320100MA1234567X', 'owner@example.com', '13800138000',
  ]) assert.equal(json.includes(secret), false, `should redact ${secret}`);
  assert.equal(output.access_token, '[REDACTED]');
  assert.match(output.nested.company, /COMPANY_01/);
});

test('文本脱敏保留非敏感错误语义', () => {
  const output = redactSensitiveText('请求 rate limited；Bearer super-secret；企业=真实企业', {
    companyNames: ['真实企业'],
  });
  assert.match(output, /rate limited/);
  assert.doesNotMatch(output, /super-secret|真实企业/);
});

test('安全审计事件严格限制字段', () => {
  const event = safeAuditEvent({
    toolName: 'mcp__qcc-company__get_company_by_query',
    callId: 'call-1',
    outcome: 'failed',
    code: 'QCC_RATE_LIMITED',
    upstreamCode: '429',
    durationMs: 12,
    catalogVersion: '2026-09-05',
    missing: ['重要风险:欠税公告'],
    unknown: ['重点维度:新增维度', '91320100MA1234567X'],
    arguments: { searchKey: '不得出现' },
    data: { raw: '不得出现' },
  });
  assert.equal(JSON.stringify(event).includes('不得出现'), false);
  assert.equal(event.durationMs, 12);
  assert.equal(event.code, 'QCC_RATE_LIMITED');
  assert.equal(event.catalogVersion, '2026-09-05');
  assert.deepEqual(event.missing, ['重要风险:欠税公告']);
  assert.deepEqual(event.unknown, ['重点维度:新增维度', '[CREDIT_NO_REDACTED]']);
});
