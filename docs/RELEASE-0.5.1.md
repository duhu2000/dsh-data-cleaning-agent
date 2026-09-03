# 0.5.1 文档补丁发布记录

> 版本：**0.5.1**（文档与发布流程修正，无运行时代码变化）
>
> 公共发布状态以 npm Registry 与 GitHub Releases 为准；本文件随 0.5.1 发布物固化。

## 1. 目的与范围

0.5.1 只修正 0.5.0 npm tarball 中不可变 README 的历史状态文案，并加固发布流程：

- 中英文 README 随 `package.json` 更新为 0.5.1 文档补丁候选；
- 标签发布时，`docs:check` 强制要求两份 README 都声明当前版本已正式发布；
- Release workflow 显式设置 `DSH_RELEASE_MODE=1`，严格文案门在 `npm publish` 前执行；
- 增加普通分支允许候选、标签拒绝候选、标签接受正式文案三项单测；
- 新发布记录进入 npm 包白名单。

本补丁不修改 DSH Host/Client、QCC Bridge、OAuth、工具契约、API、数据流或 UI，不产生 QCC 调用。

## 2. 兼容性

运行时兼容性与 0.5.0 完全相同：

- 稳定基线：DSH `0.1.1-rc.2`；
- 兼容探针：DSH `0.1.2-alpha.2`；
- Node CI：22 / 24；
- QCC OAuth：`qcc-dsh-mcp-oauth@0.1.7`。

## 3. 发布前门

- [x] `npm run check` 全绿：128/128 测试、36 个发布白名单文件。
- [x] `DSH_RELEASE_MODE=1 npm run docs:check` 在候选文案下按预期以退出码 1 失败。
- [x] 候选提交 `c03b1bd` 的 CI `33709568591` 全绿：Linux Node 22/24、Windows Node 24。
- [x] 发布前将 README.md / README.en.md 切换为不含动态 `latest` 的 0.5.1 正式发布态。
- [x] `DSH_RELEASE_MODE=1 npm run check` 在正式文案下全绿：128/128、36 文件。
- [x] 用户单独批准 `v0.5.1` tag、OIDC npm publish 与 GitHub Release。
- [ ] 发布后核验 SLSA provenance、GitHub Latest 与公共 Registry 全新安装。

未经最后两项确认，不得创建标签或发布 npm。

## 4. 回滚

本补丁无运行时代码变化。需要回滚时安装已发布的 0.5.0：

```bash
dsh plugin --profile web add dsh-data-cleaning-agent@0.5.0
```

不得覆盖已发布的 npm 版本。
