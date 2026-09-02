# 数据清洗补全智能体 · DSH 入口 / UI / 交互 / MVP 规范调整方案

> 状态：**已批复并实施 M1–M3**（M1 入口克隆验证、M2 工作台视图、M3 交互闭环已落地；
> M4 验收+文档待收口）。§8.1 的 `dsh.client.inject` 变更已按批复执行。
> 触发：用户指示「暂不推进 Skill 扩展与更多数据工具维度清洗补全，先把 DSH 入口、UI 页面、
> 交互流程、MVP 实现规范调整方案做出来」；随后进一步指定「入口参考 MCP连接器 的位置，放在其下方」。
> 日期：2026-09-02（本机时区）。

## 0. 结论一句话

当前插件在 DSH **Web GUI 里没有可发现的第一公民入口**：`dsh.client.inject: []` 是空的、
`lib/client.js` 只做 seam 回环、唯一界面是手工敲 URL 才可达的裸 HTML 页（`/data-cleaning/`）。
本方案把「入口」对齐到已实装在生产 profile 的 **MCP连接器** 同款机制——即
`sidebar.footer.action`（侧边栏底部 list slot）+ `shell.overlay`（全屏面板），并把我们的入口
**排在该 MCP连接器之后（下方）**；「UI 页面」升级为挂进 DSH React 外壳的工作台（复用既有
`/data-cleaning/api/*` 计算后端）；同时把用户叫停的 **Skill 扩展** 与 **风险/知产/经营维度清洗补全**
显式挂起，不并入本轮。

---

## 1. 范围与叫停项

### 1.1 本轮范围（新优先主线）

| 编号 | 主题 | 交付物 |
| --- | --- | --- |
| E1 | DSH 入口 | `sidebar.footer.action` 侧边栏入口（排 MCP连接器下方）+ `shell.overlay` 工作台面板 |
| E2 | UI 页面 | React 客户端工作台（上传→解析→画像→清洗/补全→导出），复用 `/data-cleaning/api/*` 后端 |
| E3 | 交互流程 | 对话式 + 工作台式两条闭环，及任务/toolview 呈现 |
| E4 | MVP 实现 | 增量拆分 M1–M4（Spike #8 降级为「克隆验证」而非「探路」）与验收门 |

### 1.2 显式挂起（本轮不做）

1. **P1.2 Skill 扩展**（扩展 `enterprise-enrichment` 到风险/知产/经营域组）—— 挂起。
2. **更多数据工具维度清洗补全**（HANDOFF P1.3 及之后的风险 38 / 知产 18 / 经营 35 后台批量补全）—— 挂起。
3. 生产端口 `43120` 与已完成的 20 企业 / 400 次真实 QCC 调用 —— 一律不触碰、不重跑。

> 说明：挂起不等于删除。`lib/qcc-phase3.js` 的契约盘点（P1.1）成果保留，后续恢复时直接复用，
> 只是本轮不把它接进 Skill 或 Host Bridge 批量主路径。

---

## 2. 现状盘点（为什么需要本方案）

| 事实 | 证据 | 影响 |
| --- | --- | --- |
| `package.json` `dsh.client.inject: []` | 根 `package.json` L87-95 | 客户端半区无依赖注入，也**没有声明任何 GUI 贡献** |
| `lib/client.js` 只回环 seam | `lib/client.js` L7-38 | 客户端 `apply(ctx)` 仅 `fetch('/data-cleaning/api/mvp/seam')`，不渲染界面 |
| UI 是 `lib/web.js` 内联裸 HTML | `lib/web.js` `UI_HTML`（L121 起） | 界面与 DSH React 外壳脱钩，无侧边栏/命令/设置入口 |
| 唯一可达方式 = 对话 + 手工 URL | `README.md` L32-53 | 用户需「知道网址」或「知道要说哪句话」才能用 |

**根因**：Spike #2 只验证了「客户端 bundle 能被扫描并执行」（`window.__DC_MVP__`），
从未验证或实现「客户端 bundle 在 DSH React 外壳里挂出可见入口」。

---

## 3. 契约依据（一手，非记忆推断）

以下事实来自本机两处一手源码，已在写作本方案前逐项核验：

- 框架源码：`/Applications/DSH Desktop.app/Contents/Resources/app.asar.unpacked/node_modules/@deepseek-ai/*`
- **生产 profile 里实装的同团队插件**：`~/.dsh/profiles/web/node_modules/dsh-mcp-connector@0.2.32`（即 GUI 里的「MCP连接器」）

