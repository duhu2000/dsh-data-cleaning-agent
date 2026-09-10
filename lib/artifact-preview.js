// Read-only CSV-style preview: preserve values, but never wrap long cells.
export function renderArtifactPreview({ fileName, taskId, rowCount, columns, rows, download }) {
  const escape = value => String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(fileName)}</title><style>
*{box-sizing:border-box}
html,body{height:100%;margin:0;overflow:hidden}
body{font:14px system-ui;color:#243044;display:flex;flex-direction:column;padding:16px;gap:12px}
header{flex:none;min-width:0}h1{font-size:18px;margin:0 0 8px;overflow-wrap:anywhere}p{margin:0 0 8px;color:#66758b;font-size:12px;overflow-wrap:anywhere}a{color:#0875ce}
.grid{flex:1;min-height:0;min-width:0;overflow:auto;scrollbar-gutter:stable;border:1px solid #dde5ef;border-radius:6px}
table{border-collapse:separate;border-spacing:0;table-layout:auto;width:max-content;min-width:100%}
td,th{white-space:nowrap;word-break:normal;overflow-wrap:normal;vertical-align:middle;min-width:100px;height:34px;padding:7px 12px;border-right:1px solid #dde5ef;border-bottom:1px solid #dde5ef;text-align:left;line-height:20px}
thead th{position:sticky;top:0;z-index:2;background:#e5f3ff;box-shadow:0 1px 0 #c7d8e8}
tbody tr:nth-child(even){background:#f8fafc}tbody tr:hover{background:#edf6ff}
.row-number{min-width:48px;text-align:right;color:#66758b;background:#f3f7fb;position:sticky;left:0;z-index:1}thead .row-number{z-index:3;background:#e5f3ff}
.grid:focus-visible{outline:2px solid #0875ce;outline-offset:1px}
</style><header><h1>${escape(fileName)}</h1><p>任务 ${escape(taskId)} · 共 ${escape(rowCount)} 行 / ${columns.length} 列，当前预览 ${rows.length} 行（最多 50 行）；源文件未修改。左右滚动查看全部字段，表头固定。</p><a href="${escape(download)}">下载完整 Excel</a></header><div class="grid" role="region" aria-label="结果数据表格，可横向和纵向滚动" tabindex="0"><table><thead><tr><th class="row-number" scope="col">序号</th>${columns.map(c => `<th scope="col">${escape(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((row, i) => `<tr><th class="row-number" scope="row">${i + 1}</th>${columns.map(c => `<td>${escape(row[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></html>`;
}
