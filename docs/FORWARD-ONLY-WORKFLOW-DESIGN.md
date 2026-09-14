# 数据清洗补全智能体 · 阶段性单向工作流技术方案

> 状态：已完成评审修订，待实施。
> 方案基线：`main@2bd7596`，项目版本 `0.9.7`。
> 目标：先以单向流程解决页面越级、历史页误操作和 Client/Host 状态漂移；本期不提供回退入口，但架构不得假定流程永久单向。

## 1. 背景与问题

当前工作台同时维护两套相互独立的状态：

- Client `step` 决定用户正在查看哪个页面。
- Host Workflow `state/stage` 决定任务实际处于哪个业务阶段。

当前 Stepper、能力入口、Header、事件桥和 Better Sidebar 均可直接修改 Client `step`。进入页面后，
部分页面仍会渲染保存、执行、重试或导出按钮。用户因此可以在 Host 已经进入主体匹配后回到规则页继续
提交 `PATCH updateDraft`，最终收到 `DC_WORKFLOW_LOCKED` 或内部英文错误。

问题本质不是缺少回退能力，而是：

1. 页面导航没有服从 Host Workflow。
2. “查看页面”和“当前业务节点”没有区分。
3. 页面可见性和操作权限由多处分散条件决定。
4. 部分 Client 操作只切换页面，没有完成 Host 状态迁移。

## 2. 评审后产品边界

本期产品交互采用单向流程：

```text
导入与核验 → 规则与体检 → 主体匹配 → 字段补全 → 结果下载
```

- Host 是业务状态、当前节点、阶段访问模式和业务操作权限的唯一真相；Client 自己管理查看节点、busy 状态和本地 runtime 可用性。
- 已到达的非当前节点可以回看，但不得修改任务、重新执行或触发外部调用；预览、下载、复制摘要等只读资源操作继续可用。
- 当前未开放的流程页面不挂载；当前页可以展示下一步说明，已有耐久制品可从任务摘要或任务历史独立访问。
- 只有当前节点可以执行改变业务状态或产生付费调用的操作；历史刷新、制品下载、授权连接和同源 runtime 恢复属于阶段中立能力。
- 用户仍停留在“推进前的当前节点”时，Host 成功推进后自动进入 Host 返回的新节点；导入成功是窄例外，Client 先保留完整名单核验页，并在数据预览后的页面底部提供确认入口，用户确认后进入规则页。允许 QCC 高层链路一次跨越多个中间节点。
- 用户主动回看历史节点时，后台推进不强制切换页面，只更新真实当前节点提示并提供“返回当前节点”。
- Workflow `review_required` 专指企业主体候选待确认，停留在主体匹配；图片 OCR 模糊仍在导入核验处理，字段值待核验进入结果异常清单。
- `partial` 仅表示已有可交付制品的部分业务结果，位于结果下载；只有 live G5 run 中存在 retryable 错误时才显示显式重试。
- 规则确认前可在原任务替换来源；规则确认后，更换源文件、图片或企业名单必须新建任务。完全相同 checksum 的重新加载只恢复 runtime，不修改 Host 任务。
- 本期不提供原任务回退、任务版本或执行轮次；必须提供“新建任务并复用配置”的明确出口。
- 本期单向只是产品能力限制，不是永久架构约束。Client 不得按节点序号自行推导访问权限，Host 契约必须允许未来表达回退后的当前、可回看和失效节点。

## 3. 非目标

本期不做以下改造：

- 不拆分 `QccHostBridge` 的主体匹配和字段补全调用。
- 不改变 QCC MCP 的调用范围、幂等、确认和计费逻辑。
- 不重构图片识别的 Agent-owned 高层工具链路。
- 不新增通用状态跳转接口或 Command Bus。
- 不新增 Agent 工作流状态查询工具。
- 不允许修改已确认规则。

以下能力明确延期，但本期设计不得阻断其后续实现：

- 显式回退动作与允许回退矩阵。
- 回退或重新编辑后对下游匹配结果、补全结果、旧 commandId 和制品的失效规则。
- 配置快照、配置 revision、执行轮次与制品版本展示。
- G5 run 和候选队列的跨 Host 重启持久化。
- 历史制品垃圾回收与长期保留策略。

未来增加回退时，必须由 Host 显式执行状态迁移和下游失效；不得通过 Client 修改查看页面来模拟回退。

## 4. 流程模型

### 4.1 Host 流程投影

在 `lib/workflow-contract.js` 增加纯函数：

```js
deriveWorkflowFlow(task)
```

返回只读、非持久化的流程视图：

```json
{
  "flowVersion": 1,
  "currentStage": "match",
  "stageAccess": {
    "upload": "read",
    "rules": "read",
    "match": "current",
    "enrich": "locked",
    "download": "locked"
  },
  "allowedActions": ["prepare-qcc-command"],
  "nextAction": "prepare-qcc-command"
}
```

`stageAccess` 只使用三种稳定访问模式：

- `current`：真实当前业务节点，可按 `allowedActions` 执行业务操作。
- `read`：允许挂载只读视图，不允许任务写入或外部调用。
- `locked`：不挂载该流程页面。

`flow` 不写入 `storageDomain`，每次读取任务时根据 `state/stage/objectives/artifacts` 计算。现有
`WORKFLOW_SCHEMA_VERSION=2` 保持不变，不要求迁移已有任务。当前 v1 投影可以按单向顺序生成
`stageAccess`，但 Client 只能消费 Host 返回的访问模式，不能自行通过 `stagePosition()` 或节点大小关系
重新计算。未来支持回退时，可升级 Host 投影和 `flowVersion`，允许顺序位于当前节点之后但曾经到达的
页面变为 `read`，无需推翻 Client 导航模型。