### 3.1 决定性参照：`dsh-mcp-connector@0.2.32`（MCP连接器 本体）

这是「第三方插件在 DSH GUI 挂入口」的**权威模板**，与我们的目标完全同构：

| 维度 | dsh-mcp-connector 实装值（一手） |
| --- | --- |
| `package.json` → `dsh.client` | `inject: ["@deepseek-ai/dsh-client-ui-layout", "@deepseek-ai/dsh-client-ui-conversation"]`, `platform: "web"` |
| 客户端装载 | `window.__ModuleLoader__.load({ id: "dsh-mcp-connector", factory })`（与 `lib/client.js` 同形） |
| 客户端 `inject`（服务名） | `["slots", "sessions", "workspaces", "conversation"]` |
| React 来源 | factory 内 `require("react")`、`require("react/jsx-runtime")`、`require("react-dom")`、`require("@deepseek-ai/dsh-client-ui-primitives")`；`defineStore` 来自 `@deepseek-ai/dsh-client-store`，缺则回退 `@deepseek-ai/dsh-client-runtime/client` |
| 侧边栏入口 | `ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({ name:"sidebar.footer.action", id:"mcp-connector", order:0, store }, SidebarEntry))` |
| 全屏面板 | `ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name:"shell.overlay", id:"mcp-connector", order:100, store, inject:()=>({...}) }, MarketOverlay))` |
| 入口视觉 | `SidebarEntry` = `<Button variant="ghost">🧩 MCP连接器</Button>`，再 `createPortal` 到 `sidebar.workspaces` 前（`ensureTopLauncherMount` 用 `data-slot` 定位） |

**结论**：第三方 bundle **确实能**在 factory 里 `require` 外壳静态模块表提供的 React/react-dom/jsx-runtime，
**无需打包 React、无需构建步骤**——这正是你选定的「复用外壳静态模块表」路径，且已被生产插件证明可用。
早前方案里的「Spike #8 探路不确定性」就此消除：不是「通不通」，只剩「我们的克隆能否渲染」。

### 3.2 Slot 系统（框架声明，一手）

- `sidebar.footer.action` —— **list slot**，`scope: "root"`，由 `dsh-client-ui-sidebar` 声明
  （`lib/client.js` L307 附近 `"sidebar.footer.action": { kind: "list", scope: "root" }`）。
  同一 list slot 内多个贡献按 `order` 排列；宿主容器默认横排，`dsh-mcp-connector` 注入
  `[data-slot="sidebar.footer.action"]{ flex-direction: column }` 让多入口纵排。
- `shell.overlay` —— **list slot**，`scope: "root"`，由 `dsh-client-ui-layout` 声明
  （`lib/client.js` L420 附近 `"shell.overlay": { kind: "list", scope: "root" }`）。
- 注册形态：`ctx.slots.inject(slotKey, () => ctx.slots.register(descriptor, Component))`；
  `descriptor.order` 控制 list slot 内排序。

### 3.3 本插件其它可复用 slot（框架枚举，已按一手声明修正）

| Slot key | 语义 | 本插件可用性 |
| --- | --- | --- |
| `tool.call.toolview` | 工具调用详情视图（**keyed**，由 `dsh-client-ui-tool` 声明，key=工具 wire 名） | ✅ 富化三工具摘要 |
| `conversation.hero.workspace` | New Session 空态区（由 `dsh-client-ui-workspace` 声明，`WorkspacePicker` 已占据） | ⚠️ 可选空态卡片，但会与 workspace 包竞争；MVP 未用 |
| `conversation.session.header.actions` | 会话头部操作区（keyed） | 可选快捷入口 |
| `settings.plugin.item` | 设置→插件条目（keyed by namespace） | 可选：QCC 凭据/维度配置入口 |

> 注：`conversation.empty` 与 `job` 均**不是**框架声明的 slot（一手核验：layout children 表仅有
> `sidebar/conversation/details/shell.overlay`；会话后台任务无独立 slot）。空态卡片与「job」呈现因此
> 分别落到 `conversation.hero.workspace`（可选，MVP 未用）与工作台 overlay 头部的 jobs 状态 pill（M3 已实装）。

---

## 4. 入口方案（E1）—— 对齐 MCP连接器，排其下方

