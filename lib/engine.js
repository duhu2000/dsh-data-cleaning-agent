/**
 * 数据清洗补全引擎（纯函数，无 DSH 依赖，可在 node:test 中直接测试）。
 *
 * 设计约束：
 * - 输入统一为「表头 + 行对象数组」，所有值先规范化为 string。
 * - 清洗（clean）只会「丢弃 + 规范化」，绝不编造数据。
 * - 补全（complete）只补「可由确定性规则推出的值」，补不出的字段留在
 *   `_incomplete` 列表里明示，绝不编造。
 * - 引擎层返回完整明细（供下载/入库），模型工具层只回摘要（安全边界在工具层）。
 */

/** 去掉 BOM、按 CSV/RFC4180 子集解析为 { headers, rows }。 */
export function parseCsv(text) {
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  const records = [];
  let field = '';
  let row = [];
  let inQuotes = false;

  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { records.push(row); row = []; };

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      pushField();
    } else if (ch === '\n') {
      pushField(); pushRow();
    } else if (ch === '\r') {
      if (src[i + 1] === '\n') i += 1;
      pushField(); pushRow();
    } else {
      field += ch;
    }
  }
  // 末尾无换行时的最后一行
  if (field !== '' || row.length > 0) { pushField(); pushRow(); }

  // 去掉全空行
  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ''));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const headers = nonEmpty[0].map((h, i) => (String(h).trim() || `col_${i + 1}`));
  const rows = nonEmpty.slice(1).map((r) => {
    const o = {};
    headers.forEach((h, i) => { o[h] = r[i] === undefined ? '' : String(r[i]); });
    return o;
  });
  return { headers, rows };
}

/** 懒加载 xlsx：仅在真正解析 XLS/XLSX 时才 require，headless 无此依赖也不受影响。 */
export async function parseXlsx(buffer) {
  let XLSX;
  try {
    ({ default: XLSX } = await import('xlsx'));
  } catch {
    const err = new Error('xlsx dependency not available in this composition');
    err.code = 'XLSX_UNAVAILABLE';
    throw err;
  }
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', raw: false });
  if (!aoa.length) return { headers: [], rows: [] };
  const headers = aoa[0].map((h, i) => (String(h ?? '').trim() || `col_${i + 1}`));
  const rows = aoa.slice(1).map((r) => {
    const o = {};
    headers.forEach((h, i) => { o[h] = r[i] === undefined || r[i] === null ? '' : String(r[i]); });
    return o;
  });
  return { headers, rows };
}

export function detectFormat(filename) {
  const name = String(filename ?? '').toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return 'xlsx';
  if (name.endsWith('.csv') || name.endsWith('.txt')) return 'csv';
  if (name.endsWith('.json')) return 'json';
  return 'csv'; // 默认按 CSV 文本处理
}

export function parseJson(text) {
  let parsed;
  try { parsed = JSON.parse(String(text ?? '')); } catch {
    const err = new Error('invalid JSON body'); err.code = 'BAD_JSON'; throw err;
  }
  const rows = Array.isArray(parsed) ? parsed : (parsed?.rows ?? []);
  if (!rows.length) return { headers: [], rows: [] };
  const headers = [...new Set(rows.flatMap((r) => (r && typeof r === 'object' ? Object.keys(r) : [])))];
  const norm = rows.map((r) => {
    const o = {};
    headers.forEach((h) => { o[h] = r?.[h] === undefined || r?.[h] === null ? '' : String(r[h]); });
    return o;
  });
  return { headers, rows: norm };
}