`allowedActions` 只表示 Host 持久化业务状态允许的动作，不包含制品下载、历史刷新等阶段中立资源能力，
也不代表 Client 已具备完整运行时数据。Client 仍需叠加 `runtime.rows`、会话归属、当前 busy 状态、
用户确认和 QCC run 是否可用等条件。Host 路由和执行层必须复用同一动作矩阵做最终校验，
`allowedActions` 不能成为仅供展示的提示字段。

### 4.2 状态到当前节点的映射

| Workflow state | currentStage | 说明 |
| --- | --- | --- |
| `draft` | `upload` | 等待导入 |
| `parse_failed` | `upload` | 可重新导入 |
| `uploaded` | `rules` | 数据已确认，等待配置规则 |
| `rules_confirmed` | `rules` | 等待质量体检成功 |
| `diagnosed`，需要 QCC | `match` | 等待生成或执行 QCC 命令 |
| `diagnosed`，仅本地处理 | `enrich` | 等待本地清洗补全 |
| `matching` | `match` | QCC 执行中 |
| `review_required` | `match` | 等待人工确认主体 |
| `matched` | `enrich` | 主体已确定，等待补全完成 |
| `enriching` | `enrich` | 补全执行中 |
| `export_ready` | `download` | 等待生成或下载制品 |
| `partial` | `download` | 已存在耐久部分结果；live run 有 retryable 错误时可显式重试 |
| `completed` | `download` | 已完成，只允许下载 |
| `authorization_required` | 记录中的 `stage` | 保持在发生授权问题的节点 |
| `failed` | 记录中的 `stage` | 保持在发生失败的节点 |
| `cancelled` | 记录中的 `stage` | 原节点只读，不允许继续 |

对旧任务，`deriveWorkflowFlow()` 优先按上述状态修正 `currentStage`，解决历史记录中
`rules_confirmed + stage=match` 等旧口径，不修改持久化记录。`diagnosed` 只按已确认的 `objectives`
判断是否需要 QCC；残留或默认 `fieldSelection` 不能把仅本地任务误判为 QCC 任务。

`export_ready` 表示结果已具备创建制品的业务条件，允许停留在下载节点执行 `create-artifacts`；
但本地交付不得在文件生成前暴露该状态。`partial` 必须满足“至少已有一组 Host 耐久制品”的不变量；
实体多候选必须使用 `review_required + match`，不得按错误类型任意改变 `partial` 的节点。

本期 `stageAccess` 虽然以单向流程为主，但也必须根据任务事实生成，不能简单地把 currentStage 之前全部
设为 `read`、之后全部设为 `locked`。例如 `partial` 重试产生新候选后，当前节点变为 `match`，但已有
制品仍应使 `download=read`；已经产生补全摘要时，`enrich` 也可以保持 `read`。这既解决当前异常恢复，
也验证 Client 没有依赖节点序号。

v1 投影按以下事实开放非当前页面：

- 有 `source` 时，非当前 upload 为 `read`。
- 规则已经确认或状态已经越过规则确认时，非当前 rules 为 `read`。
- 任务需要 QCC 且已有 `matchSummary/qccRunId` 时，非当前 match 为 `read`；仅本地任务的 match 始终 `locked`。
- 已有 `enrichmentSummary` 时，非当前 enrich 为 `read`。
- 已有 `artifacts` 时，非当前 download 为 `read`。
- 其余非当前节点为 `locked`；当前节点始终标为 `current`，即使终止态没有任何 allowedAction。

未来回退引入显式的下游失效或历史快照后，只调整上述 Host 事实来源和 flowVersion，不改变三种访问模式
或 Client 解释方式。

### 4.3 动作矩阵

动作名称是 UI/Host 之间的业务能力标识，不直接等同于某个 HTTP 路径。

| 当前状态 | Host 允许动作 |
| --- | --- |
| `draft / parse_failed` | `import-data`、`edit-rules`（仅草稿设置） |
| `uploaded` | `import-data`（当前 rules 页的来源替换入口）、`edit-rules`、`confirm-rules` |
| `rules_confirmed` | `run-quality` |
| `diagnosed`，需要 QCC | `prepare-qcc-command` |
| `diagnosed`，仅本地处理 | `run-local-clean`、`run-local-complete`、`create-local-artifacts` |
| `matching / enriching` | 无用户业务操作，只读进度 |
| `review_required` | `resolve-candidate` |
| `matched` | `continue-delivery`（Host 内部；需要 live run） |
| `export_ready` | `create-artifacts` |
| `partial` | `retry-failed`（需要 live run 与 retryable 错误）、`retry-delivery`（已有更新后的 live run 但新制品提交失败） |
| `completed` | 无业务写操作 |
| `authorization_required` | 本期无业务写操作；连接账号后新建任务并复用配置 |
| `failed` | `retry-delivery`（仅限可证明 QCC 查询已完成且 live run 仍存在的交付失败），否则新建任务并复用配置 |
| `cancelled` | 无业务写操作 |

`download-artifacts`、`preview-artifacts`、`refresh-history` 和 `reload-same-source` 不进入上述动作矩阵。
`retry-failed` 还需由 Client 根据当前 `G5RunStore` 快照中的 `error.retryable` 二次判断，Host 的现有
QCC command/run、付费确认和 revision 校验继续作为最终保护。

### 4.4 业务状态、页面、权限与运行时分层

本方案明确保留四个不同模型，不把它们合并为一个通用状态机：

1. Workflow `state/stage/revision`：Host 持久化业务事实。
2. `flow.currentStage/stageAccess/allowedActions`：Host 根据业务事实派生的只读投影。
3. Client `viewStage`：用户正在查看的页面，不代表业务状态。
4. Runtime readiness：rows、G5 run、活动 command、busy 和确认状态，只决定某个已允许动作当前能否执行。