### 4.1 主入口：`sidebar.footer.action`（排在 MCP连接器 下方）

完全复刻 `dsh-mcp-connector` 的注册写法，仅改三处：

1. `id: "data-cleaning-agent"`，`order: 10`（MCP连接器是 `order: 0`，10 > 0 → 排其**下方**）。
2. `SidebarEntry` 按钮文案 `🧹 数据清洗`（收起态仅 `🧹`）。
3. 点击 → 打开 `shell.overlay` 工作台面板（见 §4.2），而非 MCP连接器的市场面板。

**垂直堆叠保障**：`sidebar.footer.action` 是 list slot，MCP连接器已注入纵排 CSS。我们的贡献
以更大 `order` 进入同一 list，自然落在其下方一行。若两侧 `order` 相同则按注册顺序，故显式 `order: 10`
消除歧义。

> 注意：`dsh-mcp-connector` 把按钮 Portal 到了 `sidebar.workspaces` 上方（见 3.1），所以「下方」的
> 视觉锚点是「MCP连接器按钮这一行之后」。我们的入口采用**同一 footer list slot + 更大 order** 的
> 稳妥做法，天然满足「放在当前 MCP连接器 下方」；是否需要进一步做 Portal 贴到其正下方一行，
> 属可选优化，MVP 不做（避免依赖其未公开的 portal 时序）。

### 4.2 全屏面板：`shell.overlay` 工作台

- `ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name:"shell.overlay", id:"data-cleaning-agent", order: 200, store: workbenchStore, inject: () => ({ startPromptSession }) }, WorkbenchOverlay))`。
- `order: 200` 排在 MCP连接器市场面板（`order: 100`）之后，互不覆盖。
- `WorkbenchOverlay` = 工作台全屏视图（§5 的四步 pane），点侧边栏 `🧹 数据清洗` 打开。

### 4.3 可选二入口（MVP 末位，不强制）

- `conversation.hero.workspace` 空态卡片「数据清洗补全」→ 打开工作台（**注**：该 slot 由
  `dsh-client-ui-workspace` 的 `WorkspacePicker` 占据，属 single slot，MVP 不注入，避免竞争）。
- `conversation.session.header.actions` 快捷按钮 → 打开工作台。

> 三入口（footer 主入口 + 两个可选）都收敛到同一个「打开工作台」动作，避免入口碎片化。

---

## 5. UI 页面方案（E2）

### 5.1 目标形态

把现有裸 HTML「四步工作台」迁为 **React 客户端工作台**（挂进 `shell.overlay`），但**保留
`lib/web.js` 计算后端不动**（`parse/clean/complete/profile/jobs` 已是同源、有界、脱敏的可信后端，
Spike #3/#4/#6 已验证）。工作台组件只做「表单 + 调用 + 预览 + 下载」薄壳。

### 5.2 落地方式（依据 §3.1 已定）

- **Tier2（选定）**：在 DSH React 外壳内挂工作台，分四步 pane：
  1. **上传与映射**：拖拽/粘贴 CSV·XLSX·JSON → 解析预览（列名 + 行数）。
  2. **数据体检**：`profile` 摘要（缺失率、去重数、金额 min/max/sum/mean）。
  3. **清洗 / 补全**：勾选操作 → `clean`/`complete` → 逐条差异预览。
  4. **导出**：CSV 下载 + 任务落库（`jobs`）。
- **Tier1（仅降级兜底，非目标）**：若 `shell.overlay` 渲染异常（例如与某外壳版本冲突），
  入口动作回退为「新标签页打开既有 `/data-cleaning/` 页面」。功能不退，仅视觉不挂外壳。
- **React 依赖（已定）**：复用外壳静态模块表，`require("react"/"react-dom"/"jsx-runtime")`，
  **不新增构建步骤**（与 dsh-mcp-connector 同构）。

### 5.3 与 QCC 补全的边界（本轮明确不接）

- 工作台**本轮只做本地确定性清洗/补全/画像**。
- QCC 富化（维度组勾选、付费二次确认、候选复核、失败重试）仍属被挂起的「更多数据工具维度」，
  仅在工作台留一个**只读「企查查补全：已连接/未连接」状态位**，不接调用链（你已选定）。

### 5.4 Mockup 高保真映射（M2 施工蓝本）

前期视觉 mockup（只读参照，不在本仓库内）：

