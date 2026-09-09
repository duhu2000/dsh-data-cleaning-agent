import test from 'node:test';
import assert from 'node:assert/strict';
import { projectFirstSnapshot, SNAPSHOT_GROUP_ORDER } from 'qcc-field-contracts';
import { QCC_FIELD_CATALOG } from '../lib/qcc-field-catalog.js';
import { QccHostBridge } from '../lib/qcc.js';
test('snapshot catalog has 136 fields in agreed order', () => {
  assert.deepEqual(QCC_FIELD_CATALOG.map(g => g.id), SNAPSHOT_GROUP_ORDER);
  assert.equal(QCC_FIELD_CATALOG.flatMap(g => g.fields).length, 136);
});
test('UBO only projects first owner, never manager or second owner', () => {
  const data = { 受益所有人信息: { 受益所有人: [{受益所有人名称:'甲'}, {受益所有人名称:'乙'}], 日常经营管理人员:[{名称:'丙'}] }};
  assert.deepEqual(projectFirstSnapshot(data,'get_beneficial_owners').values, {beneficial_owner_first_name:'甲'});
  data.受益所有人信息.受益所有人[0] = {};
  assert.deepEqual(projectFirstSnapshot(data,'get_beneficial_owners').values,{});
  data.受益所有人信息.受益所有人 = [];
  assert.equal(projectFirstSnapshot(data,'get_beneficial_owners').issues.beneficial_owner_first_name.code,'no-record');
});
test('financials stay in first period, preserve zero and precision, do not guess missing values', async () => {
  const data={财务数据信息:[{报告期:'2025年年报',披露等级:'仅有核心指标',指标详情:{主要财务指标:{营业总收入:'0',利润总额:'-10.123400',总资产:''}}},{报告期:'2024年年报',指标详情:{主要财务指标:{总资产:'999'}}}]};
  const projected=projectFirstSnapshot(data,'get_financial_data');
  assert.deepEqual(projected.values,{financial_total_revenue:'0',financial_total_profit:'-10.123400'});
  assert.equal(projected.provenance.reportPeriod,'2025年年报');
  const calls=[];
  const bridge=new QccHostBridge({tools:{get(){return {}},execute(){throw Error('unexpected transport')}}});
  bridge.call=async name=>{calls.push(name);return {data};};
  const result=await bridge.enrichMatchedCompany({companyName:'合成有限公司'},{fieldSelection:['financial_total_revenue','financial_total_profit','financial_total_assets']});
  assert.equal(calls.length,1);
  assert.equal(calls[0],'mcp__qcc-company__get_financial_data');
  assert.equal(result.fields.financial_total_revenue,'0');
  assert.ok(result.fieldIssues.financial_total_assets);
});
