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

- PR [#3](https://github.com/duhu2000/dsh-data-cleaning-agent/pull/3) 四项 CI 全绿后合并；
  `v0.6.1` 指向合并提交 `77a19aa`。
- Release workflow [33880569564](https://github.com/duhu2000/dsh-data-cleaning-agent/actions/runs/33880569564)
  全绿；版本校验、发布模式门禁、npm OIDC publish 与 GitHub Release 均成功。
- npm `latest` 为 `0.6.1`；发布时间为 2026-09-04T13:53:39Z（北京时间 2026-09-04 21:53）。
- tarball SHA-1：`ab9aaff6738e3ede08768138bc7a9000ccc28ed2`。
- tarball integrity：
  `sha512-VWsVelLCxpGYDZ1TZrxlZWLGC86IjtOJDZAszukCs5LaPwkos8UcJn0IWmYtdKF7S3a8TsQGN1KhOhDL0OCHFw==`。
- npm Registry 返回 SLSA v1 provenance；隔离安装后的 `npm audit signatures` 验证 10 个 Registry
  签名和 1 个 attestation。
- 从公共 Registry 全新安装成功；包版本为 0.6.1，主入口可导入，浏览器 client 语法门通过，
  `lib/qcc-command.js` 与本发布记录均存在。
- DSH `0.1.1-rc.2` 全新隔离 Profile 安装 `dsh-data-cleaning-agent@0.6.1` 成功并加载 Host 插件。
  第二个临时 Web Host 因本机全局文件监听资源耗尽（`EMFILE`）未完成 HTTP seam；未停止或改动用户
  正在运行的 3080 实例。真实工作台闭环证据见上方「验收证据」。
- GitHub Release [v0.6.1](https://github.com/duhu2000/dsh-data-cleaning-agent/releases/tag/v0.6.1)
  已发布，为 Latest，非 draft、非 prerelease。
