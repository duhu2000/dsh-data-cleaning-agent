# DSH-UX-001 v1.5.2 同装回归核对

核对日期：2026-09-11。基线：dsh-data-cleaning-agent 0.9.6。

共同验收记录：`/Users/qcc/dsh-startup-audit-20260910/FOUR-AGENT-COEXISTENCE-ACCEPTANCE-20260911.md`。
该记录报告 DSH 0.1.2-rc.1、Better Sidebar 0.18.1 与四智能体共同装载通过，当前实例 console error/warn 为 0。本仓没有重新执行真实同装、模型或付费 MCP 验收。

## 本仓覆盖

- `test/client-entry.test.mjs` 的入口/新会话用例断言使用公开 `sessions.create({ workspaceId, sessionId })` 能力、命名空间 Session，以及所选 Workspace 的 `sessionIds` 归属。保留普通/其它会话隔离测试。
- Session controller 用例重复打开五个流程入口，检查单例 descriptor、Session store 隔离；禁止任何 fetch，确保不新增任务、不调用 MCP。
- 本次补充模拟宿主 Tab X 后重新打开、收起后恢复与单例 Tab 数量断言，保留输入及任务 id。容器行为由测试替身模拟，不冒充真实 Host 生命周期验收。
- 可选 Sidebar 到达/移除用例检查 descriptor 注销、订阅清理及业务状态保留。

## 结论与边界

未发现需要修改业务实现的问题。本次仅补测试和核对文档，不修改版本号，不需要 npm 发布。
真实同装的深色/窄屏/浮窗、卸载/HMR、完整文件流程和付费 MCP，仍以共同验收记录中的未测项为准。
