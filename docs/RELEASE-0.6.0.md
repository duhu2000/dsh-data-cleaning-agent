# 0.6.0 五步工作流与耐久制品发布记录

> 版本：**0.6.0**
> 发布日期：2026-09-04
> 发布来源：`v0.6.0` Tag 触发 GitHub Actions，使用 npm OIDC Trusted Publishing。

## 目标

0.6.0 将 0.5.3 的业务首页升级为可恢复的完整企业数据清洗补全系统：

1. 主流程固定为上传数据、规则确认、数据匹配、清洗补全、下载数据五步；
2. 每个会话绑定独立 taskId，并用 revision 防止并发覆盖；
3. 上传解析、字段映射、质量体检、候选核验和补全状态统一进入 Host 工作流；
4. 完成任务生成结果与异常清单的 CSV/XLSX 四类耐久制品；
5. 浏览器原始行丢失或 Host 重启后，仍可按 taskId 恢复任务并下载既有制品。

## 兼容与安全

- 稳定发布基线为 DSH `0.1.1-rc.2`；`0.1.2-alpha.2` 只作兼容探针。
- Host KV 只保存任务元数据、数字摘要和制品引用，不保存原始企业名单、候选详情、QCC 原始响应或凭据。
- 制品写入用户工作区 `.dsh-data-cleaning-artifacts/v1/`，不进入 Git 或 npm 包。
- 下载前验证 SHA-256；路径和 ID 严格校验；CSV 中和公式型外部文本。
- QCC 继续采用 BYO 账号：客户使用自己的企查查 MCP 连接与额度，插件不共享 Key、不代付。
- 历史域、人员域和招投标域仍不进入本版本新增范围。

## 验收证据

- `npm run check` 全绿，165/165 自动测试通过；
- npm dry-run 包 45 个文件全部命中白名单；
- rc.2（43190）和 alpha.2（43191）均完成四类制品生成、真实 XLSX 反向解析和跨 Host 重启恢复；
- rc.2 完成浅色、深色和 820×900 窄屏真实页面回归，无页面横向溢出；
- 最近任务恢复显示原 taskId 和四个下载按钮，不会误创建新草稿；
- 未触碰生产端口 43120，未执行新的真实 QCC 调用。

## 升级与回滚

- 升级：安装 `dsh-data-cleaning-agent@0.6.0` 并完全重启 DSH。
- 回滚：重新安装 `dsh-data-cleaning-agent@0.5.3` 并完全重启 DSH。
- 回滚不会删除 `dc_workflows_v2` 或工作区制品；0.5.3 会忽略这些新增数据。
- 完整说明见 `docs/UI-WORKFLOW-V2-MIGRATION.md`。

## 外部发布核验

- PR [#1](https://github.com/duhu2000/dsh-data-cleaning-agent/pull/1) 全部 CI 通过后合并；
  `v0.6.0` 指向合并提交 `084efd0`。
- Release workflow [33817341580](https://github.com/duhu2000/dsh-data-cleaning-agent/actions/runs/33817341580)
  全绿，npm OIDC publish 与 GitHub Release 两个发布步骤均成功。
- npm `latest` 为 `0.6.0`；发布时间为 2026-09-03T23:23:12Z（北京时间 2026-09-04 07:23）。
- tarball SHA-1：`559db5f3de6ef799b0d7549d0bebb144e8cfb91d`。
- tarball integrity：
  `sha512-ib83dgrBNnubouISvnzJb/zbjuBnJXEuee/fVgSzlZZcZLdA/5aB8fb4YF0L+DmOINIJfb44akUMBnBajv7lVg==`。
- npm Registry 返回 SLSA v1 provenance attestation；隔离安装后的 `npm audit signatures` 验证
  10 个 Registry 签名和 1 个 attestation。
- 从公共 Registry 全新安装 `dsh-data-cleaning-agent@0.6.0` 成功；包版本、五步工作流契约和
  `WorkflowArtifactStore` 导入验证通过。
- GitHub Release [v0.6.0](https://github.com/duhu2000/dsh-data-cleaning-agent/releases/tag/v0.6.0)
  已发布，非 draft、非 prerelease。
