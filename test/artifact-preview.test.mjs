import test from 'node:test';
import assert from 'node:assert/strict';
import { renderArtifactPreview } from '../lib/artifact-preview.js';

test('artifact preview is a compact, scrollable read-only grid with sticky headers', () => {
  const html = renderArtifactPreview({ fileName: '<报告>.xlsx', taskId: 'test', rowCount: 1,
    columns: ['企业', '收入', '备注'], rows: [{ 企业: '<script>alert(1)</script>', 收入: 0, 备注: '第一行\n第二行' }], download: '/artifact?a=1&b=2' });
  assert.match(html, /white-space:nowrap/);
  assert.match(html, /width:max-content/);
  assert.match(html, /overflow:auto/);
  assert.match(html, /thead th\{position:sticky;top:0/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<td>0<\/td>/);
  assert.match(html, /第一行\n第二行/);
  assert.match(html, /href="\/artifact\?a=1&amp;b=2"/);
  assert.doesNotMatch(html, /<script|pre-wrap/);
});
