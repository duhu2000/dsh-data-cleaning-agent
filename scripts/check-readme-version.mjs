/**
 * 文档版本一致性：README 中标注的当前版本必须与 package.json 的 version 一致。
 * 阻断「改了 package.json 忘了改 README」的版本漂移。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;

const targets = ['README.md', 'README.en.md'];
let ok = true;
for (const name of targets) {
  const text = readFileSync(join(root, name), 'utf8');
  if (!text.includes(`**${version}**`)) {
    console.error(`docs:check 失败：${name} 中未找到当前版本 **${version}**`);
    ok = false;
  }
}

if (!ok) {
  console.error('请在 README.md / README.en.md 的「当前版本 / Current version」处更新版本号。');
  process.exit(1);
}
console.log(`docs:check 通过：README 版本与 package.json（${version}）一致。`);
