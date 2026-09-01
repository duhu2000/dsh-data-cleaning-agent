# 数据清洗补全智能体 · MVP 交付说明

> 基线：DSH 双基线 `0.1.1-rc.2`（本机） + `0.1.2-alpha.2`（官方最新预发布）。
> 结论：MVP 开发完成，双基线端到端验证全部 PASS。
> 日期：2026-08-31（本机时区）。

## 1. 交付物清单

| 路径 | 说明 |
| --- | --- |
| `plugin/` | 插件源码（`@qcc/dsh-data-cleaning-agent@0.1.0-mvp`） |
| `plugin/lib/engine.js` | 纯函数引擎：CSV/XLSX/JSON 解析 + 清洗/补全/画像，零 DSH 依赖 |
| `plugin/lib/tools.js` | 三个模型工具：`data_clean_rows` / `data_complete_rows` / `data_profile` |
| `plugin/lib/skill.js` | 内嵌 Skill：`data-cleaning`（正文指引模型按工作流调用工具） |
| `plugin/lib/jobs.js` | Job/Storage 状态机：`queued → running → completed | failed | killed` |
| `plugin/lib/web.js` | Host 半区 Web 路由 + UI（`/data-cleaning/` 与 `/data-cleaning/api/mvp/*`） |
| `plugin/lib/client.js` | Client 半区（`window.__ModuleLoader__.load`），seam 回环 |
| `plugin/lib/index.js` | 入口 `apply()`：tools/skills/web 三分区注入 |
| `plugin/cordis.patch.yml` | Bundle patch（insert 到 `@qcc/dsh-data-cleaning-agent`） |
| `plugin/package.json` | 双面契约：`dsh.bundle.patch` + `dsh.client`（`exports["./client"]`） |
| `plugin/test/engine.test.js` | 引擎单元测试（13 例，全部通过） |
| `qcc-dsh-data-cleaning-agent-0.1.0-mvp.tgz` | `pnpm pack` 产物（根目录，供 profile `file:` 安装） |

## 2. 核心能力

### 2.1 引擎（`engine.js`）

- `parseCsv`：RFC4180 子集（引号/逗号转义/CRLF）。
- `parseXlsx`：惰性 `await import('xlsx')`，依赖缺失抛 `XLSX_UNAVAILABLE`（不阻塞 CSV 路径）。
- `parseJson`：对象数组或 `{headers, rows}` 双形态。
- `normalizePhone`：去 `-`/空格/括号、`+86`/`0086` 前缀折叠、11 位校验。
- `cleanRows`：缺失必填 → 金额非法（非数字/负数）→ 重复（name+normalized phone）三级剔除，返回 `{total, kept, dropped, badMissing, badAmount, badDuplicate, cleaned}`。
- `completeRows`：缺失 name → `未命名`、缺失 amount → `0`、phone 归一化，返回 `{total, completed, fillStats}`。
- `profileRows`：列存在性/缺失率/去重数 + 数值列 min/max/sum/mean。
- `toCsv`：生成下载用 CSV（模型侧不回原文，只回摘要）。

### 2.2 工具（`tools.js`）

三个工具均 `output.render` + `output.schema`（对象级 `required`），参数经顶层 `required` 数组声明；执行只回摘要，不回原始行。

| 工具名 | 入参要点 | 输出 |
| --- | --- | --- |
| `data_clean_rows` | `rows`（对象数组）、`headers` | `{total, kept, dropped, badMissing, badAmount, badDuplicate}` |
| `data_complete_rows` | 同上 | `{total, completed, incompleteCount, name, amount, phoneNormalized}` |
| `data_profile` | 同上 | `{rowCount, columnCount, columns, amountStats}` |

### 2.3 Skill（`skill.js`）

- `data-cleaning`（kebab-case，合法名）。
- 正文是完整工作流：解析 → `data_profile` → `data_clean_rows` → 按需 `data_complete_rows` → 只报摘要。

### 2.4 Job/Storage 状态机（`jobs.js`）

- 落盘 domain `dc_tasks_v1`（version 1，table `jobs`，permissive schema）。
- `init()`：`jobs.attachController('data-cleaning-agent-mvp')` + `storageDomain.open(domainSpec())`。
- `start({kind, rows, headers})`：写 `queued` 记录 → `jobs.start` 后台执行 → `running` → `completed | failed | killed`。
- `list()` / `get(id)` / `dispose()`。
- 明细行只经内存闭包传给 `runSync`，**不回写持久 KV**（避免膨胀）。

### 2.5 Web 半区（`web.js` + `client.js`）

