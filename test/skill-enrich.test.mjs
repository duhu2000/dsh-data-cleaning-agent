import assert from 'node:assert/strict';
import test from 'node:test';

import {
  QCC_PHASE2_COMPANY_TOOLS,
  QCC_PHASE2_DIMENSION_GROUPS,
  QCC_PHASE2_HISTORY_TOOLS,
} from '../lib/qcc-phase2.js';
import { ENRICH_SKILL_NAME, registerEnrichSkill } from '../lib/skill-enrich.js';

function captureSkill() {
  let definition;
  const result = registerEnrichSkill({
    register(value) {
      definition = value;
      return 'registered';
    },
  });

  assert.equal(result, 'registered');
  assert.ok(definition);
  return definition;
}

test('0.4.0 contract contains 16 company and 4 history tools without duplicates', () => {
  const company = Object.values(QCC_PHASE2_COMPANY_TOOLS);
  const history = Object.values(QCC_PHASE2_HISTORY_TOOLS);

  assert.equal(company.length, 16);
  assert.equal(history.length, 4);
  assert.equal(new Set(company).size, company.length);
  assert.equal(new Set(history).size, history.length);
  assert.ok(company.every((name) => name.startsWith('mcp__qcc-company__')));
  assert.ok(history.every((name) => name.startsWith('mcp__qcc-history__')));
});

test('dimension groups reference only verified contract tools', () => {
  const known = new Set([
    ...Object.values(QCC_PHASE2_COMPANY_TOOLS),
    ...Object.values(QCC_PHASE2_HISTORY_TOOLS),
  ]);
  const grouped = Object.values(QCC_PHASE2_DIMENSION_GROUPS).flatMap((group) => group.tools);

  assert.equal(new Set(grouped).size, known.size);
  assert.ok(grouped.every((tool) => known.has(tool)));
  assert.equal(QCC_PHASE2_DIMENSION_GROUPS.history.access, 'enterprise-certified');
});

test('enterprise-enrichment registers all phase-2 tools and provenance rules', () => {
  const skill = captureSkill();

  assert.equal(skill.name, ENRICH_SKILL_NAME);
  for (const tool of [
    ...Object.values(QCC_PHASE2_COMPANY_TOOLS),
    ...Object.values(QCC_PHASE2_HISTORY_TOOLS),
  ]) {
    assert.match(skill.content, new RegExp(tool.replaceAll('-', '\\-')));
  }
  assert.match(skill.content, /source_tool/);
  assert.match(skill.content, /same-origin Host download or artifact/);
});

test('enterprise-enrichment keeps ambiguity and paid-call controls explicit', () => {
  const { content } = captureSkill();

  assert.match(content, /DO NOT auto-pick the first/);
  assert.match(content, /ask the user which one to use/);
  assert.match(content, /do not invoke every 0\.4\.0 tool by default/);
  assert.match(content, /announce the next batch before paid calls/);
});

test('enterprise-enrichment degrades history permission failures safely', () => {
  const { content } = captureSkill();

  assert.match(content, /enterprise-certified account/);
  assert.match(content, /permission_required/);
  assert.match(content, /continue current-data groups/);
});

test('enterprise-enrichment forbids inferred numeric and ownership values', () => {
  const { content } = captureSkill();

  assert.match(content, /exactly as the QCC tool returned them/);
  assert.match(content, /never recompute, multiply ownership chains, aggregate, or estimate/);
  assert.match(content, /absent field never means "none" or zero/);
});
