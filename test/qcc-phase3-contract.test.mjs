import assert from 'node:assert/strict';
import test from 'node:test';

import {
  QCC_PHASE3_ALL_CANONICAL_TOOLS,
  QCC_PHASE3_DEFAULT_REQUIRED_INPUTS,
  QCC_PHASE3_DOMAIN_META,
  QCC_PHASE3_REQUIRED_INPUTS,
  QCC_PHASE3_TOOL_NAMES,
  canonicalPhase3ToolName,
  isPhase3Tool,
  qccToolRuntimeCandidates,
  requiredInputsFor,
} from '../lib/qcc-phase3.js';

const DOMAINS = ['risk', 'ipr', 'operation'];
const EXPECTED_COUNTS = Object.freeze({ risk: 38, ipr: 18, operation: 35 });
const TOTAL = 91;

test('三期契约覆盖三大域，且工具数 38/18/35（合计 91）', () => {
  assert.deepEqual(
    Object.keys(QCC_PHASE3_TOOL_NAMES).sort(),
    [...DOMAINS].sort(),
  );
  for (const domain of DOMAINS) {
    assert.equal(QCC_PHASE3_TOOL_NAMES[domain].length, EXPECTED_COUNTS[domain], domain);
  }
  assert.equal(QCC_PHASE3_ALL_CANONICAL_TOOLS.length, TOTAL);
});

test('每个工具短名唯一，跨域无重复，且符合 get_* 命名', () => {
  const seen = new Map();
  for (const domain of DOMAINS) {
    for (const name of QCC_PHASE3_TOOL_NAMES[domain]) {
      assert.match(name, /^get_[a-z0-9_]+$/, `${domain}:${name}`);
      if (seen.has(name)) {
        assert.fail(`duplicate short name across domains: ${name} (${seen.get(name)} vs ${domain})`);
      }
      seen.set(name, domain);
    }
  }
  assert.equal(seen.size, TOTAL);
});

test('规范名构造为 mcp__qcc-<domain>__<name>', () => {
  for (const domain of DOMAINS) {
    for (const name of QCC_PHASE3_TOOL_NAMES[domain]) {
      assert.equal(canonicalPhase3ToolName(domain, name), `mcp__qcc-${domain}__${name}`);
    }
  }
  assert.throws(() => canonicalPhase3ToolName('history', 'get_historical_shareholders'), /Unknown QCC phase-3 domain/);
});

test('全量规范名与按域构造结果一致', () => {
  const rebuilt = DOMAINS.flatMap((domain) =>
    QCC_PHASE3_TOOL_NAMES[domain].map((name) => canonicalPhase3ToolName(domain, name)),
  );
  assert.deepEqual(QCC_PHASE3_ALL_CANONICAL_TOOLS, rebuilt);
  assert.equal(new Set(QCC_PHASE3_ALL_CANONICAL_TOOLS).size, TOTAL);
});

test('canonical→legacy 运行时名映射覆盖三域', () => {
  for (const canonical of QCC_PHASE3_ALL_CANONICAL_TOOLS) {
    const candidates = qccToolRuntimeCandidates(canonical);
    assert.equal(candidates.length, 2, canonical);
    assert.equal(candidates[0], canonical);
    // legacy 形如 mcp__risk__get_xxx
    const expectedLegacy = canonical.replace(/^mcp__qcc-/, 'mcp__');
    assert.equal(candidates[1], expectedLegacy);
    assert.match(candidates[1], /^mcp__(risk|ipr|operation)__get_[a-z0-9_]+$/);
  }
});

test('legacy 名同样能被识别为三期工具', () => {
  for (const canonical of QCC_PHASE3_ALL_CANONICAL_TOOLS) {
    const legacy = canonical.replace(/^mcp__qcc-/, 'mcp__');
    assert.equal(isPhase3Tool(legacy), true, legacy);
    assert.equal(isPhase3Tool(canonical), true, canonical);
    assert.equal(isPhase3Tool(canonical.split('__').at(-1)), true);
  }
  assert.equal(isPhase3Tool('get_not_a_real_tool'), false);
  assert.equal(isPhase3Tool('mcp__qcc-history__get_historical_shareholders'), false);
});

test('必需输入 schema：90 工具仅 searchKey，唯 get_judicial_document_detail 加 documentId', () => {
  let exceptionCount = 0;
  for (const domain of DOMAINS) {
    for (const name of QCC_PHASE3_TOOL_NAMES[domain]) {
      const required = requiredInputsFor(name);
      if (name === 'get_judicial_document_detail') {
        exceptionCount += 1;
        assert.deepEqual(required, ['searchKey', 'documentId']);
      } else {
        assert.deepEqual(required, ['searchKey']);
      }
      // 冻结默认常量与映射一致性
      if (name === 'get_judicial_document_detail') {
        assert.deepEqual(QCC_PHASE3_REQUIRED_INPUTS[name], ['searchKey', 'documentId']);
      } else {
        assert.equal(QCC_PHASE3_REQUIRED_INPUTS[name], undefined);
      }
    }
  }
  assert.equal(exceptionCount, 1);
  assert.deepEqual(QCC_PHASE3_DEFAULT_REQUIRED_INPUTS, ['searchKey']);
});

test('权限与付费语义：三域均为 basic + paid + 需确认', () => {
  for (const domain of DOMAINS) {
    const meta = QCC_PHASE3_DOMAIN_META[domain];
    assert.equal(meta.access, 'basic', domain);
    assert.equal(meta.paid, true, domain);
    assert.equal(meta.requiresConfirmation, true, domain);
    assert.ok(meta.label.length > 0, domain);
  }
  // 0.5.0 不引入 history 域的企业认证语义
  assert.equal(QCC_PHASE3_DOMAIN_META.history, undefined);
});

test('冻结的清单不可变', () => {
  assert.equal(Object.isFrozen(QCC_PHASE3_TOOL_NAMES), true);
  assert.equal(Object.isFrozen(QCC_PHASE3_TOOL_NAMES.risk), true);
  assert.equal(Object.isFrozen(QCC_PHASE3_ALL_CANONICAL_TOOLS), true);
  assert.equal(Object.isFrozen(QCC_PHASE3_DOMAIN_META), true);
  assert.equal(Object.isFrozen(QCC_PHASE3_DEFAULT_REQUIRED_INPUTS), true);
});