`../../AI-设计/智能体-在线清洗补全/DeepSeek_Harness_数据清洗补全智能体_UI_Mockup.html`

该 mockup 是「完整理想态」：三区 shell（68px 左栏 `dc-rail` + 中栏对话 `dc-conversation` +
右侧常驻工作台 `dc-workbench` 420–510px），四步 stepper（上传与映射 → 数据体检 → 匹配核验 →
补全与导出），候选详情 modal，能力 chips，配额 pill，tool-trace。下表把 mockup 逐元素映射到
**当前 DSH 插件契约内可落地**的形态，作为 M2 施工对照物：

| Mockup 元素 | 本轮落地形态 | 数据源 / 后端 | 槽位 / 实现 |
| --- | --- | --- | --- |
| 左栏 `dc-rail`（导航） | 不实现（属 DSH 外壳） | — | — |
| 右侧常驻 `dc-workbench` 分栏 | 退化为 `shell.overlay` 居中面板（CSS 右侧贴边近似，非真分栏） | — | `shell.overlay` order 200 |
| 四步 stepper | 四 tab：上传与映射 / 数据体检 / 清洗补全 / 导出 | — | overlay 内 tab |
| 上传 pane（已上传文件 + 字段映射） | 文件选择(.csv/.xlsx/.xls/.json) + 粘贴文本 → 解析预览（fmt + 行数 + 列 chips） | `POST /data-cleaning/api/mvp/parse` | pane 1 |
| 数据体检 pane（质量分 + 4 类问题） | 画像摘要（行/列数、金额 min/max/sum/mean、逐列 非空/缺失/去重值） | `POST /data-cleaning/api/mvp/profile` | pane 2 |
| 匹配核验 pane（候选 + 置信度过滤） | 本轮**不做真实 QCC**；清洗差异预览用**本地确定性规则**（缺失/非法金额/重复计数），置信度明确标注「非 QCC 分数」 | `POST /data-cleaning/api/mvp/clean` | pane 3 |
| 补全与导出 pane（字段云 + 导出文件） | 补全摘要（补名/补金额/手机号归一计数）+ 下载 CSV | `POST /data-cleaning/api/mvp/complete` | pane 4 |
| 候选详情 modal（原始 vs 企查查 + 证据分） | 保留 UI 结构给 P1.2 解冻后，本轮不接 | — | 后续 |
| tool-trace（`enterprise.match.batch · 3分42秒`） | 工具卡 | — | `tool.call.toolview`（M3） |
| 状态 pill（运行中） | jobs 轮询状态 | `GET/POST /data-cleaning/api/mvp/jobs`、`/job/<id>` | overlay 头部（M3） |
| 配额 pill（SVIP·今日次数·行数） | **不实现**（无计费遥测，禁自造数字） | — | 只读「企查查补全：未接入调用链」badge |
| 能力 chips（上传/体检/核验/补全/历史） | 退化为 overlay 内四步 tab | — | overlay 内 |

**保真约定**：

1. 图标用**内联 SVG / emoji**，不引 lucide（shell 静态模块表无 lucide，且外链 CDN 受 CSP 限制）。
2. 颜色沿用 mockup 的 `--dc-*` 明暗双主题 token，用 `light-dark()` 与外壳变量对齐。
3. 组件只用 `react.createElement`（无 JSX、无构建步骤）；工作台内部状态走 `defineStore` store +
   `useStore(selector)`，事件处理器做异步 fetch 后 `actions.setXxx()` 派发，避免依赖组件内 hooks
   （保证与 `test/client-entry.test.mjs` 的忠实 shim 可测、也与 mcp-connector 组件形态一致）。

**需向 shell 侧「提需求」而非硬啃的三件事（记入 backlog，不阻塞 M2–M4）**：

1. `shell.workbench` 常驻右分栏 slot —— 有了它才能真正还原 mockup 三区布局；当前用 overlay 近似。
2. 计费 / 配额遥测接口 —— 配额 pill 无法自造数字，必须等上游。
3. 会话流注入 slot（如 `conversation.insert` 渲染 summary-grid）—— 否则 summary 只能退化为工具卡。

---

## 6. 交互流程（E3）

### 6.1 对话式闭环（既有，保留）

```
用户「帮我清洗这批企业名单」→ data-cleaning Skill → data_profile → data_clean_rows → data_complete_rows → 摘要
```

### 6.2 工作台式闭环（本轮新建）

