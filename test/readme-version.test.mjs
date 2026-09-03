import test from 'node:test';
import assert from 'node:assert/strict';

import { assessReadmeVersion } from '../scripts/check-readme-version.mjs';

const candidate = {
  'README.md': '> 当前源码版本：**0.5.1**（待发布补丁；npm `latest` 与 GitHub Latest 均为 0.5.0）',
  'README.en.md': '> Current source version: **0.5.1** (patch candidate; npm `latest` and GitHub Latest are both 0.5.0)',
};

test('普通分支允许 README 使用与 package 一致的候选版本文案', () => {
  const result = assessReadmeVersion({ version: '0.5.1', readmes: candidate });
  assert.equal(result.ok, true);
});

test('标签发布拒绝把候选状态 README 打入不可变 npm 包', () => {
  const result = assessReadmeVersion({ version: '0.5.1', readmes: candidate, releaseMode: true });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [
    'README.md 未切换为 0.5.1 正式发布态',
    'README.en.md 未切换为 0.5.1 正式发布态',
  ]);
});

test('标签发布接受中英文 README 均为当前正式版本', () => {
  const readmes = {
    'README.md': '> 当前源码版本：**0.5.1**（正式版本）',
    'README.en.md': '> Current source version: **0.5.1** (stable release)',
  };
  const result = assessReadmeVersion({ version: '0.5.1', readmes, releaseMode: true });
  assert.equal(result.ok, true);
});