`workflowView()` 可以附加不含明细的 runtime capability 布尔值，例如 live run 或活动 command 是否存在，
用于识别 Host 重启后遗留的 `matching/enriching/review_required/partial`；这些值不得写入 storageDomain，
也不得混入 `deriveWorkflowFlow(task)` 的纯业务映射。

## 5. Host 改造

### 5.1 工作流契约

修改 `lib/workflow-contract.js`：

- 增加 `FLOW_VERSION=1`。
- 增加阶段访问模式和流程动作常量。
- 增加 `requiresQcc(task)` 纯函数，统一判断 `validate_identity/complete_fields`。
- 增加 `deriveWorkflowFlow(task)`，一次性派生 `currentStage/stageAccess/allowedActions/nextAction`。
- 在 `publicWorkflowContract()` 中公开 `flowVersion`、访问模式和动作列表。
- 动作矩阵只定义在 Host；API 前置校验和 `flow.allowedActions` 必须调用同一纯函数，避免两套口径。

### 5.2 状态迁移

修改 `lib/workflow.js`：

- `confirmRules()` 返回 `state=rules_confirmed, stage=rules`。
- `recordQuality()` 成功后根据任务目标进入 `match` 或 `enrich`。
- `recordMatch()` 的多候选继续进入 `review_required + match`。
- 初次 QCC 完成、多候选确认完成、partial 重试完成和本地制品交付分别使用窄接口提交，不增加任意状态跳转接口。
- `requireAuthorization()` 和 `recordFailure()` 必须显式保留或设置故障发生节点，不能让 `partial/download` 的重试错误回到 `match`。
- `partial` 写入前校验至少有一项耐久制品引用；新的多候选使用 `review_required`，不使用 `partial`。
- 不新增 Workflow state，不放开 `updateDraft()` 的锁定规则；为了支持原子交付，可以为现有状态补充明确的直接转换。

新增或调整的 Store 方法必须按具体业务意图命名，例如：

- `completeLocalDelivery()`：从已体检的本地任务直接提交摘要、制品和 `completed/download`。
- `completeQccDelivery()`：从当前 QCC 执行状态一次提交匹配摘要、补全摘要、qccRunId、制品和最终 `partial/completed`。
- `recordRetryReview()`：partial 重试出现新候选时进入 `review_required/match`，保留已有制品引用。
- `completeRetryDelivery()`：partial 重试完成并成功生成新制品后更新摘要和最终状态。
- `recordDeliveryFailure()`：保存可公开错误码、qccRunId 和 `download` 故障节点，以便在 live run 尚存时零 QCC 调用重试交付。

这些方法仍通过 `mutate()` 和 `expectedRevision` 串行化。禁止新增 `setState()`、`gotoStage()` 等通用接口，
为未来回退保留显式、可审计的状态迁移位置。

现有 `TRANSITIONS` 至少需要同步以下语义，而不是只改方法内部赋值：

- `rules_confirmed` 的正常前进只有 `diagnosed`，不能直接进入 `matching/matched/export_ready`。
- `diagnosed` 的 QCC 分支进入 `matching`；本地交付可以在制品成功后直接进入 `completed`。
- `matching` 或最后一次候选确认可以在交付成功后直接进入 `partial/completed`，也可以因企业多候选进入 `review_required`。
- `partial` 不再通过 `matching/matched/enriching/export_ready` 模拟 retry；只允许保持 `partial`、进入 `review_required` 或在新制品提交后进入 `completed`。
- 仅 `DC_DELIVERY_FAILED` 且 live run 存在的 `failed` 可以通过专用交付方法进入 `partial/completed`。

这组转换仍是本期单向业务策略。将来加入回退时，以新的显式业务方法扩展 `TRANSITIONS`，同时递增 revision
并处理下游失效；不能绕过转换表直接写 state/stage。

### 5.3 API 任务视图

修改 `lib/web.js`，增加：

```js
workflowView(task) => ({
  ...task,
  flow: deriveWorkflowFlow(task),
  runtimeCapabilities: deriveRuntimeCapabilities(task)
})
```

`runtimeCapabilities` 仅包含不泄露原始行、候选或 QCC 返回的数据，例如 `liveRunAvailable`、
`activeCommand` 和 `retryableFailuresAvailable`。它来自 `QccCommandStore/G5RunStore` 的当前内存快照，
不持久化，也不参与业务节点映射。Client 自己持有的 `runtime.rows` 不上送到这个投影。

以下响应统一使用 `workflowView()`：

- 创建、读取和列出任务。
- 更新草稿和所有 Workflow action。
- 创建制品后的任务。
- Client 在 QCC command 完成后重新读取的任务。

沿用当前 `DataCleaningWorkflowStore` 的状态和 revision 校验，不增加新的通用调度层。用户可见的
`DC_WORKFLOW_LOCKED` 等错误统一改为中文，并说明当前节点和正确下一步。

浏览器 Workflow 路由只暴露用户意图动作。`match-start/match/enrich-start/enrichment/export/fail` 等
执行结果写入由 Host lifecycle 直接调用 Store，不再作为 Client 可以任意提交摘要的入口。
路由接到用户动作时，先用与 `allowedActions` 相同的矩阵校验，再由 Store 转换和 revision 做最终保护。
`/mvp/*` 兼容接口不受此约束，但不能写 Workflow 状态。

### 5.4 `partial` 重试

当前 `createWorkflowExecution().beforeRun()` 对 `enrich/resolve/retry` 都调用 `startMatch()`，会把
`partial + download` 重试重新写成 `matching + match`。如果只删除该调用、完成时仍复用现有
`recordMatch()`，又会触发不允许的 `partial → matched` 转换，并可能在付费调用已经完成后才失败。

