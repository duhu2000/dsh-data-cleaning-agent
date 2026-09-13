import test from 'node:test';
import assert from 'node:assert/strict';
import { providerResultState } from '../lib/qcc.js';
import { safeAuditEvent } from '../lib/qcc-safety.js';

test('Provider six outcomes do not equate missing data, denied access or skipped calls with zero records', () => {
  assert.equal(providerResultState({data:[{name:'合成'}]}),'success-data');
  assert.equal(providerResultState({data:[]}), 'success-empty');
  assert.equal(providerResultState({data:{实际控制人信息:[],has_more:false}}), 'success-empty');
  assert.equal(providerResultState({data:{实际控制人信息:[],has_more:true}}), 'unknown');
  assert.equal(providerResultState({required:false}), 'not-required');
  assert.equal(providerResultState({error:{upstreamCode:'403'}}), 'no-permission');
  assert.equal(providerResultState({error:{code:'QCC_TIMEOUT'}}), 'failed');
  for (const data of [undefined,null,{},'']) assert.equal(providerResultState({data}), 'unknown');
  assert.equal(safeAuditEvent({providerState:'success-empty',data:{secret:'never persist'}}).providerState,'success-empty');
  assert.equal(safeAuditEvent({providerState:'success-empty',data:{secret:'never persist'}}).data,undefined);
});
