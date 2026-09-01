# ADR-0002：方案 B 通过 Host ToolRuntime 调用 MCP 工具

- 状态：Accepted
- 日期：2026-09-01
- 相关：`docs/spike-7-programmatic-mcp-call.md`、`docs/QCC-ENRICHMENT-DESIGN.md`

## 背景

方案 B 需要在插件 Host 半区批量调用 QCC MCP 工具，不能把每一行原始数据交给模型编排。`qcc-dsh-mcp-oauth` 会动态创建 mcp-client entry，但 mcp-client 没有公开其内部 MCP client。

## 决策

方案 B 使用注入的公共 `ctx.tools` 服务：按调用解析 `mcp__<server>__<tool>`，并通过 `ctx.tools.execute()` 执行。禁止依赖 `@deepseek-ai/dsh-mcp-client` 的内部 client、私有字段或未导出的 `request()`。

Bridge 负责：

- 工具可用性探测与未连接引导；
- 唯一 call ID、AbortSignal、超时与错误归一化；
- token 刷新/entry 重载期间的短暂不可用处理；
- 结构化结果最小化、脱敏和审计；
- 不缓存 ToolDefinition 或内部连接对象。

## 依据

Spike #7 已在 DSH `0.1.1-rc.2` 和 `0.1.2-alpha.2` 隔离 host 中验证：loader 动态注册、程序化执行、取消、禁用/恢复四项全部通过。此事实只覆盖本地 Mock MCP，不覆盖真实 QCC OAuth 和接口行为。

## 后果

- 正：使用 DSH 已公开的统一工具运行时，方案 B 不需要复制 MCP transport 或介入 OAuth token。
- 正：与模型调用工具共享注册、取消和生命周期语义，双基线实测同构。
- 负：动态 entry 重载存在短暂工具空窗，Bridge 必须可重试且不能缓存工具对象。
- 负：`isError` 与 throw 都可能表示失败，需要统一错误契约。
- 风险：DSH 仍处预发布；未来基线升级必须重跑兼容探针，不能把本 ADR 推断为永久稳定 API。

## 被否决方案

- 直接访问 mcp-client 内部 client：没有公开导出，强耦合私有实现，拒绝。
- 在插件内另建 QCC MCP transport：重复连接和认证，可能绕过 OAuth provisioner，拒绝。
- 继续完全依赖模型中介：保留为方案 A，但不适合作为大批量方案 B 的唯一执行路径。
