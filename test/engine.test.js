/**
 * 引擎单元测试（node:test，无 DSH 依赖）。
 * 覆盖：CSV 解析（引号/换行/BOM）、JSON 解析、清洗（缺失/负金额/去重）、
 * 补全（确定性填充 + 不可补全标记）、概览、CSV 回写。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCsv,
  parseJson,
  detectFormat,
  normalizePhone,
  cleanRows,
  completeRows,
  profileRows,
  toCsv,
} from '../lib/engine.js';

test('parseCsv: 基本表头+行', () => {
  const { headers, rows } = parseCsv('name,phone,amount\n张三,13800000001,100\n李四,13800000002,200');
  assert.deepEqual(headers, ['name', 'phone', 'amount']);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, '张三');
  assert.equal(rows[0].amount, '100');
});

test('parseCsv: 引号字段含逗号与转义引号', () => {
  const { rows } = parseCsv('name,note\n"a,b",x\n"say ""hi""",y');
  assert.equal(rows[0].name, 'a,b');
  assert.equal(rows[0].note, 'x');
  assert.equal(rows[1].name, 'say "hi"');
});

test('parseCsv: 引号字段内含换行', () => {
  const { rows } = parseCsv('name,note\n张三,"第一行\n第二行"');
  assert.equal(rows[0].note, '第一行\n第二行');
});

test('parseCsv: BOM 与 CRLF', () => {
  const { headers, rows } = parseCsv('\uFEFFname,phone\r\n张三,138\r\n');
  assert.equal(headers[0], 'name');
  assert.equal(rows[0].phone, '138');
});

test('parseCsv: 空输入', () => {
  assert.deepEqual(parseCsv(''), { headers: [], rows: [] });
});

test('parseJson: 对象数组', () => {
  const { headers, rows } = parseJson('[{"name":"a","amount":"1"},{"name":"b","amount":"2"}]');
  assert.deepEqual(headers, ['name', 'amount']);
  assert.equal(rows.length, 2);
});

test('detectFormat', () => {
  assert.equal(detectFormat('a.xlsx'), 'xlsx');
  assert.equal(detectFormat('a.csv'), 'csv');
  assert.equal(detectFormat('a.json'), 'json');
  assert.equal(detectFormat('a.txt'), 'csv');
});

test('normalizePhone', () => {
  assert.equal(normalizePhone(' 138-0000-0001 '), '13800000001');
  assert.equal(normalizePhone(''), '');
});

test('cleanRows: 缺失必填、负金额、去重', () => {
  const rows = [
    { name: '张三', phone: '13800000001', amount: '100' },
    { name: '', phone: '13800000002', amount: '100' },   // missing name
    { name: '李四', phone: '', amount: '100' },           // missing phone
    { name: '王五', phone: '13800000003', amount: '-50' }, // bad amount
    { name: '赵六', phone: '13800000004', amount: 'abc' }, // bad amount
    { name: '张三', phone: '13800000001', amount: '999' }, // duplicate
  ];
  const r = cleanRows(rows);
  assert.equal(r.total, 6);
  assert.equal(r.kept, 1);
  assert.equal(r.dropped, 5);
  assert.equal(r.badMissing, 2);
  assert.equal(r.badAmount, 2);
  assert.equal(r.badDuplicate, 1);
});

test('cleanRows: 手机号规范化', () => {
  const r = cleanRows([{ name: '张三', phone: ' 138-0000-0001 ', amount: '100' }]);
  assert.equal(r.kept, 1);
  assert.equal(r.cleaned[0].phone, '13800000001');
});

test('completeRows: 确定性填充 + 不可补全标记', () => {
  const rows = [
    { name: '张三', phone: '138-0000-0001', amount: '100' },
    { name: '', phone: '13800000002', amount: '' },
    { name: '李四', phone: '', amount: '50' },
  ];
  const r = completeRows(rows);
  assert.equal(r.total, 3);
  assert.equal(r.fillStats.amount, 1);
  assert.equal(r.fillStats.name, 1);
  assert.equal(r.fillStats.phoneNormalized, 1);
  assert.equal(r.completed[0].phone, '13800000001');
  assert.equal(r.completed[1].name, '未命名');
  assert.equal(r.completed[1].amount, '0');
  assert.equal(r.incompleteCount, 1); // 李四缺 phone
  assert.deepEqual(r.incomplete[0].fields, ['phone']);
});

test('profileRows: 列统计与金额分布', () => {
  const rows = [
    { name: 'a', phone: '1', amount: '10' },
    { name: 'b', phone: '2', amount: '30' },
    { name: '', phone: '2', amount: '20' },
  ];
  const p = profileRows(rows);
  assert.equal(p.rowCount, 3);
  assert.equal(p.columnCount, 3);
  const amount = p.columns.find((c) => c.name === 'amount');
  assert.equal(amount.missing, 0);
  const name = p.columns.find((c) => c.name === 'name');
  assert.equal(name.missing, 1);
  assert.equal(name.distinct, 2);
  assert.equal(p.amountStats.min, 10);
  assert.equal(p.amountStats.max, 30);
  assert.equal(p.amountStats.sum, 60);
});

test('toCsv: 转义与表头', () => {
  const csv = toCsv(['name', 'note'], [{ name: 'a,b', note: 'x"y' }]);
  assert.match(csv, /^name,note\r\n/);
  assert.match(csv, /"a,b","x""y"/);
});
