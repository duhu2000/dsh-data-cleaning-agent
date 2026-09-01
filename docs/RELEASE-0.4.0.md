# 0.4.0 发布候选检查单

- 源码版本：`0.4.0`
- 状态：发布候选，尚未创建 `v0.4.0` tag、GitHub Release 或 npm 发布
- 基线日期：2026-09-01

## 已纳入范围

- `enterprise-enrichment` 扩展为工商全景、股权、治理和历史工商维度组按需调用。
- 固化 16 个当前工商工具与 4 个历史工商工具契约，并兼容
  `qcc-dsh-mcp-oauth@0.1.7` 实测 legacy serverName。
- 新增只读 `/data-cleaning/api/phase2/capabilities` 预检、真实证据验收器与默认关闭的本地 Runner。
- G5 Host Bridge 提供批量幂等、多候选人工续跑、retryable 失败人工重试、取消/超时、错误分类和脱敏审计。
- 发布 workflow 在发布前执行完整 `npm run check`，并强制 Git tag 与 `package.json` 版本一致。

## 已通过门

- 单元、契约、Web 路由、Skill、脱敏和 Runner 自动测试。
- npm 打包白名单与 README/包版本一致性检查。
- DSH `0.1.1-rc.2` / `0.1.2-alpha.2` 隔离 Host 加载冒烟。
- rc.2 隔离 Host 真实 OAuth、授权跨重启恢复、20 家公开企业、400 次 QCC 调用：
  20/20 主体解析，每企业当前工商最低 15 维、历史工商 4 维。
- 真实证据与报告仅保存在 Git 忽略的本机目录，不进入仓库或 npm 包。

## 发布阻断门

以下项目完成前，不创建 `v0.4.0` tag，不触发 npm 发布：

1. 等待 access token 自然到期，验证真实 refresh 轮换以及动态工具恢复。
2. 在不重复真实付费批次的前提下，完成 401、429、配额不足故障注入，核对错误码、重试语义与审计脱敏。
3. `main` push 后确认 Linux Node 22/24 与 Windows Node 24 CI 全绿。

## 发布命令（阻断门全部通过后）

```bash
npm run check
git status --short
git tag -a v0.4.0 -m "Release v0.4.0"
git push origin v0.4.0
```

`v0.4.0` tag 会触发 `.github/workflows/release.yml`：校验 tag/包版本、执行完整检查、
通过 npm OIDC Trusted Publishing 发布并生成 GitHub Release。不要手工写入生产密钥。

## 回滚

- tag 尚未推送：删除本地 tag，修复后重新检查。
- tag 已推送但 workflow 未发布 npm：停止 workflow，修复后使用新的补丁版本；不要复用已公开 tag。
- npm 已发布：npm 版本不可覆盖。立即在 GitHub/npm 标记受影响版本，必要时执行 `npm deprecate`，
  修复后发布 `0.4.1`；代码回滚使用普通 revert commit，不改写 `main` 历史。
