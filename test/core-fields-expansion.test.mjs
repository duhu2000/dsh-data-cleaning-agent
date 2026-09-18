import test from 'node:test';
import assert from 'node:assert/strict';
import { mapRegistrationFields, mapProfileFields, sourceToolsForFieldSelection } from '../lib/qcc.js';
import { QCC_FIELD_CATALOG } from '../lib/qcc-field-catalog.js';
import { WorkflowArtifactStore } from '../lib/artifacts.js';
import XLSX from 'xlsx';

test('new fields export as Chinese XLSX columns, text codes and one product cell, separate from report', async () => {
  const files = new Map();
  const fs = {
    resolve: async key => ({ key, displayPath: key }),
    writeText: async (target, text) => files.set(target.key, Buffer.from(text)),
    readBytes: async target => files.get(target.key),
  };
  const store = new WorkflowArtifactStore({ fs });
  const fields = ['area_code', 'industry_small', 'qcc_industry_level4', 'main_products', 'company_scale'];
  const artifacts = await store.createBundle('dcw-synthetic-core', {
    headers: ['企业名称', ...fields], fieldSelection: fields,
    rows: [{ 企业名称: '合成契约企业', area_code: '001234', industry_small: '小类',
      qcc_industry_level4: '四级', main_products: '产品甲；产品乙', company_scale: '小型',
      qcc_match_status: 'enriched', qcc_source: 'synthetic-contract-fixture' }],
    baseName: '合成契约测试',
  });
  const complete = artifacts.find(item => item.kind === 'complete');
  assert.ok(artifacts.some(item => item.kind === 'report'));
  const workbook = XLSX.read(await store.read('dcw-synthetic-core', complete));
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].地区代码, '001234');
  assert.equal(rows[0].国标行业小类, '小类');
  assert.equal(rows[0].企查查行业四级, '四级');
  assert.equal(rows[0].主营产品, '产品甲；产品乙');
  assert.equal(rows[0].企业规模, '小型');
  assert.equal(rows[0].匹配状态, undefined);
  assert.equal(rows[0].数据来源, undefined);
});

// Synthetic contract fixtures, not live company facts.
test('V3.25 core fields project explicit nested leaves into one row', () => {
  const registration = mapRegistrationFields({
    地区信息: { 省份: '合成省', 城市: '合成市', 区域: '合成区', 地区代码: '001234' },
    国标行业: { 门类: '门类样例', 大类: '大类样例', 中类: '', 小类: '小类样例' },
    人员规模: '10-19人',
  });
  assert.equal(registration.province, '合成省');
  assert.equal(registration.city, '合成市');
  assert.equal(registration.district, '合成区');
  assert.equal(registration.area_code, '001234');
  assert.equal(registration.industry_section, '门类样例');
  assert.equal(registration.industry_large, '大类样例');
  assert.equal(registration.industry_middle, '');
  assert.equal(registration.industry_small, '小类样例');
  assert.equal(registration.industry_category, '门类：门类样例；大类：大类样例；小类：小类样例');
  const profile = mapProfileFields({
    企查查行业: { 一级: '一级样例', 二级: '二级样例', 三级: '', 四级: '四级样例' },
    主营产品: ['产品乙', '产品甲', '产品乙'], 企业规模: '小型',
  });
  assert.equal(profile.qcc_industry_level1, '一级样例');
  assert.equal(profile.qcc_industry_level2, '二级样例');
  assert.equal(profile.qcc_industry_level3, '');
  assert.equal(profile.qcc_industry_level4, '四级样例');
  assert.equal(profile.qcc_industry, '一级：一级样例；二级：二级样例；四级：四级样例');
  assert.equal(profile.main_products, '产品乙；产品甲；产品乙');
  assert.equal(profile.company_scale, '小型');
  assert.equal(registration.company_size, '10-19人');
  for (const cell of Object.values({ ...registration, ...profile })) {
    assert.equal(typeof cell, 'string');
    assert.doesNotMatch(cell, /\[object Object\]|undefined/);
  }
});

test('legacy industry strings remain intact; missing nested levels are never inferred', () => {
  const registration = mapRegistrationFields({ 所属地区: '不可拆分地区', 国标行业: '旧行业原文' });
  assert.equal(registration.industry_category, '旧行业原文');
  for (const key of ['province', 'city', 'district', 'area_code', 'industry_section', 'industry_large', 'industry_middle', 'industry_small'])
    assert.equal(registration[key], '');
  const profile = mapProfileFields({ 企查查行业: '旧画像行业', 企业规模: null, 主营产品: [] });
  assert.equal(profile.qcc_industry, '旧画像行业');
  for (const key of ['qcc_industry_level1', 'qcc_industry_level2', 'qcc_industry_level3', 'qcc_industry_level4', 'main_products', 'company_scale'])
    assert.equal(profile[key], '');
});

test('malformed core leaves do not stringify objects or invent facts', () => {
  const registration = mapRegistrationFields({ 地区信息: { 地区代码: 0, 省份: {} }, 国标行业: { 门类: [], 大类: {} } });
  assert.equal(registration.area_code, '0');
  assert.equal(registration.province, '');
  assert.equal(registration.industry_category, '');
  const profile = mapProfileFields({ 企查查行业: [], 企业规模: {}, 主营产品: ['产品甲', null, {}, 42, ''] });
  assert.equal(profile.qcc_industry, '');
  assert.equal(profile.company_scale, '');
  assert.equal(profile.main_products, '产品甲');
});

test('14 additive fields use exactly two existing tools with unchanged defaults', () => {
  const additions = QCC_FIELD_CATALOG.flatMap(group => group.fields.filter(field => field.sourcePath));
  assert.equal(additions.length, 14);
  assert.ok(additions.every(field => !field.defaultSelected));
  const tools = sourceToolsForFieldSelection(additions.map(field => field.id));
  assert.equal(tools.length, 2);
  assert.ok(tools.some(tool => tool.includes('get_company_registration_info')));
  assert.ok(tools.some(tool => tool.includes('get_company_profile')));
});
