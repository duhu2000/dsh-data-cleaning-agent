# PLAN-REVIEW — GPT 实施规划核对纪要

> 状态：核对完成（本文件为可逆的新增文件，未修改任何原始材料）
> 核对日期：2026-08-31
> 被核对对象：`.../智能体-在线清洗补全/DeepSeek_Harness_数据清洗补全智能体插件_实施规划.md`（GPT 产出，655 行）
> 原始输入文档：`.../智能体-在线清洗补全/数据清洗补全工具-产品规划设计文档.md`（mtime 12:15 早于规划 12:30，未修改）

## 0. 结论摘要

GPT 规划质量高、方向正确、证据链扎实：核心结论（混合 Bundle 架构 / 模型不读整表原始数据 / 先技术验证后 MVP / 暂不公开建仓）全部成立。其三个"平台级"论断经本机 DSH 与一手资料逐项验证，**全部属实**。需留意两处表述精度、一处未经官方 release notes 逐字核对的时点断言，详见第 3 节。

## 1. 事实核对表

| GPT 论断 | 验证结果 | 证据 |
|---|---|---|
| 本机 DSH 框架为 `0.1.1-rc.2` | ✅ 属实 | 本机 `DSH Desktop.app/.../app.asar.unpacked/package.json` 中全部 `@deepseek-ai/*` 依赖精确 pin 为 `0.1.1-rc.2` |
| 官方最新预发布 `v0.1.2-alpha.2` | ✅ 属实 | 官方 tag [dsh-v0.1.2-alpha.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.2) |
| alpha 版本移除 ApiProxy、迁移 `@Remote` 网关 | ✅ 方向属实 | 本机 rc.2 同时存在 `@deepseek-ai/dsh-host-apiproxy`（`ctx.apiProxy`）与 `@deepseek-ai/dsh-api-remotes`（`ctx.remote`，README 自述为 Host/Client 双侧 BFF），印证迁移已在进行；另有第三方报道《APIProxy 没了》佐证 |
| 工具注册 API `ctx.tools.register()` | ✅ 属实 | 本机 `@deepseek-ai/dsh-tools` README 原文：`ctx.tools.register(definition): () => void` |
| Skill 注册 API `ctx.skills.register()` | ✅ 属实 | 本机 `@deepseek-ai/dsh-skill` README 原文：`ctx.skills.register(skill)`，另有 `registerProvider(...)` |
| 插件需声明 `dsh.bundle.patch`（`cordis.patch.yml`）+ `dsh.client.inject` | ✅ 属实 | 参考插件 `mcp-connector-plugin-release-0.2.32/package.json` 的 `dsh.bundle.patch` 与 `dsh.client.inject`；Desktop 根目录即有 `cordis.patch.yml` |
| **SecretKey 不传输，仅用于生成 Token**（GPT 对产品文档的纠正） | ✅ 纠正正确 | 一手源 `16_专业版页面嵌入插件集成V2.1.md` L377-379、L402-404：`SecretKey | String | 不传递 | 密钥…请妥善保管`。**产品设计文档第 10.2 节把 SecretKey 写进"http header 传递的三项"确属错误** |
| 缺少正式数据清洗 Job API | ✅ 属实 | 设计文档第 10 章仅定义嵌入路由 `/data-terminal/data-clean` + Token 签名，全文无 upload/parse/candidate/complete/status/cancel/export 契约；本会话可用企查查 MCP 工具（company/case/risk/tender/regulation/executive/operation/ipr 等）均为单次查询类，无批处理清洗 Job API |
| 配额数字（1000 家/次、5000 家/次每日 10 次全年 50 万、10 万家/次） | ✅ 属实 | 与设计文档 5.2 完全一致 |

## 2. 与用户约束的符合性

- ✅ 只读核对：原始设计文档 mtime（12:15）早于规划（12:30），两份规划 diff 为空，原文件未被动过。
- ✅ "已验证事实 / 设计建议"边界清晰：GPT 把本机可验的 API 面（tools/skills/bundle.patch）标为已验证，把字段包、阈值、配额统计口径等标为待定。
- ✅ 暂不建仓/不发布：规划第 6 章明确"公开 GitHub、npm 包、市场提交、生产凭据、客户试运行均应另行说明并授权"。
- ✅ GitHub 治理方案覆盖仓库边界/分支/Issue-RFC/PR 与 CODEOWNERS/CI/依赖密钥/许可证/版本升级回滚七个面，团队名、许可证均标注"占位、待法务确认"。

## 3. 三处修正

1. **"alpha.1 移除 ApiProxy" 的精确时点未经官方 changelog 逐字确认。**
   已验证"方向属实"（本机 rc.2 已双包并存 + 官方 tag 存在），但"alpha.1 移除"这一具体版本号细节应再以官方 release notes 逐字核对后方可写入 ADR，避免把二手报道当官方事实。

2. **两个"版本"概念需区分。**
   "本机 0.1.1-rc.2"指 `@deepseek-ai/*` 插件框架 npm 包线；而本机 Desktop 启动器（launcher）自身版本为 `dsh-plugin-desktop@2.0.2`。二者不是一回事。COMPATIBILITY 表应加一行 launcher 版本，防止后续混淆。

3. **Mockup 是"四步工作台"，产品文档是"三步闭环"。**
   GPT 规划中 Client 叫"三步向导"，产品文档 6.1 也是"上传→匹配→导出"三步；但 UI Mockup 实际拆成**上传与映射 / 数据体检 / 匹配核验 / 补全与导出**四个 pane。两者不矛盾，但 `docs/DATA-FLOW.md` 应把四 pane ↔ 三步骤映射写死，"数据体检"须为独立 pane。

## 4. 补充发现（本次核对新增，超出原三处修正）

**Node engine 口径不一致。** 本机 DSH Desktop 的 `engines` 为 `^22.19.0 || >=24.0.0`；而 GPT 技术验证仓库 `package.json` 写 `engines: ">=20"`，CI 矩阵写"Node 20/22/24 以 Spike 收敛"。建议 CI 矩阵与本地 package.json 以 **22 / 24** 为准收敛，避免在 Node 20 上做无效验证。

## 5. 下一步建议

维持 GPT 的 Gate：先建内部技术验证仓库，只做 5 个 Spike + 并行补产品/API 信息。顺序细化：

> 5 个 Spike 中 **先做 #1 Bundle 安装 Spike 和 #2 Host/Client Bridge Spike**，它们直接决定"rc.2 要不要兼容"这个最贵的分支；未验 Bridge 维护成本前，后 3 个 Spike 可能在错误基线上返工。此顺序应在 `docs/adr/0001-dsh-baseline.md` 中显式列为前置。

---

*附：本目录 `docs/adr/0001-dsh-baseline.md` 已按本纪要第 3、4 节更新基线表述。*
