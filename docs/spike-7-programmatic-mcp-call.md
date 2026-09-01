# Spike #7 证词：插件程序化调用动态 MCP 工具

- 日期：2026-09-01
- 基线：`0.1.1-rc.2` 与 `0.1.2-alpha.2`
- 结论：**PASS / GO**
- 验证环境：隔离 DSH home + 本地 Mock MCP；未触碰生产 GUI、真实 QCC token 或真实企业接口

## 决策问题

`qcc-dsh-mcp-oauth` 通过 `ctx.loader` 动态创建 `@deepseek-ai/dsh-mcp-client` 配置后，数据清洗补全插件能否绕过模型中介，直接、可取消地执行已注册的 `mcp__qcc-*__*` 工具，以支撑方案 B 批量后端？

## 已验证事实

1. 本机 `@deepseek-ai/dsh-mcp-client@0.1.1-rc.2` 只导出 `Config / apply / inject / name`，没有公开内部 MCP `Client`。
2. mcp-client 把 MCP tool definition 注册到共享的 `ctx.tools`。
3. `@deepseek-ai/dsh-tools` 的一手 README 明确公开 `ctx.tools.get(...)` 与 `ctx.tools.execute(exec)`；`execute` 接受 `name / callId / signal / arguments`，可在同一 host 进程调度工具。
4. 因此可依赖的 seam 是公共 Host ToolRuntime，不是 mcp-client 私有 client 或私有 `request()`。

## 验证方法

本地探针插件在隔离 host 内：

1. 用 `ctx.loader.create` 动态创建一个 mcp-client entry，连接本地 Mock MCP server。
2. 等待其注册 `mcp__spike7__echo_company` 与 `mcp__spike7__delayed_echo`。
3. 通过 `ctx.tools.execute()` 调用工具，传入独立 `callId` 和 `AbortSignal`。
4. 禁用再启用动态 entry，验证工具随生命周期消失并恢复。

探针材料保存在被 `.gitignore` 排除的 `spike7/`，不会进入 npm 包或开源仓库。

## 双基线结果

| 验收项 | rc.2 | alpha.2 | 结果 |
| --- | --- | --- | --- |
| loader 动态 entry 创建，两个工具可见 | PASS | PASS | 同构 |
| `ctx.tools.execute()` 返回 Mock 企业结构化结果 | PASS | PASS | 同构 |
| `AbortController` 取消延迟调用 | PASS（约 28ms） | PASS（约 28ms） | 同构 |
| entry 禁用后工具消失，启用后恢复 | PASS | PASS | 同构 |

实际 seam 返回 `entryCreatedByLoader:true`、`toolVisible:true`、`toolsExecute:"function"`；执行结果带 `structuredContent`，取消结果以 `isError:true` 表达。两个 host 均已在验证后停止。

## 结论与方案 B 约束

Spike #7 给出 **GO**：方案 B 可以使用注入的 `ctx.tools` 作为程序化 MCP 调用层，但实现必须遵守：

1. 每次调用前按完整名称重新 `ctx.tools.get(toolName)`；不得缓存 definition 或 mcp-client 内部 client。OAuth token 刷新可能触发 entry 更新以及工具注销/重注册。
2. 只用 `ctx.tools.execute({ name, callId, signal, arguments, ... })`；不得导入或访问 mcp-client 私有实现。
3. 每次调用生成唯一 `callId`，把任务取消信号原样传入，并显式检查 `isError`；工具失败不保证以 throw 表达。
4. 工具缺失时先返回“未连接/连接恢复中”，并引导 `qcc_oauth_connect`，不能静默降级为伪补全。
5. 不把原始企业名单行送入模型；批量编排、结果拼接和下载仍在 Host/Web 边界内完成。
6. provisioner 的 `apply()` 内不得等待 `ctx.loader.await()`，否则可能等待自身造成死锁。

## 未验证项（仍属于 G5 验收门）

- 真实 QCC OAuth 首次连接、过期 token 刷新和重注册窗口。
- 真实 `mcp__qcc-company__*` 的参数、限流、超时、错误和响应体边界。
- 批量企业消歧、多候选暂停/恢复、部分失败重试和幂等恢复。
- 真实数据下的吞吐、并发上限、审计与脱敏。

所以本结论只解除“方案 B 是否有公开程序化调用 seam”的阻塞，不等同于 G5 已完成。

## 后续验收状态（2026-09-02）

上述 Spike 当时的未验证项已由 G5 / 0.4.0 后续工作收口：真实 OAuth、跨重启授权恢复、
20 企业/400 次当前与历史工商调用、自然过期 token refresh、动态工具恢复与续期后最小真实调用均已通过。
401、429 与配额耗尽通过 Web→Bridge→Mock ToolRuntime 故障注入验证无自动重试、人工重试门和安全审计；
详情见 `docs/G5-E2E-RUNBOOK.md` 与 `docs/RELEASE-0.4.0.md`。本节保留原始 Spike 边界作为决策时点记录。