修改 `lib/workflow-execution.js`：

- 初次 `enrich` 和候选 `resolve` 可以继续用 `startMatch()` 表示高层命令正在运行。
- `retry` 从 `partial` 开始时不调用 `startMatch()`，Workflow 和已有下载保持可用；用 runtime capability 展示独立重试进度并阻止重复重试。
- `retry` 的 QCC 调用抛错时记录安全错误提示，但保留原 `partial/download` 和已有制品，不把整个任务写成 `failed`。
- retry 返回新的企业主体候选时调用 `recordRetryReview()` 进入 `review_required/match`；已有制品仍通过 `stageAccess.download=read` 和任务历史可下载。
- retry 没有新候选时，先根据更新后的 live run 创建新制品，成功后调用 `completeRetryDelivery()`；不得再经过 `recordMatch → startEnrichment`。
- 新制品生成失败时保留原 partial 制品，并开放零 QCC 调用的 `retry-delivery`；禁止重新执行已经成功的 QCC retry。
- 更新后的制品继续写入新的 artifact id。任务页默认展示每个 kind 最新的制品，旧引用不作为当前结果；本期不删除旧文件，也不建设制品版本 UI。

初次 QCC 和最后一个候选确认也应采用相同的“先生成制品，后提交最终状态”原则：

```text
QCC 高层调用完成
→ 有企业多候选：recordMatch(review_required)
→ 无企业多候选：createBundle
→ completeQccDelivery(partial/completed)
```

这样不会在制品生成期间短暂暴露“partial 但无制品”或“可下载但没有文件”。若首次制品写入失败，
使用 `failed + stage=download + DC_DELIVERY_FAILED`，并在 live run 存在时只重试交付。该调整只修正
Workflow lifecycle 和制品提交，不改变 QCC MCP 调用、请求幂等、付费确认和 Agent-owned 边界。

### 5.5 本地制品交付

当前 artifacts POST 会先执行 `prepareLocalExport()` 写入 `export_ready/download`，再调用
`createBundle()`；文件写入失败会留下没有制品的下载节点。改造后本地任务必须按以下顺序执行：

```text
校验 diagnosed + local objective + expectedRevision
→ 使用 Client runtime rows 创建 bundle
→ completeLocalDelivery(summary, artifacts, expectedRevision)
→ completed/download
```

写文件失败时不修改 Workflow，用户仍在 `enrich` 重试。文件成功但 metadata mutation 因 revision
冲突失败时，可能留下未引用文件；本期接受这一有界残余风险，清理策略延期，不允许为此引入跨存储事务。

### 5.6 异常与恢复矩阵

| 场景 | 当前节点/访问 | 本期最小恢复路径 |
| --- | --- | --- |
| `parse_failed` | `upload=current` | 替换或重新解析来源 |
| `authorization_required` | 故障发生节点 `current` | 阶段中立地连接账号；为避免重复计费，本期新建任务并复用配置 |
| `matching/enriching` 且无活动 command/live run | 原节点 `current`，无执行动作 | 说明 Host runtime 已失效，新建任务并复用配置 |
| `review_required` 且 live run 丢失 | `match=current`，无候选操作 | 已有制品仍可下载；否则新建任务并复用配置 |
| `partial` 且 live run 丢失 | `download=current` | 下载现有结果；需要继续处理时新建任务并复用配置 |
| `failed + DC_DELIVERY_FAILED` 且 live run 存在 | `download=current` | 只重试制品交付，不执行 QCC |
| 其他 `failed` | 记录中的 stage `current` | 展示错误和新建任务并复用配置 |
| `cancelled` | 原节点只读 | 查看历史或新建任务 |

本期不把 `authorization_required/failed` 一律映射成可重试，也不根据错误文案猜测恢复能力。Host 必须
同时依据安全错误码和 runtime capability 决定动作是否开放。

## 6. Client 改造

### 6.1 两类页面状态

保留现有 Store 的 `step` 字段作为 `viewStage`，避免大范围重命名。真实当前节点始终读取：

```js
workflowTask.flow.currentStage
```

`profile` 是规则节点的子视图，权限判断时统一归一为 `rules`。

增加纯函数：

```text
normalizeViewStage(profile -> rules)
resolveStageAccess(requestedStage, flow)
```

不得在 Client 增加 `stagePosition()`、阶段序号比较或“当前节点之前即历史、之后即未来”的权限推导。
步骤顺序只用于 Stepper 展示；访问结论直接读取 `flow.stageAccess[normalizedStage]`。这是后续支持回退时
无需重写 Client 的关键约束。

### 6.2 统一导航入口

以下入口必须调用同一个导航函数，不能直接 `actions.setStep()`：

- 五步 Stepper。
- 输入框下方五能力入口。
- 会话 Header 工作台入口。
- `requestWorkbenchOpen()` 事件桥。
- Better Sidebar `navigate/open`。
- 任务历史恢复。
- 页面内“下一步”和“返回当前节点”。

导航规则：

- 请求 `read` 节点：更新 `viewStage`，以只读模式打开。
- 请求 `current` 节点：正常打开；具体控件仍按 `allowedActions` 和 runtime readiness 开放。
- 请求 `locked` 节点：不把该页面挂载为 active view；工作台关闭时打开真实当前节点，工作台已打开时保持当前合法页面，并提示先完成当前步骤。
- 请求 `history`：始终允许，作为五步之外的管理视图。

统一导航函数必须同时供正常 UI 和事件/Sidebar adapter 使用。底层 `setStep()` 可以作为 Store 原语保留，
但不得再被产品入口直接调用；即使测试或旧入口绕过导航写入 locked step，渲染层也必须 fail closed。

