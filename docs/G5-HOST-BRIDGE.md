# G5 Host Bridge：方案 B 批量补全基础层

- 日期：2026-09-01
- 状态：**G5-2.1～G5-2.5 与真实 OAuth/QCC 主路径已验收；token 到期刷新与故障注入待验**
- 发布状态：0.4.0 发布候选，尚未创建 tag 或发布 npm 新版本
- 决策依据：`docs/adr/0002-programmatic-mcp-tool-execution.md`

## 本阶段交付

`lib/qcc.js` 基于 DSH 公共 `ctx.tools.get()` / `ctx.tools.execute()` 实现 Host Bridge：

1. 仅允许 `qcc_oauth_*`、规范 `mcp__qcc-*__*` 与 OAuth 0.1.7 已验证 legacy serverName，拒绝任意工具代理。
2. 每次调用重新解析工具，兼容 OAuth 刷新造成的注销/重注册窗口；只对 `UNKNOWN_TOOL` 做一次安全重试，其他失败不自动重试，避免重复计费。
3. 统一 call ID、AbortSignal、超时和 ToolRuntime `isError`，错误响应不携带工具原始业务数据。
4. 解析 MCP `structuredContent` 或 QCC 文本 JSON，复用一期字段契约。
5. 批量输入按企业名去重调用；唯一精确主体才继续工商/风险补全，多候选进入 `reviewQueue`，未匹配保留为 `unresolved`。
6. 单企业失败隔离，不中断其他企业；原始/补全明细只在 Host/Web 同源边界内流转。

## 数据流

```text
同源 Web 请求（显式确认计费）
  → QccHostBridge.enrichRows
    → 企业名去重 + 受控并发（1–4）
      → ctx.tools.get（每次重新解析）
      → ctx.tools.execute(mcp__qcc-company__get_company_by_query)
        ├─ 唯一精确 → 锁定信用代码 → 工商详情 → 可选风险扫描
        ├─ 多候选   → reviewQueue，停止该主体下游调用
        └─ 未匹配   → unresolved
  → 摘要 + 同源明细 + CSV 下载
```

## Web 契约

### 被动能力探测

`GET /data-cleaning/api/g5/capabilities`

只检查工具是否注册，不调用 OAuth 或任何计费 QCC 工具。返回 Bridge marker、连接态推断和批量限制。
同时声明 `idempotencyRequired / candidateResume / manualRetry`，run 状态仅为 `host-memory`。

### 批量补全

`POST /data-cleaning/api/g5/enrich`

```json
{
  "idempotencyKey": "client-generated-unique-key",
  "confirmPaidCalls": true,
  "rows": [{ "name": "示例企业" }],
  "headers": ["name"],
  "nameField": "name",
  "includeRisk": false,
  "concurrency": 2
}
```

约束：

- `confirmPaidCalls` 必须严格为 `true`，否则在任何工具调用前返回 `QCC_CONFIRM_REQUIRED`。
- `idempotencyKey` 必填；相同键与相同请求复用首个结果，不重复调用工具；同键不同请求返回冲突。
- 单批最多 100 行，并发范围 1–4；重复企业只检索一次。
- 响应包含 `summary / reviewQueue / errors / rows / csv`；完整明细不得转发给模型。
- 多候选不会自动取第一项；响应提供 `runId`，状态为 `awaiting-review`。

### 候选确认、人工重试与 run 查询

- `POST /data-cleaning/api/g5/resolve`：传入 `runId / companyName / selectedCreditNo / idempotencyKey / confirmPaidCalls:true`。信用代码必须存在于该公司的待复核候选列表；成功后直接调用工商详情和可选风险，不重复实体检索。
- `POST /data-cleaning/api/g5/retry`：传入 `runId / companyNames / idempotencyKey / confirmPaidCalls:true`。只允许重试错误队列中 `retryable:true` 的企业，且不会自动触发。
- `GET /data-cleaning/api/g5/run/<runId>`：读取当前同源 run 状态，不调用 QCC 工具。

run 状态为 `awaiting-review / needs-retry / completed-with-errors / completed`。明细、候选和幂等结果仅保存在 Host 内存，默认 TTL 30 分钟、最多 50 个 run；Host 重启后失效。

## 错误分类与安全审计

Host Bridge 把上游错误归一为稳定错误码：

