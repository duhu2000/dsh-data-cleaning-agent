/**
 * 文档版本一致性：README 中标注的当前版本必须与 package.json 的 version 一致。
 * 标签发布时额外要求 README 已切换为正式发布态，避免候选文案进入不可变 npm tarball。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function assessReadmeVersion({ version, readmes, releaseMode = false }) {
  const errors = [];
  for (const [name, text] of Object.entries(readmes)) {
    if (!text.includes(`**${version}**`)) {
      errors.push(`${name} 中未找到当前版本 **${version}**`);
    }
  }

  if (releaseMode) {
    const expected = {
      'README.md': `（已发布；npm \`latest\` 与 GitHub Latest 均为 ${version}）`,
      'README.en.md': `(released; npm \`latest\` and GitHub Latest are both ${version})`,
    };
    for (const [name, marker] of Object.entries(expected)) {
      if (!readmes[name]?.includes(marker)) {
        errors.push(`${name} 未切换为 ${version} 正式发布态`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

export function runDocsCheck({ rootDir = root, env = process.env } = {}) {
  const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
  const version = pkg.version;
  const readmes = Object.fromEntries(
    ['README.md', 'README.en.md'].map((name) => [name, readFileSync(join(rootDir, name), 'utf8')]),
  );
  const releaseMode = env.DSH_RELEASE_MODE === '1' || env.GITHUB_REF_TYPE === 'tag';
  const result = assessReadmeVersion({ version, readmes, releaseMode });
  if (!result.ok) {
    for (const error of result.errors) console.error(`docs:check 失败：${error}`);
    console.error('请在 README.md / README.en.md 的「当前版本 / Current version」处更新版本与发布状态。');
    return 1;
  }
  console.log(`docs:check 通过：README 版本与 package.json（${version}）一致${releaseMode ? '，发布态文案已确认' : ''}。`);
  return 0;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exitCode = runDocsCheck();
}