### 6.3 渲染层最终保护

入口检查不能作为唯一保护。`WorkbenchContent` 必须计算：

```text
viewAccess = flow.stageAccess[normalizeViewStage(step)]
isCurrentView = viewAccess === 'current'
can(action) = isCurrentView && flow.allowedActions.includes(action) && runtimeReady(action)
```

只有相应的 `can(action)` 为真时才挂载写操作和执行按钮。`isCurrentView` 本身不等于“整页可编辑”：
例如 `rules_confirmed` 的当前节点仍是 rules，但只能运行质量体检，不能继续编辑已确认规则。
`read` 视图使用只读组件或只读分支，不能仅通过 CSS 隐藏按钮或给现有表单加遮罩；`locked` 视图
不得挂载原业务页面，只展示当前节点或导航提示。

- 历史上传页：只显示来源和名单摘要，不挂载文件、粘贴和图片输入。
- 历史规则页：只显示规则摘要，不挂载 MappingPicker、全选、清空、保存和确认。
- 历史匹配/补全页：只显示统计和已有结果，不挂载执行、确认、重试或生成制品按钮。
- 回看时显示“当前流程节点：XXX”和“返回当前节点”。

`workflowNavigationIssue()` 可暂时作为旧 Host 无 `flowVersion` 时的保守兼容逻辑，不再作为主权限模型。
缺少或不支持 `flowVersion` 时必须进入只读兼容模式：可查看任务摘要、历史和下载已有制品，但不开放
Workflow 写操作或付费调用，并提示升级/完整重启 Host。Client 可以为展示选择 `task.stage`，但不能
用旧状态映射恢复写权限。

### 6.4 Host 任务接受与自动前进

所有创建、读取、列表、PATCH、action、QCC 轮询和制品响应必须先进入唯一的：

```text
acceptWorkflowTask(incoming, reason)
```

该入口原子处理：

- taskId：非显式任务切换时，忽略其他任务的异步响应。
- revision：忽略较小 revision；相同 revision 仍允许刷新非持久化的 runtime capabilities。
- 当前业务节点：始终更新为 incoming flow，不由 Client 猜测。
- 自动前进：仅当接收响应前的 `viewStage` 对旧 flow 是 `current` 时，跟随新的 `currentStage`。`reason=import` 是窄例外：Host 仍进入 `rules`，Client 暂留 `upload` 只读核验结果，并在完整数据预览后的页面底部提供“确认名单，进入规则与体检”入口；顶部状态栏只提示真实当前节点。
- 历史回看：原 view 在新 flow 中仍为 `read` 时保持不动；若变成 `locked`，回到真实当前节点并提示原因。
- 新建、刷新后首次恢复或从任务历史显式选择任务：默认打开 incoming `currentStage`，不沿用上一个任务的 viewStage。
- 新任务沿用远端的 `originSessionId + originWorkspaceId` 来源归属，刷新时只选择属于当前来源的最新任务；历史任务保持独立只读，不绑定到当前会话。

轮询回调必须读取 Store 的最新快照，不能用 effect 创建时捕获的旧 `step` 决定是否跳转。QCC 无候选成功时
允许一次性完成匹配、补全和制品交付，直接从 match 进入 download；不为展示目的拆分 Bridge。

### 6.5 本地结果交付

当前“进入下载数据”只修改 Client `step`。改造后不再提前进入下载：

```text
本地处理完成
→ 用户点击“生成结果”
→ createArtifactBundle()
→ Host completeLocalDelivery
→ 成功响应包含 completed/download
→ Client 自动进入结果下载
```

如果制品生成失败，任务和页面继续停留在字段补全，允许用户重试，不出现“已到下载但没有文件”。

### 6.6 `partial` 页面

- 将“重试可恢复失败项”从主体匹配页移动到结果下载页。
- 下载已有结果不要求先重试。
- 重试期间仍显示结果下载节点和独立进度。
- 只有 `flow.allowedActions`、live G5 run、retryable 错误和本次用户付费确认均满足时才挂载重试按钮。
- 重试成功并生成制品后刷新统计，默认仅展示每个 kind 最新制品。
- 重试产生多候选时进入主体匹配；此前的下载页仍为 `read`，已有制品不消失。
- G5 run 已过期或 Host 已重启时，不展示无效重试按钮，只保留下载和“新建任务并复用配置”。

### 6.7 更换名单与运行时恢复

当前工作区中的来源入口必须服从状态边界：

- `draft/parse_failed` 在当前 upload 页导入来源；`uploaded` 已进入 rules，规则确认前可通过当前 rules 页的专用来源替换入口更新原 task。历史 upload 页始终只读。
- 规则确认后，入口改为“新建任务并导入其他名单”，先创建新 `taskId`，再打开导入区。
- 历史上传页不挂载文件、粘贴或图片输入；只读摘要旁可以提供阶段中立的“新建任务”入口。
- “新建任务并复用配置”只复制 objectives、fieldSelection、matchRules 和可读任务名。新来源 headers 完全一致时可把旧 mappings 作为待确认建议，否则重新推荐映射；不得复制旧 revision、确认状态、qccRunId、摘要或 artifacts。

中途任务因刷新丢失 `runtime.rows` 时，当前浏览器页签可以按 `taskId` 临时缓存已由 Host 解析并成功登记的
原始 rows、headers 和来源 verifier，用于刷新后恢复列表。该缓存使用受限容量的 `sessionStorage`，不进入
Host `storageDomain`、模型上下文或跨页签历史兼容；关闭页签、清理站点数据、缓存超限或条目淘汰后不承诺恢复。
缓存仅提供页面恢复，不能仅凭其中声明的 checksum 获得业务写权限。

