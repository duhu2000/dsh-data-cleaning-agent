import test from 'node:test';
import assert from 'node:assert/strict';
import { registerSkill } from '../lib/skill.js';
import { registerEnrichSkill } from '../lib/skill-enrich.js';

test('UX49 business skill preflight comes before OAuth/OCR/MCP/workflow instructions; no global send hook', () => {
  for (const register of [registerSkill, registerEnrichSkill]) {
    let definition;
    register({register: value => {definition=value;}});
    const first = definition.content.split('\n')[0];
    assert.match(first,/UX-49/);
    assert.match(first,/【】/);
    assert.match(first,/ZERO tool calls|零工具调用/);
    for (const tool of ['OAuth','OCR','MCP','workflow']) assert.ok(first.includes(tool));
    assert.match(first,/ordinary user content|普通内容/);
    assert.match(first,/global send|全局拦截/);
    assert.match(first,/credential|凭证/);
    assert.match(first,/Excel/);
    assert.match(first,/fields|字段/);
  }
});