/** 规范化单个字符串值：trim、把 undefined/null 归一为 ''。 */
function norm(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

/** 规范化手机号：去空格/连字符，保留数字。 */
export function normalizePhone(value) {
  return norm(value).replace(/[\s-]/g, '');
}

/**
 * 清洗一批行。opts:
 * - required: string[]，缺失即丢弃（默认 ['name','phone']）
 * - amountField: string（默认 'amount'）
 * - dedupeOn: string|null，按该字段去重、保留首个（默认 'phone'）
 * - phoneField: string|null，需要做手机号规范化的列（默认 'phone'）
 */
export function cleanRows(rows, opts = {}) {
  const required = opts.required ?? ['name', 'phone'];
  const amountField = opts.amountField ?? 'amount';
  const dedupeOn = opts.dedupeOn === undefined ? 'phone' : opts.dedupeOn;
  const phoneField = opts.phoneField === undefined ? 'phone' : opts.phoneField;

  const input = Array.isArray(rows) ? rows : [];
  const cleaned = [];
  const seen = new Set();
  let badMissing = 0;
  let badAmount = 0;
  let badDuplicate = 0;

  for (const raw of input) {
    const row = {};
    for (const [k, v] of Object.entries(raw ?? {})) row[k] = norm(v);
    if (phoneField && phoneField in row) row[phoneField] = normalizePhone(row[phoneField]);

    // 1) 必填字段
    const missing = required.filter((f) => !row[f]);
    if (missing.length > 0) { badMissing += 1; continue; }

    // 2) 金额合法（非数字或负值丢弃）
    if (amountField in row && row[amountField] !== '') {
      const amount = Number(row[amountField]);
      if (!Number.isFinite(amount) || amount < 0) { badAmount += 1; continue; }
    }

    // 3) 去重
    if (dedupeOn && row[dedupeOn]) {
      const key = row[dedupeOn];
      if (seen.has(key)) { badDuplicate += 1; continue; }
      seen.add(key);
    }

    cleaned.push(row);
  }

  return {
    total: input.length,
    kept: cleaned.length,
    dropped: badMissing + badAmount + badDuplicate,
    badMissing,
    badAmount,
    badDuplicate,
    cleaned,
  };
}

/**
 * 补全一批行（确定性规则，不编造）。
 * - amount 空 → '0'
 * - name 空 → placeholder（默认 '未命名'）
 * - phone 仅做规范化；补不出真实号码的记入 `_incomplete`
 * 返回完整明细 + 分字段补全统计。
 */
export function completeRows(rows, opts = {}) {
  const amountField = opts.amountField ?? 'amount';
  const phoneField = opts.phoneField === undefined ? 'phone' : opts.phoneField;
  const namePlaceholder = opts.namePlaceholder ?? '未命名';
  const fillableName = opts.fillableName === undefined ? true : opts.fillableName;

  const input = Array.isArray(rows) ? rows : [];
  const completed = [];
  const fillStats = { name: 0, amount: 0, phoneNormalized: 0 };
  const incomplete = [];

  for (let i = 0; i < input.length; i += 1) {
    const raw = input[i] ?? {};
    const row = {};
    let incompleteFields = [];

    for (const [k, v] of Object.entries(raw)) {
      const s = norm(v);
      if (k === amountField && s === '') { row[k] = '0'; fillStats.amount += 1; }
      else if (k === 'name' && s === '' && fillableName) { row[k] = namePlaceholder; fillStats.name += 1; }
      else row[k] = s;
    }

    if (phoneField in row) {
      const before = row[phoneField];
      row[phoneField] = normalizePhone(row[phoneField]);
      if (row[phoneField] !== before) fillStats.phoneNormalized += 1;
      if (!row[phoneField]) incompleteFields.push(phoneField);
    }
    if ('name' in row && !row.name) incompleteFields.push('name');
    if (amountField in row && row[amountField] === '') incompleteFields.push(amountField);

    row._rowIndex = i;
    if (incompleteFields.length > 0) {
      row._incomplete = incompleteFields;
      incomplete.push({ rowIndex: i, fields: incompleteFields });
    }
    completed.push(row);
  }

  return {
    total: input.length,
    completed: completed.length,
    incompleteCount: incomplete.length,
    fillStats,
    incomplete,
    completed,
  };
}

/** 概览统计：列级缺失/去重 + amount 数值分布。 */
export function profileRows(rows, opts = {}) {
  const amountField = opts.amountField ?? 'amount';
  const input = Array.isArray(rows) ? rows : [];
  const columns = new Map();
  const amounts = [];

  for (const raw of input) {
    const entries = Object.entries(raw ?? {});
    for (const [k, v] of entries) {
      if (!columns.has(k)) columns.set(k, { present: 0, missing: 0, distinct: new Set() });
      const s = norm(v);
      const col = columns.get(k);
      if (s === '') col.missing += 1;
      else { col.present += 1; col.distinct.add(s); }
    }
    if (amountField in (raw ?? {})) {
      const n = Number(norm(raw[amountField]));
      if (Number.isFinite(n)) amounts.push(n);
    }
  }

  const columnStats = [...columns.entries()].map(([name, c]) => ({
    name,
    present: c.present,
    missing: c.missing,
    distinct: c.distinct.size,
  }));

  let amountStats = null;
  if (amounts.length > 0) {
    const sorted = [...amounts].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    amountStats = {
      count: sorted.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      sum,
      mean: sum / sorted.length,
    };
  }

  return { rowCount: input.length, columnCount: columns.size, columns: columnStats, amountStats };
}

/** 明细 → CSV 文本（下载用）。 */
export function toCsv(headers, rows) {
  const hs = headers && headers.length ? headers : (rows[0] ? Object.keys(rows[0]) : []);
  const escape = (v) => {
    const s = String(v ?? '');
    if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [hs.map(escape).join(',')];
  for (const r of rows) lines.push(hs.map((h) => escape(r[h] ?? '')).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
