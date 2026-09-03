/**
 * Host 耐久导出制品。
 *
 * DSH rc.2 / alpha.2 已验证的 fs seam 只提供原子 writeText 与有界
 * readBytes，没有稳定的二进制写接口。因此 CSV 以 UTF-8 文本保存，XLSX
 * 先生成真实工作簿，再以 Base64 文本保存，下载时还原为原始字节。
 */
import { createHash, randomUUID } from 'node:crypto';
import XLSX from 'xlsx';

const ROOT = '.dsh-data-cleaning-artifacts/v1';
const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
// Base64 最坏会把二进制扩大到 4/3；readBytes 必须允许读取完整编码文本，
// 再对解码后的真实制品执行 MAX_ARTIFACT_BYTES 限制。
const MAX_STORED_BYTES = Math.ceil(MAX_ARTIFACT_BYTES / 3) * 4 + 4;
const SAFE_ID = /^(?:dcw|dca)-[a-zA-Z0-9-]{8,80}$/;

export class ArtifactError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'ArtifactError';
    this.code = code;
    this.status = status;
  }
}

function safeFilePart(value, fallback) {
  const text = String(value ?? '').trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  return text || fallback;
}

function assertId(value, label) {
  const id = String(value ?? '');
  if (!SAFE_ID.test(id)) throw new ArtifactError('DC_ARTIFACT_ID_INVALID', `${label} is invalid.`, 400);
  return id;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function normalizeHeaders(headers, rows) {
  const fromInput = Array.isArray(headers) ? headers.map((item) => String(item ?? '').trim()).filter(Boolean) : [];
  const discovered = [];
  const seen = new Set(fromInput);
  for (const row of rows) {
    for (const key of Object.keys(row ?? {})) {
      if (!seen.has(key)) {
        seen.add(key);
        discovered.push(key);
      }
    }
  }
  return [...fromInput, ...discovered].slice(0, 256);
}

function normalizeRows(value) {
  if (!Array.isArray(value)) throw new ArtifactError('DC_ARTIFACT_ROWS_REQUIRED', 'Export rows must be an array.', 400);
  if (value.length > 100_000) throw new ArtifactError('DC_ARTIFACT_ROWS_TOO_MANY', 'Export is limited to 100,000 rows.', 413);
  const normalizeCell = (cell) => {
    if (cell === null || cell === undefined) return '';
    if (cell instanceof Date) return cell.toISOString();
    if (typeof cell === 'number' || typeof cell === 'boolean') return cell;
    if (typeof cell === 'string') return cell.slice(0, 32_767);
    try {
      const serialized = JSON.stringify(cell);
      return String(serialized ?? cell).slice(0, 32_767);
    } catch {
      return String(cell).slice(0, 32_767);
    }
  };
  return value.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return { value: normalizeCell(row) };
    return Object.fromEntries(Object.entries(row).slice(0, 256).map(([key, cell]) => [String(key), normalizeCell(cell)]));
  });
}

function exceptionReason(row) {
  const status = String(
    row?.qcc_match_status
      ?? row?.match_status
      ?? row?.['匹配状态']
      ?? '',
  ).trim().toLowerCase();
  const error = row?.qcc_error ?? row?.error ?? row?.['错误原因'];
  if (error) return String(error).slice(0, 500);
  if (['candidate', 'ambiguous', 'review_required'].includes(status)) return '存在多个候选主体，需人工核验';
  if (['unresolved', 'not_found'].includes(status)) return '未匹配到可验证主体';
  if (['failed', 'error', 'partial'].includes(status)) return '匹配或补全未完成';
  return '';
}

export function deriveExceptionRows(rows) {
  return rows.flatMap((row) => {
    const reason = exceptionReason(row);
    return reason ? [{ ...row, _exception_reason: reason }] : [];
  });
}

function workbookBytes(rows, headers, sheetName) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers, skipHeader: false });
  worksheet['!cols'] = headers.map((header) => ({ wch: Math.min(42, Math.max(12, String(header).length * 2 + 4)) }));
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  workbook.Props = {
    Title: sheetName,
    Subject: 'DeepSeek Harness 数据清洗补全智能体导出',
    Author: 'dsh-data-cleaning-agent',
    Company: 'QCC',
  };
  return Buffer.from(XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
    compression: true,
    cellDates: true,
  }));
}

