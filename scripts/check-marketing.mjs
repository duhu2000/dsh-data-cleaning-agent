/**
 * 校验 marketing/metadata.json 结构，供 DSH marketplace 每小时验收 workflow 使用。
 * 对标 dsh-mcp-connector 的市场注册元数据契约。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(root, 'marketing', 'metadata.json'), 'utf8');
let meta;
try {
  meta = JSON.parse(raw);
} catch {
  console.error('check-marketing 失败：marketing/metadata.json 不是合法 JSON');
  process.exit(1);
}

const errors = [];
const need = (value, label) => {
  if (value === undefined || value === null || value === '') {
    errors.push(`缺少字段：${label}`);
  }
};

need(meta.schemaVersion, 'schemaVersion');
if (meta.schemaVersion !== 1) errors.push(`schemaVersion 应为 1，实际 ${meta.schemaVersion}`);
need(meta.repository, 'repository');
need(meta.packageName, 'packageName');

need(meta.npm?.description, 'npm.description');
if (!Array.isArray(meta.npm?.requiredKeywords) || meta.npm.requiredKeywords.length === 0) {
  errors.push('npm.requiredKeywords 必须为非空数组');
} else if (!meta.npm.requiredKeywords.includes('dsh-plugin')) {
  errors.push('npm.requiredKeywords 必须包含 dsh-plugin');
}

need(meta.github?.description, 'github.description');
if (!Array.isArray(meta.github?.topics) || meta.github.topics.length === 0) {
  errors.push('github.topics 必须为非空数组');
}

need(meta.readme?.heroZh, 'readme.heroZh');
need(meta.readme?.heroEn, 'readme.heroEn');
need(meta.readme?.ctaZh, 'readme.ctaZh');
need(meta.readme?.ctaEn, 'readme.ctaEn');
need(meta.externalListing?.en, 'externalListing.en');
need(meta.externalListing?.zh, 'externalListing.zh');

if (meta.packageName !== JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name) {
  errors.push('marketing.packageName 与 package.json.name 不一致');
}

if (errors.length > 0) {
  console.error('check-marketing 失败：');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log('check-marketing 通过：marketing/metadata.json 结构合法。');