当页签缓存不存在，或 Host 重启、历史任务等场景丢失 `runtime.rows` 时，重新加载同一源数据仍属于运行时恢复，
不是流程回退。该操作显示在缺失数据的上传回看页或当前节点阻塞提示中，不开放已确认规则的修改权限。

`source.checksum` 已存在于 Workflow 数据结构。新任务应使用一个共享的、带算法版本和随机盐的 canonical
rows verifier，例如 `sha256-canonical-rows-v1:<salt>:<hex>`。首次导入由 Host 生成至少 128 bit 随机盐；
恢复导入把原 verifier 交回同源 Host，由 Host 使用其中的盐重新计算并返回是否一致，不能接受 Client
直接声明“checksum 相同”。随机盐避免不同任务仅凭持久化摘要直接关联同一名单，也降低预计算字典风险。

canonical 输入至少包含 headers 的稳定顺序、rows 的原始顺序、单元格类型和值；对象值使用 key 排序，
日期使用 ISO 字符串。保留行顺序是必要约束，因为 G5 run 和候选队列通过 row index 对齐。CSV/XLSX/JSON/
文本等所有导入路径必须对解析后的完整 rows 使用同一 Host helper；不能让 JSON/文本 Client 快速路径绕过
verifier。相同解析数据即使来自重新保存的不同格式也可恢复，不要求文件字节完全相同。verifier 只进入同源
Host 请求和 Workflow 元数据，不进入模型上下文，不能据此获取原始名单。

恢复时：

- 页签缓存命中：可恢复原始列表显示；在确认规则、执行本地处理、生成制品或生成 Agent 高层命令前，Client
  必须把实际 headers/rows 交给同源 Host，Host 使用任务 verifier 重新计算并确认一致。验证失败立即丢弃缓存，
  不推进 Workflow、不生成 commandId、不发起 QCC 调用。
- checksum 一致：只恢复 Client runtime，Host `state/stage` 不变。
- checksum 不一致：拒绝覆盖，提示新建任务。
- 旧任务缺少 checksum：文件名、行数和表头不足以证明同源；本期不恢复原任务的写能力，只允许查看、下载或新建任务并复用配置。
- 图片识别结果已经失效时不在本期做同任务恢复，重新提交图片应新建任务并重新确认外部识别调用。

重新加载只能恢复 `diagnosed` 等仍可安全继续且只缺 Client rows 的任务。它不能重建已丢失的 QCC command、
G5 run、候选队列或付费幂等屏障；`matching/enriching/review_required/partial` 的 live runtime 丢失时按
Host 异常恢复矩阵处理。

## 7. Agent 边界

当前 Agent 继续只执行工作台已确认并生成的高层命令：

```text
安全任务凭证 dcq-* → data_cleaning_qcc_run(commandId)
```

- 不新增回退或任意状态跳转 Tool。
- 不允许 Agent 修改工作台结构化规则。
- 不允许 Agent 根据对话自行跳过 Host 当前节点。
- 只有 `prepare-qcc-command/resolve-candidate/retry-failed` 被 Host 动作矩阵允许时才能生成新的 commandId。
- `data_cleaning_qcc_run` 继续通过 command promise、task revision 和 G5 幂等屏障阻止旧命令及重复扣量。
- 初次任务仍以用户发送可编辑说明作为调用确认；候选确认和失败重试仍要求本次显式付费确认，不沿用旧确认。
- 将来回退或修改规则时必须递增 task revision，使回退前生成的 commandId 在任何调用发生前失效。
- 当前不新增 `data_cleaning_workflow_status`；待 UI 单向流程稳定后再评估是否确有需要。

`flow` 只服务同源工作台，不进入 Agent prompt。当前 Agent 已能通过 opaque commandId 执行一个已确认的
高层任务；新增状态查询 Tool 不会解决 Client/Host 导航漂移，反而扩大状态披露和 Agent 自主决策面，
因此本期明确延期。

## 8. 兼容性与隐私

- Workflow schema 保持版本 2。
- `flow` 和 `runtimeCapabilities` 是派生字段，不进入 `storageDomain`。
- 原始行、企业名单、候选详情和 QCC 返回仍不进入 Host 持久化。仅允许当前浏览器页签使用受限容量的
  `sessionStorage` 缓存已成功导入的原始 rows，以支持刷新恢复；不承诺跨页签或历史会话恢复。
- canonical rows checksum 只作为同源恢复校验元数据，不返回 Agent、不允许据此获取原始名单。
- 已有耐久制品及下载 URL 不改变；重试产生的新制品使用新 artifact id，UI 默认展示每个 kind 最新项。
- 旧任务的错误 stage 通过读取时投影修正，不批量重写历史记录。
- 旧任务缺少 checksum 时不授予同任务恢复写能力；已有制品仍可正常下载。
- Client 遇到缺失或不支持的 `flowVersion` 时进入 Workflow 只读兼容模式，不根据旧 stage 猜测写权限。
- Headless 模式下 `data_clean_rows/data_complete_rows/data_profile` 不受影响。
- `/mvp/*` 兼容接口保持可用；单向页面权限只约束 Workflow 工作台。

本期收紧浏览器可写的内部 lifecycle 路由会要求 Client 与 Host 同版本部署。项目当前 Client/Host 来自同一
插件包；若宿主存在静态资源缓存，升级提示必须要求完整重启。读取旧任务和下载既有制品必须向后兼容。

## 9. 文件级改造清单

### `lib/workflow-contract.js`

- [ ] 增加 Flow 版本和动作常量。
- [ ] 增加 `requiresQcc()`。
- [ ] 增加 `deriveWorkflowFlow()` 和完整 `stageAccess` 投影。
- [ ] 让 flow 投影和 Host 动作校验复用同一动作矩阵。
- [ ] 扩展 `publicWorkflowContract()`。