function csvBytes(rows, headers) {
  const escapeCell = (value) => {
    let text = String(value ?? '');
    // 防止 Excel / LibreOffice 将外部数据解释为公式。数字类型不经过此前缀；
    // 以危险字符开头的文本保留原值但加前导单引号。
    if (/^[\u0009\u000d\u000a ]*[=+\-@]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const lines = [
    headers.map(escapeCell).join(','),
    ...rows.map((row) => headers.map((header) => escapeCell(row?.[header])).join(',')),
  ];
  return Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8');
}

function artifactDescriptor({ id, kind, format, fileName, rowCount, bytes, createdAt }) {
  return {
    id,
    kind,
    format,
    fileName,
    rowCount,
    sizeBytes: bytes.length,
    checksum: `sha256:${sha256(bytes)}`,
    mediaType: format === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'text/csv; charset=utf-8',
    createdAt,
  };
}

export class WorkflowArtifactStore {
  constructor({ fs, nowFn = () => new Date().toISOString(), idFactory = () => `dca-${randomUUID()}` }) {
    if (!fs) throw new ArtifactError('DC_ARTIFACT_UNAVAILABLE', 'DSH fs service unavailable.', 503);
    this.fs = fs;
    this.nowFn = nowFn;
    this.idFactory = idFactory;
  }

  pathFor(taskId, artifact) {
    const safeTaskId = assertId(taskId, 'taskId');
    const artifactId = assertId(artifact.id, 'artifactId');
    const suffix = artifact.format === 'xlsx' ? 'xlsx.b64' : 'csv';
    return `${ROOT}/${safeTaskId}/${artifactId}.${suffix}`;
  }

  async write(taskId, descriptor, bytes) {
    if (bytes.length > MAX_ARTIFACT_BYTES) {
      throw new ArtifactError('DC_ARTIFACT_TOO_LARGE', 'Generated artifact exceeds the 32 MiB limit.', 413);
    }
    const target = await this.fs.resolve(this.pathFor(taskId, descriptor));
    const content = descriptor.format === 'xlsx' ? bytes.toString('base64') : bytes.toString('utf8');
    await this.fs.writeText(target, content);
    return descriptor;
  }

  async createBundle(taskId, input = {}) {
    assertId(taskId, 'taskId');
    const rows = normalizeRows(input.rows);
    const headers = normalizeHeaders(input.headers, rows);
    if (!headers.length) throw new ArtifactError('DC_ARTIFACT_HEADERS_REQUIRED', 'At least one export column is required.', 400);
    const exceptions = input.exceptionRows === undefined
      ? deriveExceptionRows(rows)
      : normalizeRows(input.exceptionRows);
    const exceptionHeaders = normalizeHeaders([...headers, '_exception_reason'], exceptions);
    const baseName = safeFilePart(input.baseName, '数据清洗补全结果');
    const timestamp = this.nowFn();
    const definitions = [
      { kind: 'complete', format: 'csv', fileName: `${baseName}.csv`, rows, headers, sheet: '清洗补全结果' },
      { kind: 'complete', format: 'xlsx', fileName: `${baseName}.xlsx`, rows, headers, sheet: '清洗补全结果' },
      { kind: 'review', format: 'csv', fileName: `${baseName}-异常清单.csv`, rows: exceptions, headers: exceptionHeaders, sheet: '异常清单' },
      { kind: 'review', format: 'xlsx', fileName: `${baseName}-异常清单.xlsx`, rows: exceptions, headers: exceptionHeaders, sheet: '异常清单' },
    ];
    const artifacts = [];
    for (const definition of definitions) {
      const bytes = definition.format === 'xlsx'
        ? workbookBytes(definition.rows, definition.headers, definition.sheet)
        : csvBytes(definition.rows, definition.headers);
      const descriptor = artifactDescriptor({
        id: this.idFactory(),
        kind: definition.kind,
        format: definition.format,
        fileName: definition.fileName,
        rowCount: definition.rows.length,
        bytes,
        createdAt: timestamp,
      });
      await this.write(taskId, descriptor, bytes);
      artifacts.push(descriptor);
    }
    return artifacts;
  }

  async read(taskId, artifact) {
    const target = await this.fs.resolve(this.pathFor(taskId, artifact));
    const storedLimit = artifact.format === 'xlsx' ? MAX_STORED_BYTES : MAX_ARTIFACT_BYTES;
    const stored = Buffer.from(await this.fs.readBytes(target, undefined, storedLimit));
    const bytes = artifact.format === 'xlsx'
      ? Buffer.from(stored.toString('utf8'), 'base64')
      : stored;
    if (bytes.length > MAX_ARTIFACT_BYTES) {
      throw new ArtifactError('DC_ARTIFACT_TOO_LARGE', 'Stored artifact exceeds the 32 MiB limit.', 413);
    }
    const actual = `sha256:${sha256(bytes)}`;
    if (artifact.checksum && actual !== artifact.checksum) {
      throw new ArtifactError('DC_ARTIFACT_CHECKSUM', 'Stored artifact checksum verification failed.', 409);
    }
    return bytes;
  }
}

export const ARTIFACT_STORAGE = Object.freeze({
  root: ROOT,
  maxBytes: MAX_ARTIFACT_BYTES,
  maxStoredBytes: MAX_STORED_BYTES,
});
