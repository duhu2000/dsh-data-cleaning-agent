# Spike #4 — Job / Storage 双基线验证

> 状态：**PASS（双基线同构）**　探针：`spike4/plugin`（`@qcc/dsh-data-cleaning-agent@0.0.4-spike4`）
> 基线：`dsh 0.1.1-rc.2`（端口 43126）　`0.1.2-alpha.2`（端口 43127），均为隔离 `DSH_HOME` + `web` profile

## 1. 结论摘要

| 验证项 | rc.2 | alpha.2 | 说明 |
|---|---|---|---|
| `ctx.jobs` 服务 present（`jobs` registry） | ✅ | ✅ | `@deepseek-ai/dsh-jobs-local` 提供，服务 id `jobs` |
| `ctx.storage` / `ctx.storageDomain` present | ✅ | ✅ | web profile 默认即挂载（storage hub + json backend + domain facility） |
| Job 状态机：start→wait→read（completed） | ✅ | ✅ | `wait` 返回终端快照，`read` 返回 `{text, snapshot}` |
| Job 取消：kill→wait（killed，detail 透传） | ✅ | ✅ | `kill` 返回 `requested`，终端态 `killed` |
| Job 列表 `list(caller)` | ✅ | ✅ | owner 过滤，无主 job 对任意 caller 可见 |
| 未挂 controller 时 `start()` 拒绝 | ✅ | ✅ | `background jobs unavailable: no job controller serves this agent` |
| host bundle 自行 `attachController` 后放行 | ✅ | ✅ | 无主（owner=undefined）job 可在全局层启动 |
| Storage domain 写读改删（put/get/update/delete/entries/size） | ✅ | ✅ | 写串行化，先落盘后改内存，再发 `domain/changed` |
| 单开保护：重开同名 domain | ✅ | ✅ | `already-open` |
| 关后重开（同进程"重启"）读回 | ✅ | ✅ | 记录完整（含 update 后状态） |
| Schema 拒绝：违例记录重开 | ✅ | ✅ | `invalid-record`，带 domain/table/key 定位 |
| 版本迁移门禁：version 不符重开 | ✅ | ✅ | `version-mismatch`，`stored version 1 != expected 2` |
| 跨进程重启恢复（seed→重启→read） | ✅ | ✅ | `recovered: true`，JSON 落盘于 `DSH_HOME/storages/<domain>.json` |

## 2. 关键 seam 契约（一手源码 + 实测）

### 2.1 `ctx.jobs`（服务 id `jobs`，`@deepseek-ai/dsh-jobs-local`）

- `JobRegistry` 抽象基类（`@deepseek-ai/dsh-jobs`）只声明 `Service(ctx, "jobs")`；实现在 `dsh-jobs-local`。
- 公开方法（web profile 全部可用）：
  - `start(spec)` → `JobId`；`spec = { kind, label, owner?, outputLimitBytes?, run() }`，`run()` 同步返回 hooks `{ done: Promise<outcome>, cancel(reason), readOutput?() }`。
  - `list(caller)`、`get(id, caller)`、`read(id, caller)` → `{ text, snapshot }`、`kill(id, caller, reason)`、`wait(id, timeoutMs, caller, signal)`。
  - `attachController(name)`、`onJobDone(listener)`、`onJobsChanged(listener)`。
- 终端态 = `completed | killed | failed`；`settle()` 首胜（first-wins），`cancel` 抛错会强制置 `failed`。
- **owner/controller 门禁（关键发现）**：
  - `start()` 要求"某个已挂 controller 服务该 owner"，否则抛 `background jobs unavailable: no job controller serves this agent (load @deepseek-ai/dsh-tool-jobs in its composition)`。
  - `dsh-tool-jobs` 是 agent 侧工具，它通过 `ctx.jobs.attachController("tool-jobs")` 挂载 controller；**web profile 裸基线下没有任何 controller 处于激活作用域**，故 host bundle 直接 `start()` 会被拒。
  - **解法**：host bundle 自己在全局层调 `ctx.jobs.attachController("<my-name>")`，即可服务 owner=undefined 的无主 job（实测放行）。
  - 有主 job（owner 为 live agent）需 `dsh-agent` 注册表 + 该 agent 组合内加载 `dsh-tool-jobs`；本 spike 不引入 agent，只用无主 job 验证了生命周期。

