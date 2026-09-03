# 0.5.0 发布候选记录

> 状态：**Release candidate；未打 tag、未发布 npm、未创建 GitHub Release。**
>
> npm `latest` 仍为 `0.4.0`。

## 1. 范围

0.5.0 在 0.4.0 工商/历史工商 Host Bridge 上新增：

- 风险 38 + 知产 18 + 经营 35 的 91 工具冻结契约；
- 三域批量服务与 30 分钟 Host 内存 run；
- capabilities / estimate / enrich / resolve / retry / run 同源 API；
- 四步 Mockup 对齐工作台、域组选择、调用估算、付费二次确认；
- 多候选人工续跑、部分失败人工重试、结果/复核双 CSV；
- 默认关闭、回环限定、失败关闭的 Phase-3 E2E Runner。

0.5.0 不新增 OAuth 存储或私有 MCP client。所有调用继续走公共 `ctx.tools.get/execute`，
OAuth/token 生命周期由 `qcc-dsh-mcp-oauth` 和 `dsh-mcp-client` 负责。

## 2. 兼容矩阵

| 组合 | 级别 | 当前结论 |
| --- | --- | --- |
| DSH `0.1.1-rc.2` | 稳定发布基线 | Host/API 12/12；实际工作台渲染与字段映射闭环通过 |
| DSH `0.1.2-alpha.2` | 兼容探针 | Host/API 12/12；不承诺 alpha 私有/实验 API 稳定性 |
| Node 22 / 24 | CI 基线 | `npm run check` 目标矩阵 |
| `qcc-dsh-mcp-oauth@0.1.7` | 已验证 OAuth 线 | Bridge 兼容 canonical 与 legacy serverName |

## 3. 升级

从 0.4.0 升级：

```bash
dsh plugin --profile web add dsh-data-cleaning-agent@0.5.0
```

然后完全停止并重启 `dsh web`。升级是加法变更：

- 现有 `data_clean_rows` / `data_complete_rows` / `data_profile` 不变；
- `data-cleaning` 与 `enterprise-enrichment` Skill 名不变；
- `/data-cleaning/api/mvp/*` 与 `/data-cleaning/api/g5/*` 保留；
- 新增 `/data-cleaning/api/phase3/*`；
- `dc_tasks_v1` 存储域不迁移；Phase-3 run 只在 Host 内存保存，重启后按设计失效。

升级后先运行零调用 capabilities / estimate，再批准任何付费批次。

## 4. 回滚

回滚到已发布 0.4.0：

```bash
dsh plugin --profile web add dsh-data-cleaning-agent@0.4.0
```

完全重启 Host。回滚影响：

- Phase-3 路由和三域工作台能力消失；
- 正在运行或等待复核的 Phase-3 内存 run 丢失，需从原输入新建任务；
- 本地 CSV 文件、已下载结果和 `dc_tasks_v1` 不删除；
- 0.4.0 的 G5 工商批量能力继续可用。

不得通过覆盖已发布 npm 版本实现回滚；只安装明确版本。

## 5. 已完成发布门

- [x] `npm run check` 125/125；lint/docs/marketing/pack 全绿。
- [x] rc.2 / alpha.2 隔离 Host 零调用冒烟 24/24。
- [x] rc.2 实际 UI 渲染、上传映射、体检、中文字段清洗闭环。
- [x] 计费确认、幂等、上限、多候选、重试、脱敏回归。
- [x] README 中英文、CHANGELOG、兼容矩阵、用户指南、验收记录、升级/回滚。
- [x] 0.5.0 包白名单与 release-candidate 文档。
- [x] 最终候选执行 `npm run check` 与 pack 内容复核，tarball 为 35 个白名单文件。
- [x] 最终候选 tarball 安装到全新 DSH `0.1.1-rc.2` 隔离 profile 并启动成功。
- [x] 隔离 Host 验证 seam、Phase-3 capabilities / estimate 与未确认付费失败关闭；未触碰生产端口 `43120`。

## 6. 发布前外部门

- [ ] 维护者批准后，用维护者自己的 QCC 测试账号执行最小真实三域计费 E2E，或书面接受该门后置；
  客户生产账号及费用不属于此发布门。
- [ ] 用户明确批准创建并推送 `v0.5.0` tag。
- [ ] 等待 OIDC workflow 完成 npm provenance 与 GitHub Release；再核验公共 Registry 全新安装。

发布前任何一项失败都不得移动 `latest`。
