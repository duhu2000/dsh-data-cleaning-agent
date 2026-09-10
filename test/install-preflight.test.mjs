import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCombination } from '../lib/install-preflight.js';
test('target combination accepts optional context absence', () => {
  assert.equal(assessCombination({host:'0.1.2-rc.1',sidebar:'0.18.1'}).ok,true);
});
test('known incompatible combinations block', () => {
  assert.equal(assessCombination({host:'0.1.2-rc.1',sidebar:'0.17.1'}).ok,false);
  for (const host of ['0.1.1-rc.2','0.1.2-alpha.2']) assert.equal(assessCombination({host,sidebar:'0.18.1'}).ok,false);
  assert.equal(assessCombination({host:'0.1.2-rc.1',sidebar:'0.18.1',context:'0.36.0'}).ok,false);
});
test('missing CLI or provider blocks; unknown combination warns', () => {
  assert.equal(assessCombination({sidebar:'0.18.1'}).ok,false);
  assert.equal(assessCombination({host:'0.1.2-rc.1'}).ok,false);
  assert.ok(assessCombination({host:'0.1.3',sidebar:'0.19.0'}).warnings.length);
});