- 401/Token 失效 → `QCC_AUTH_REQUIRED`
- 403/资源域未授权 → `QCC_PERMISSION_DENIED`
- 429 → `QCC_RATE_LIMITED`
- 配额不足 → `QCC_QUOTA_EXHAUSTED`
- 超时 → `QCC_TIMEOUT`
- 工具刷新消失 → `QCC_TOOL_UNAVAILABLE`
- 5xx/连接故障 → `QCC_UPSTREAM_UNAVAILABLE`
- 参数契约拒绝 → `QCC_UPSTREAM_REJECTED`

错误响应不复述上游原始 message。每次物理工具调用只记录 toolName、callId、attempt、结果、稳定错误码和耗时；不记录参数、企业名或工具响应。

## E2E Runner

`scripts/g5-e2e.mjs` 默认关闭、仅允许回环 DSH Host；真实 enrich 还要求独立的付费确认变量。报告只包含脱敏摘要，详见 `docs/G5-E2E-RUNBOOK.md`。

## 已通过的 Mock/Contract 门

- Bridge 单元测试覆盖允许列表、每次解析、唯一 call ID、动态工具恢复、取消、超时、细分错误归一化、安全审计、响应解码、消歧、字段映射、锁定候选、去重批量、部分失败、未连接和批量上限。
- Run/Web 测试覆盖并发幂等、同键冲突、候选合法性、续跑、人工重试、状态过期、capabilities、确认门和 CSV。
- Runner/脱敏测试覆盖默认关闭、回环限制、付费确认、摘要报告及凭据/企业标识清洗。
- 测试夹具只使用虚构企业与虚构信用代码，不含真实 token 或业务数据。

## DSH rc.2 隔离 Host 冒烟

2026-09-01 将当前工作树打包后安装到临时 `DSH_HOME`，在隔离端口 `43140` 启动 DSH `0.1.1-rc.2`；为规避本机文件监听器的 `EMFILE`，仅在该测试进程设置 `CHOKIDAR_USEPOLLING=1`。结果：

- Host 成功执行插件 `apply()`；MVP seam 返回 `qccBridgeMounted:true`、`enrichSkillRegistered:true`，原有三工具与两个 Skill 均保持注册。
- `GET /data-cleaning/api/g5/capabilities` 返回 `200`、marker `g5-host-bridge`、`ready:false`、`state:oauth-plugin-missing`，未调用 OAuth 或 QCC 工具。
- 未传 `confirmPaidCalls:true` 的补全请求返回 `409 QCC_CONFIRM_REQUIRED`，证明计费确认门在工具调用前生效。
- 显式确认后，因隔离 Host 未安装 QCC 动态工具而返回 `503 QCC_NOT_CONNECTED`，没有真实 OAuth、token 刷新或 QCC 请求。
- 测试 Host 已停止；生产 GUI 端口 `43120` 未触碰。

G5-2 在同日将更新后的 27 文件 tarball 安装到隔离 Profile，并在端口 `43141` 追加验证：

- capabilities 返回 `idempotencyRequired:true / candidateResume:true / manualRetry:true / runPersistence:host-memory`。
- 已确认计费但缺少幂等键时返回 `400 QCC_IDEMPOTENCY_REQUIRED`，零 QCC 工具调用。
- 带合法幂等键时，由于隔离 Host 未安装 OAuth/QCC 工具，安全返回 `503 QCC_NOT_CONNECTED`。
- `G5_E2E_MODE=preflight` Runner 成功生成权限 `0600` 的脱敏报告，只含 capabilities 摘要。
- 测试 Host 已停止；没有安装 QCC OAuth、没有真实 QCC 调用，生产端口 `43120` 未触碰。

## 真实 E2E 验收门

2026-09-01 已通过：OAuth PKCE 首连、授权跨重启恢复、真实 company/history 工具调用、
20 家公开企业/400 次调用、每企业当前最低 15 维与历史 4 维、证据脱敏边界。

以下剩余项通过前，G5 不能标为生产可用：

1. 未授权 host：返回 `QCC_NOT_CONNECTED` 并正确引导 `qcc_oauth_connect`。
2. 已授权 host：用脱敏名单跑真实 `get_company_by_query` 与 `get_company_registration_info`。✅
3. 多候选真实响应：不发生下游工商/风险调用。
4. token 临期刷新：刷新期间工具短暂消失后恢复，且无重复计费调用。
5. 401/限流/配额不足/超时：错误分类、部分失败和人工重试符合契约。
6. includeRisk：风险因子计数逐字引用，不自行加总或推断。
7. 审计：日志、响应错误、测试证据均不泄露 token 或未脱敏原始名单。✅ 主路径证据已验证
