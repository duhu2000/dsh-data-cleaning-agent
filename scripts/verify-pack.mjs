/**
 * 发布前校验 npm 包内容，防止测试、设计稿、验证脚本或本地文件被误发布。
 * 对标 dsh-mcp-connector 的 scripts/verify-pack.mjs。
 */
import { execFileSync } from 'node:child_process';

const WHITELIST = [
  /^package\.json$/,
  /^cordis\.patch\.yml$/,
  /^README\.md$/,
  /^README\.en\.md$/,
  /^LICENSE$/,
  /^CHANGELOG\.md$/,
  /^CONTRIBUTING\.md$/,
  /^install\.sh$/,
  /^marketing\/metadata\.json$/,
  /^lib\/[^/]+\.js$/,
  /^docs\/(?:USER-GUIDE|FIRST-CONTRIBUTION|COMPATIBILITY|QCC-ENRICHMENT-DESIGN|QCC-PHASES-ROADMAP|PHASE2-ACCEPTANCE|PHASE3-ACCEPTANCE|RELEASE-0\.4\.0|RELEASE-0\.5\.0|RELEASE-0\.5\.1|RELEASE-0\.5\.2|RELEASE-0\.5\.3|G5-HOST-BRIDGE|G5-E2E-RUNBOOK)\.md$/,
];

let raw;
try {
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  // 使用仓库本地缓存目录，避免依赖用户全局 ~/.npm（其可能含 root 属主文件导致 EPERM）。
  const args = npmCli
    ? [npmCli, 'pack', '--dry-run', '--json', '--cache', '.npm-cache']
    : ['pack', '--dry-run', '--json', '--cache', '.npm-cache'];
  raw = execFileSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (error) {
  console.error('verify-pack 失败：`npm pack --dry-run --json` 执行出错');
  console.error(String(error.stderr ?? error.message));
  process.exit(1);
}

const [pack] = JSON.parse(raw);
if (!pack || !Array.isArray(pack.files)) {
  console.error('verify-pack 失败：无法解析 npm pack 输出');
  process.exit(1);
}

const files = pack.files.map((file) => file.path).sort();
const stray = files.filter((file) => !WHITELIST.some((rule) => rule.test(file)));
if (stray.length > 0) {
  console.error('verify-pack 失败：以下文件不应进入 npm 发布包：');
  for (const file of stray) console.error(`  - ${file}`);
  process.exit(1);
}

console.log(`verify-pack 通过：${files.length} 个文件均在白名单内。`);
for (const file of files) console.log(`  ✓ ${file}`);