### `lib/workflow.js`

- [ ] `confirmRules()` 保持在规则节点。
- [ ] `recordQuality()` 按任务目标推进。
- [ ] 增加本地交付、QCC 交付、partial 重试和交付失败的窄 mutation。
- [ ] 保证 `partial` 必有制品，失败/授权状态保留真实故障节点。
- [ ] 保留已有状态校验和 revision 语义。
- [ ] 更新用户可见的锁定错误文案。

### `lib/web.js`

- [ ] 增加 `workflowView()`。
- [ ] 所有 Workflow task 响应附加 `flow/runtimeCapabilities`。
- [ ] 浏览器路由只暴露用户意图，执行结果由 Host lifecycle 写入。
- [ ] 所有解析路径按同一 canonical rows 规则提供源 checksum。
- [ ] 本地制品先生成、后一次性提交 Workflow。
- [ ] 越级错误返回中文业务提示。

### `lib/workflow-execution.js`

- [ ] `retry` 不调用 `startMatch()`。
- [ ] `retry` 失败保持 `partial/download`。
- [ ] retry 使用专用 review/delivery mutation，不复用初次 `recordMatch → startEnrichment` 链。
- [ ] 初次 QCC、候选确认和 retry 均先生成制品、后提交最终状态。
- [ ] 重试产生候选时进入 `review_required/match`，已有下载保持只读可达。

### `lib/qcc-command.js` / `lib/qcc-runs.js`

- [ ] 提供不泄露明细的 live run、active command 和 retryable capability 查询。
- [ ] partial 重试期间阻止同任务重复启动；不改变 30 分钟内存 TTL、调用幂等和付费确认语义。
- [ ] delivery retry 直接复用 live run rows，不再次调用 QCC。

### `lib/artifacts.js`

- [ ] 保持现有文件格式、校验和、下载路径和隐私边界。
- [ ] 允许 lifecycle 在 Workflow 最终 mutation 前创建 bundle；不在本期引入跨存储事务或垃圾回收框架。

### `lib/client.js`

- [ ] 将 `step` 明确作为查看节点使用。
- [ ] 接入 `task.flow.currentStage/stageAccess/allowedActions`，不得按步骤序号推导权限。
- [ ] 增加唯一 `acceptWorkflowTask()`，处理 taskId、revision、runtime capability、自动前进和异步乱序。
- [ ] 增加统一导航函数并覆盖所有入口。
- [ ] 增加渲染层 access + action + runtime 最终保护。
- [ ] 为历史节点提供只读内容分支。
- [ ] locked Stepper 节点不可挂载，绕过导航直接写 step 也必须 fail closed。
- [ ] 增加当前节点提示和“返回当前节点”。
- [ ] 本地制品成功后再进入下载。
- [ ] 将 `partial` 重试移动到下载页并默认展示最新制品。
- [ ] 规则确认后将“重新导入”改为“新建任务并导入其他名单”。
- [ ] 增加“新建任务并复用配置”和经过 checksum 校验的 runtime 恢复入口。

### 测试与回归脚本

- [ ] 更新 `test/workflow-contract.test.mjs`。
- [ ] 更新 `test/workflow-store.test.mjs`。
- [ ] 更新 `test/workflow-route.test.mjs`。
- [ ] 更新 `test/web-qcc-route.test.mjs`。
- [ ] 为 `test/client-entry.test.mjs` 增加真实渲染行为测试，避免只依赖源码字符串匹配。
- [ ] 更新 `scripts/ui-layout-regression.mjs`；删除“所有五步均可进入”的旧断言，覆盖 current/read/locked。
- [ ] 增加 `test/artifacts.test.mjs` 对交付失败、重复生成和旧制品可下载的回归。

## 10. 验收矩阵

### Host

- [ ] 每个 Workflow state 都得到确定的 `currentStage/stageAccess/allowedActions`，且 flow 不持久化。
- [ ] `rules_confirmed` 仍处于规则节点，体检成功后才前进。
- [ ] QCC 与本地任务在体检后进入正确节点。
- [ ] `rules_confirmed` 不能直接准备 QCC command；越级写请求被路由和 Store 拒绝并返回中文错误。
- [ ] Client 不能调用内部 match/enrichment/failure 摘要写入接口伪造任务状态。
- [ ] `partial` 永远至少包含一组耐久制品。
- [ ] `authorization_required/failed/cancelled` 保留正确节点并得到确定恢复出口。
- [ ] 旧任务无需迁移即可得到正确流程投影。
- [ ] stageAccess 能表达 `match=current + download=read`，证明不是简单序号比较。

### Client

- [ ] Stepper、能力入口、Header、事件桥和 Sidebar 均不能打开未来节点。
- [ ] 直接把 Client step 写成 locked 节点也不挂载目标业务页面或任何写操作。
- [ ] 历史规则页不存在保存、全选、清空、确认和执行按钮；当前 rules 页也只挂载 allowedActions 对应控件。
- [ ] 历史上传页不存在文件、粘贴和图片输入。
- [ ] 当前节点操作成功后自动前进；导入成功先保留完整名单核验页，确认入口位于数据预览后的页面底部，确认后进入规则页。
- [ ] 用户回看历史节点时不被后台推进强制跳转。
- [ ] 乱序 Host 响应不能覆盖更高 revision；相同 revision 可以更新 runtime capability。
- [ ] 刷新和显式任务恢复后默认进入 Host 当前节点，不继承上一任务 viewStage。
- [ ] 缺失/未知 flowVersion 时只读，不产生 Workflow 写入或付费调用。
- [ ] 缺失 runtime rows 时显示恢复入口，不错误开放上传历史页。

### 本地处理与制品