```
侧边栏 🧹 数据清洗（MCP连接器下方）
  → shell.overlay 工作台：上传/粘贴 → 解析预览 → 画像 → 清洗/补全 → 差异预览 → 导出 CSV
  → 异步：jobs 列表 → job/<id> 详情 → 下载
```

### 6.3 工具调用呈现

- 注册 `tool.call.toolview`（keyed，key=三工具 wire 名：`data_clean_rows` / `data_complete_rows` /
  `data_profile`），把 settled 结果节点的 `block.content` 文本块拍平为可读卡片（计数/金额分布），
  替代裸 JSON —— 让对话式路径在 GUI 里也体面。卡片含状态位（运行中/完成/失败/已停止）与摘要正文。

### 6.4 Mockup 交互还原度（与 §5.4 对照）

- 工作台四步 tab ↔ mockup 四步 stepper：`上传与映射 / 数据体检 / 清洗补全 / 导出`（mockup 的
  「匹配核验」因 QCC 被挂起，本轮与「清洗补全」合并为本地确定性差异预览，置信度标注非 QCC）。
- 状态 pill ↔ jobs 轮询（M3）；tool-trace ↔ `tool.call.toolview` 工具卡（M3）。
- 候选核验 modal ↔ P1.2 解冻后（当前仅保留 UI 结构占位）。

---

## 7. MVP 实现拆分（E4）

| 里程碑 | 内容 | 验收门 |
| --- | --- | --- |
| **M1 · 入口克隆验证** | 隔离 profile + 新端口，把 `lib/client.js` 从 seam 回环升级为「footer slot 入口 + 最小 shell.overlay 占位」，`package.json` 增 `dsh.client.inject: ["@deepseek-ai/dsh-client-ui-layout", "@deepseek-ai/dsh-client-ui-conversation"]` | 侧边栏出现 `🧹 数据清洗`（在 MCP连接器下方）；点击弹出占位 overlay；**不触碰 43120** |
| **M2 · 工作台视图** | 四步工作台组件，复用 `/data-cleaning/api/mvp/*` | 上传→画像→清洗→导出全链路 200；原始行不进模型上下文（沿用同源 + 摘要契约） |
| **M3 · 交互闭环** | 空态卡片（可选）+ `tool.call.toolview` + jobs 呈现 | 入口收敛同一动作；toolview 渲染三工具摘要 |
| **M4 · 验收 + 文档** | `npm run check` + 双基线冒烟（rc.2 主基线、alpha.2 兼容探针）+ 更新 README/USER-GUIDE | check 全绿；双基线入口可发现；无新真实 QCC 调用 |

### 7.1 顺序与依赖

- M1 是硬前置：验证「我们的客户端 bundle 用 dsh-mcp-connector 同款写法能在 rc.2 上渲染出 footer 入口」。
  由于 §3.1 已证明该路径生产可用，M1 是**低风险克隆验证**而非探索；但仍在隔离 profile 做，不直接改生产。
- M2 依赖 M1 的「打开工作台」动作存在；M3 依赖 M2；M4 收口。

---

## 8. 决策点结论（已按你的批复收敛）

| 决策点 | 结论 |
| --- | --- |
| UI 形态 | **Tier2**（挂进 DSH 外壳，`shell.overlay` 工作台），Tier1 仅作降级兜底 |
| 入口位置 | **`sidebar.footer.action`，`order: 10`，排在 MCP连接器（order 0）下方**（你指定的「参考 MCP连接器位置」） |
| React 依赖 | **复用外壳静态模块表，不新增构建步骤**（你已选定；且被 dsh-mcp-connector 生产实证） |
| QCC 富化 | **只放只读「已连接/未连接」状态位**（你已选定），不接调用链 |
| 版本归属 | **并入 0.5.0**（P1.4 Web/UI 提前、P1.2/P1.3 延后），不额外发小版本 |

### 8.1 已确认的实现细节（已按批复执行）

`package.json` 的 `dsh.client.inject` 已从 `[]` 改为 `["@deepseek-ai/dsh-client-ui-layout",
"@deepseek-ai/dsh-client-ui-conversation"]`（与 dsh-mcp-connector 一致），并把这两个包列入
`peerDependencies`（`*` 区间）。M1 已在隔离 profile 验证渲染通过后再改的 `package.json`。

---

*本方案仅新增/更新本文档。实施前等待你对 §8.1 的批复，再按 M1→M4 推进。*