### 2.2 `ctx.storageDomain`（`@deepseek-ai/dsh-storage-domain`）

- `storage-domain` plugin（`inject=["storage"]`）在 web profile 默认挂载，`backend: json`；`storage-json` 落盘根 `dshHomePath('storages')`，每 domain 一个 `<name>.json`，原子整文件替换。
- facility API：`open(spec)` → Domain handle；`get(name)`；`closeAll()`。
- Domain handle：
  - `table(name)` → `{ get(key), put(key,value), delete(key)→bool, update(key,fn), entries(), keys(), size }`（读同步，写 await，串行链）。
  - `global` → `{ get(), set(value) }`（spec 声明 `global` 时才有；`global` schema 不得接受 `null`，因 `null` 是"未写"哨兵）。
  - `close()` 幂等，排空写链后关 unit。
- `defineDomain(spec)` + `domainTable(zodSchema)`：`spec = { name, version(≥0 整数), tables, global? }`；`name`/表名匹配 `^[a-z][a-z0-9_]*$`。记录 schema 用 zod（`z.infer` 同源投射 RPC wire schema）；插件 `Config` 仍是 schemastery。
- **校验时点（关键发现）**：schema 校验发生在 `open()` 的 `loadAll()` 阶段（读入即 `parse`），而非 `put()` 时。故：
  - 历史/旧数据违例 → `open` 抛 `invalid-record`（带 table/key 定位）——即"schema 迁移"的拒收信号，插件需在 `open` 捕获并自行迁移或降级。
  - 版本不符 → `open` 抛 `version-mismatch`（`stored version N != expected M`）——版本迁移门禁。
  - 写路径 `put/update` 不重校验，直接落盘；但落盘失败会回滚内存，不发事件。

## 3. 对数据清洗 Agent 的落点

- **清洗任务的持久化状态机**：用 `ctx.storageDomain` 定义 `data_cleaning_jobs` domain（version 语义化，表 `jobs` 存 job 记录、`global` 存游标/配置），天然获得：幂等 `put`/`update(fn)`、单开保护、原子落盘、跨重启恢复。
- **后台执行**：轻量异步可用 `ctx.jobs`（无主 job，host bundle 自挂 controller）；但若需"归因到某个 agent 会话"或"由 agent 工具触发的长任务"，则依赖 `dsh-tool-jobs` 在 agent 组合内——那是 Spike #5（工具闭环）再验证的路径。
- **schema 演进**：新版本改 `version` + zod schema，`open` 抛 `version-mismatch`/`invalid-record` 即迁移钩子；迁移后重开才可用。

## 4. 复现

```bash
# 探针：spike4/plugin（package.json + cordis.patch.yml + lib/index.js + lib/web.js）
pnpm pack  # → spike4/qcc-dsh-data-cleaning-agent-0.0.4-spike4.tgz
DSH_HOME=spike4/home-rc2    dsh    plugin --profile web add ../qcc-dsh-data-cleaning-agent-0.0.4-spike4.tgz
DSH_HOME=spike4/home-alpha2 node spike1/cli-alpha2/.../lib/bin.js plugin --profile web add ../....tgz
DSH_HOME=spike4/home-rc2    dsh    --profile web --port 43126 --no-open &
DSH_HOME=spike4/home-alpha2 node .../lib/bin.js --profile web --port 43127 --no-open &

curl http://127.0.0.1:43126/data-cleaning/api/spike4/seam
curl http://127.0.0.1:43126/data-cleaning/api/spike4/jobs/demo
curl http://127.0.0.1:43126/data-cleaning/api/spike4/storage/demo
curl http://127.0.0.1:43126/data-cleaning/api/spike4/storage/seed   # 写一条
# 重启进程
curl http://127.0.0.1:43126/data-cleaning/api/spike4/storage/read   # recovered:true
```

路由前缀沿用 Spike #2/#3 的 `/data-cleaning/api/*`，双基线均无 token 门禁（token 差异仅作用于根 HTML 与 client bundle URL，见 5c）。