- [ ] 本地制品成功生成后才进入下载。
- [ ] 制品生成失败时 Workflow revision/state/stage 不变，仍停留在字段补全。
- [ ] 文件写入成功但 metadata revision 冲突时不误报完成；允许留下未引用文件作为已知残余风险。
- [ ] 规则确认前可以替换来源；确认后更换名单生成新的 `taskId`。
- [ ] checksum 一致只恢复 runtime，不写 Host；不一致或旧任务缺失 checksum 时不覆盖原任务。
- [ ] “新建任务并复用配置”不复制旧 revision、确认、运行结果和制品。

### QCC

- [ ] `matching/enriching` 时不能重复生成命令或执行其他阶段操作。
- [ ] `review_required` 只能在主体匹配处理。
- [ ] QCC 高层命令无候选时可从 match 一次跨越到 download，不制造 UI 中间停顿。
- [ ] `partial` 在结果页始终可下载；只有 live retryable run 才能显式重试。
- [ ] `partial` 重试失败保留旧制品和 download，成功后展示最新制品；产生新候选时进入 match。
- [ ] QCC 已成功但制品失败时，delivery retry 的 QCC 调用数为 0。
- [ ] live command/run 丢失时不伪装可恢复，也不自动重复付费调用。
- [ ] 保留 revision、幂等、付费确认、候选确认和耐久制品现有测试。

### UI 回归

- [ ] 桌面、窄屏、深色和浅色模式下 Stepper 状态清晰且无溢出。
- [ ] current/read/locked 状态可辨识，历史只读提示、当前节点提示和锁定节点不会遮挡内容。
- [ ] 浏览器真实点击覆盖全部导航入口、历史回看期间后台推进和“返回当前节点”。
- [ ] 当前工作区尚未提交的导入区 UI 调整继续通过布局回归。

### 后续回退兼容性

- [ ] Client 代码不存在基于 stage order 的访问权限判断。
- [ ] Store 不新增通用 `setState/gotoStage`；所有状态改变仍由显式业务方法负责。
- [ ] 测试至少构造一次非线性的 stageAccess（例如 `match=current, download=read`），Client 行为完全服从 Host。
- [ ] commandId 始终绑定 task revision，为未来回退/编辑后的旧命令失效保留机制。
- [ ] 当前制品选择不物理覆盖旧文件，不妨碍未来增加制品版本和下游失效标记。

## 11. 实施顺序

1. 先用测试固化状态映射、stageAccess、动作矩阵和异常恢复矩阵。
2. 实现 `deriveWorkflowFlow()`，修正 `rules_confirmed` 与 `diagnosed` 分流，并让 Host 路由复用动作矩阵。
3. 实现 QCC 初次交付、partial retry 和 delivery retry 的窄 mutation，保证制品成功后才提交最终状态。
4. 修复本地制品提交顺序和 canonical rows checksum。
5. 让全部 Workflow API 返回 `task.flow/runtimeCapabilities`。
6. Client 接入 `acceptWorkflowTask()`、`currentStage/viewStage` 和统一导航。
7. 落地 current/read/locked 渲染分支、动作级控件保护和旧 Host 只读模式。
8. 落地 partial 结果页、最新制品选择、同源恢复和“新建任务并复用配置”。
9. 完成单元、路由、Client 真实渲染及桌面/窄屏/深浅色 UI 回归。

每一步均保持现有 QCC 高层工具、制品下载和 Headless 工具可用；不在同一改造中实现回退或 Agent
状态操作能力，也不得以永久单向假设换取短期实现便利。

## 12. 已确认取舍与残余风险

- 本期不实现原任务回退，但 `stageAccess` 是 Host 决策而非 Client 顺序推导；这是必须交付的扩展性，不是后续优化项。
- 本期不持久化 G5 run。Host 重启后候选确认和失败项续跑可能失效，保守出口是下载已有制品或新建任务并复用配置。
- 本期不对授权或未知执行错误自动重试。无法证明不会重复调用时，宁可要求用户显式新建并再次确认。
- 本期不建立制品版本 UI。重试结果使用新 artifact id，默认展示每类最新结果；旧文件和引用不物理覆盖，为未来版本化保留数据。
- 跨文件写入与 Workflow metadata 不能形成真正事务。metadata 提交失败可能产生未引用文件，但不得产生“已完成却没有制品”的任务；垃圾回收延期。
- 旧任务没有 verifier 时，不用文件名、行数和表头恢复同任务写能力。这会牺牲部分旧任务续跑体验，但避免把不同名单绑定到旧确认和旧审计。
- 字段级 `fieldReview` 本期通过结果报告和异常清单交付，不新增在线字段确认状态；企业主体多候选仍使用 `review_required`。
- 新增 stage access mode 或改变现有 mode 语义时必须升级 `flowVersion`；仅调整某个任务的访问结果不需要修改 Workflow schema。

## 13. 完成定义

满足以下条件后，本方案完成：

1. 用户无法通过任何入口或直接 Client 状态写入挂载 locked 业务页面。
2. 用户回看 read 节点时无法触发 Workflow 写操作或外部调用，但仍可查看、预览和下载。
3. 页面始终清楚显示 Host 当前流程节点、当前查看节点和可用恢复出口。
4. Host flow 投影与实际动作校验使用同一矩阵；所有主操作都由 Host 成功响应推动页面变化。
5. `partial`、多候选、授权失败、制品失败、runtime rows 丢失和 live run 丢失均有唯一且不重复计费的路径。
6. 本地与 QCC 交付都不会在耐久制品成功前进入可下载的最终状态。
7. 不改变现有 QCC 调用、付费确认、幂等和隐私边界。
8. Client 不依赖阶段序号推导权限；未来增加显式回退和下游失效规则时不需要重写导航及渲染契约。
