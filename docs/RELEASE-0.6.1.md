# 0.6.1 Agent-owned QCC 工作台修复发布记录

> 版本：**0.6.1**
> 发布日期：2026-09-04
> 发布来源：`v0.6.1` Tag 触发 GitHub Actions，使用 npm OIDC Trusted Publishing。

## 目标

0.6.1 是 0.6.0 的兼容性补丁，不扩大企查查工具域，重点修复真实 DSH Code Mode 下的工作台调度和
多智能体共存：

1. Web 工作台只在 Host 暂存企业名单，并向原生会话发送不含明细的 commandId 类型化意图；
2. Agent 准确调用一次 `data_cleaning_qcc_run`，Bridge 使用父执行 token/Session，以 nested execution
   调用动态 QCC 工具；
3. 新会话及其它智能体入口默认不显示数据清洗补全内容，点击本插件入口后才进入独立业务子系统；
4. 本地清洗任务跳过 QCC 匹配页，统计卡只渲染可读标量；
5. Host 重启恢复任务时，下载页继续显示已补全数和待核验数。

## 兼容与安全

- 稳定发布基线仍为 DSH `0.1.1-rc.2`；`0.1.2-alpha.2` 只作兼容探针。
- 工作台命令缺少 Agent 父执行上下文时 fail closed，不从普通 Web handler 直接派发动态 QCC 工具。
- 暂存命令默认 30 分钟过期、最多 50 个；同一 commandId 重放复用同一 Promise/结果，不重复计费。
- 企业名单与字段值不进入可见提示词；OAuth token、QCC 原始响应和凭据不进入仓库或审计日志。
- QCC 继续采用 BYO 账号：客户使用自己的企查查 MCP 连接与额度，插件不共享 Key、不代付。
- 历史域、人员域和招投标域继续延期，本补丁不新增这些工具或权限依赖。

## 验收证据

- `npm run check` 全绿，174/174 自动化测试通过；
- npm dry-run 包全部命中白名单；
- PR #2 的 Linux Node 22、Linux Node 24、Windows Node 24 和 PR 打包检查均通过；
- DSH `0.1.1-rc.2` 真实工作台完成上传、映射、质量体检、零调用估算、额度确认、Agent-owned 调度、
  主体定位、工商补全、结果回填与四件套导出；
- 公开主体批次实际 2 次 QCC 调用，1/1 精确补全、0 待核验、0 失败、无重试；
- 结果 CSV/XLSX 与异常清单 CSV/XLSX checksum 一致，XLSX 可反向解析；Host 重启后任务、统计和
  四件套仍可从任务历史恢复。

## 升级与回滚

- 升级：安装 `dsh-data-cleaning-agent@0.6.1` 并完全重启 DSH。
- 回滚：重新安装 `dsh-data-cleaning-agent@0.6.0` 并完全重启 DSH。
- 本补丁不引入数据库迁移；回滚不会删除 `dc_workflows_v2` 或工作区耐久制品。
- 完整迁移说明见 `docs/UI-WORKFLOW-V2-MIGRATION.md`。

## 外部发布核验

Tag 推送后必须确认 Release workflow 全绿、npm `latest=0.6.1`、provenance 存在、GitHub Release
非 draft/非 prerelease，并从公共 Registry 在全新隔离目录安装验证。实际 workflow run、tarball
哈希与公共安装结果将在发布完成后的仓库进度记录中补充。