| 路由 | 方法 | 作用 | 状态 |
| --- | --- | --- | --- |
| `/data-cleaning/` | GET | MVP UI（四步工作台） | 200 |
| `/data-cleaning/api/mvp/seam` | GET | seam 能力报告（工具/技能/Jobs/Storage 在线状态） | 200 |
| `/data-cleaning/api/mvp/parse` | POST | 文件内容解析（filename + content） | 200 |
| `/data-cleaning/api/mvp/clean` | POST | 清洗（返回 CSV 下载） | 200 |
| `/data-cleaning/api/mvp/complete` | POST | 补全（返回 CSV 下载） | 200 |
| `/data-cleaning/api/mvp/profile` | POST | 画像（返回 JSON 摘要） | 200 |
| `/data-cleaning/api/mvp/jobs` | GET/POST | 任务列表 / 启动异步任务 | 200/202 |
| `/data-cleaning/api/mvp/job/<id>` | GET | 单任务详情 | 200 |

- `isTrusted(req)`：`sec-fetch-site !== 'cross-site'` 且 origin 限定 `127.0.0.1`/`localhost`（同源保护）。
- `readBody(req, 16MiB)`：有界读请求体。
- Client 半区 `window.__ModuleLoader__.load({id:'@qcc/dsh-data-cleaning-agent', factory})`，`window.__DC_MVP__` 暴露 seam 回环。

## 3. 验证结果

### 3.1 双基线 Web 冒烟（`/data-cleaning/api/*`）

| 基线 | 端口 | seam | parse | clean | complete | profile | jobs | job/<id> | UI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rc.2 | 43136 | 200 | 200 | 200 | 200 | 200 | 202/200 | 200 | 200 |
| alpha.2 | 43137 | 200 | 200 | 200 | 200 | 200 | 202/200 | 200 | 200 |

- seam 报告 `toolRegistered:true`、三个工具均 `registered:true`、`jobs:true`、`storageDomain:true`。
- 清洗实测：4 行脏数据 → `kept:2 dropped:2 badMissing:1 badAmount:1`。
- 补全实测：2 行 → `name:1 amount:1`（缺失补齐）。
- 画像实测：2 行 3 列，`amountStats {min:100 max:300 sum:400 mean:200}`。
- 异步任务实测：POST 返回 202 + id，任务状态由 `queued` → `running` → `completed`，单条详情 200。

### 3.2 双基线 Headless 端到端（真实模型）

| 基线 | 任务 | 结果 |
| --- | --- | --- |
| rc.2 | 7 行脏数据清洗 | `exit=0`，`kept:3 dropped:4`（missing 1 / bad-amount 2 / duplicate 1），只回摘要 |
| alpha.2 | 同上 | `exit=0`，session 记录 `skill` + `data_clean_rows`(×13) + `data_profile`(×10) + `data_complete_rows`(×1) |

- 模型自主经 `skill("data-cleaning")` 加载 Skill → 调度工具 → 只报摘要不回原文，双基线同构。

### 3.3 引擎单元测试

```
tests 13 / pass 13 / fail 0
```

## 4. 关键工程决策与踩坑

1. **Web 半区存在性守卫**：旧 `ctx.get('webServer') !== undefined` 在 web 组合中也会返回 `false`（非限定 host 上下文 `ctx.get` 看不到跨 bundle 服务）。修正为直接 `ctx.inject(['webServer','webRuntime','tools','skills','jobs','storageDomain'], cb)`，headless 组合下 inject 永不 resolve 但进程不崩溃。
2. **Inject 数组必须含 `jobs` + `storageDomain`**：`web.js` 的 jobs/job 路由依赖 `wctx.jobs` / `wctx.storageDomain`，不注入会同步抛 `cannot get property "jobs" without inject` → 400。
3. **cordis Logger 无 `.log`**：`LoggerService` 仅有 `error/info/warn/debug`，`logger.log` 会抛 `this.logger.log is not a function`，统一用 `.info`。
4. **前缀路由最长匹配**：`kind:'prefix'` 为最长前缀胜出，`/data-cleaning/api/mvp/jobs/`（尾斜杠）永远匹配不到 `/jobs/<id>`（需要 `startsWith(prefix + '/')`），详情路由改为 `/data-cleaning/api/mvp/job`（无尾斜杠）。
5. **pnpm `file:` 同版本不刷新**：`pnpm pack` 后须 `rm -rf node_modules pnpm-lock.yaml` 再 install，否则 node_modules 残留旧代码。
6. **模型不回原始行**：工具/详情只回摘要；原始行与清洗明细仅经同源 Web 同步端点（`clean/complete` 返回 CSV）供 UI 下载，不进入模型上下文。

## 5. 未决与后续

- XLSX 解析依赖 `xlsx@0.18.5`，仅 CSV 路径在本环境完整实测；XLSX 大文件异步化留产品阶段。
- 异步任务的明细结果（`result.rows`）当前经内存闭包消费、不落盘；如需"任务完成后下载明细"，需把结果写入 storage 表或临时文件（下一步）。
- 真实模型端到端仅在 headless 组合验证；web 组合内联的模型 dispatch seam 未接活 LLM（留产品阶段）。
- 不对外发布、未建 GitHub 仓库、未触碰生产 profile。
