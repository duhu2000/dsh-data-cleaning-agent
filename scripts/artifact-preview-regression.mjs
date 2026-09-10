// Synthetic HTML only; no running Host, private datasets, or paid calls.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(resolve(process.env.DCQ_PLAYWRIGHT || 'node_modules/playwright', 'index.mjs')));
import { renderArtifactPreview } from '../lib/artifact-preview.js';
const columns = ['企业名称', ...Array.from({ length: 44 }, (_, i) => `字段${i}`)];
const rows = Array.from({ length: 50 }, (_, i) => Object.fromEntries(columns.map((c, j) => [c,
  j === 0 ? `测试企业${i}` : j === 20 ? '很长的经营范围\n'.repeat(200) : `${i}-${j}`])));
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [390, 800, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 700 } });
    await page.setContent(renderArtifactPreview({ fileName: '结果.xlsx', taskId: 'fixture', rowCount: 50, columns, rows, download: '/download' }));
    const before = await page.evaluate(() => {
      const grid = document.querySelector('.grid');
      return { width: grid.clientWidth, scrollWidth: grid.scrollWidth, height: grid.clientHeight, scrollHeight: grid.scrollHeight,
        rowHeight: document.querySelector('tbody tr').getBoundingClientRect().height,
        top: document.querySelector('thead th').getBoundingClientRect().top,
        pageOverflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.ok(before.scrollWidth > before.width);
    assert.ok(before.scrollHeight > before.height);
    assert.ok(before.rowHeight <= 40, `Long text must not stretch rows: ${before.rowHeight}`);
    assert.equal(before.pageOverflow, false);
    await page.locator('.grid').evaluate(el => { el.scrollTop = 600; el.scrollLeft = 400; });
    const after = await page.evaluate(() => ({ top: document.querySelector('thead th').getBoundingClientRect().top,
      left: document.querySelector('.grid').scrollLeft, scrollTop: document.querySelector('.grid').scrollTop }));
    assert.ok(Math.abs(after.top - before.top) < 2, 'Header remains fixed');
    assert.equal(after.left, 400);
    assert.equal(after.scrollTop, 600);
    console.log(`PASS ${width}px: compact rows, two-axis scrolling, fixed header`);
    await page.close();
  }
} finally { await browser.close(); }
