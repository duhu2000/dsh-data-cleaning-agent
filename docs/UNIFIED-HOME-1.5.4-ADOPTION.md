# DSH-UX-001 首页规范采用记录

## v1.5.6 / UX49-CLEAN（2026-09-15，0.9.16）

发布授权补充：用户于实施与 PR 验证后明确要求 commit、push、tag、npm，按仓库既有 CI、合并及 OIDC 发布流程推进 0.9.16；原实施阶段仅授权 PR 的边界作为历史记录保留。

依据共享 `DSH智能体开发交互规范方案.md` 的 UX-49、§11.1、§14，并核对 UX-48；协同清单 `DSH-UX-049-四智能体首页初始引导协同.md` 及总账同日交接。这里只记录采用与差异，不复制规范全文。

- 审计基线：remote main `fc7d57240b843e1a57998cf0ebbe4f39c086befb`，npm latest 0.9.15 / gitHead `6d8b37a7a0efae1aa2fddc72d61fc5e732f3231f`。原仓 main 的未提交 client/test 修改保持原样，另建独立分支。
- 已有正确项：独立清洗 Session namespace、宿主原生输入接口、实际接纳后开台、标题 settling→hero 修复、历史来源只读与主结果/报告分层。
- 真实缺陷：入口无条件 setDraft；普通会话异步恢复时按宽泛签名清理草稿；已有业务入口再次点击会开台；向导缺少已有内容确认与晚到写入检查。以上已收紧。
- 初始模板 `dsh-initial-draft/data-cleaning/1` / version 1，UTF-8 SHA-256 `2b84b86f669e64e970381e4c7ab8547c77d5e10ee7d5441543c893b9f1272e2b`。仅精确相等才排除；不 trim、不按前后缀忽略用户修改。
- 初始化仅由本入口成功创建的全新 ID 触发，在打开会话前操作未挂载的原生 shell，避免 Host setDraft 的选区写入抢占已挂载输入焦点。snapshot 缺失或非 plain、draft 非空、draftRev 非零、imageIds/occurrences 非空均跳过。建立一次性记录、订阅后重读、微任务后再次快照；期间用户输入/附件/组合事件、会话切换或卸载使写入失效，无轮询补回。
- 清洗业务 Skill 将信息充分性检查置于任何工具之前：占位符/缺名单或待补字段先澄清；没有注册全局发送拦截。安全凭证所指暂存来源仍可提供名单和范围，不重复要求上传。
- 向导按 UX-10 提供替换/追加/取消，默认保留用户内容；同一 Session 未改的向导草稿更新而非重复叠加。异步回填重读草稿版本、附件和当前业务归属。
- 本地门禁：`npm run check` 通过（296 项测试，语法/文档/营销/69 文件 pack 白名单）；Chromium 浅深色 × 5 尺寸 10/10；XLSX 预览 390/800/1440px 3/3。包含附件、IME 事件、晚到修改/清空、卸载、A/B、普通 Session、Tab X/折叠恢复、草稿回填替换/追加/取消与零开台断言。
- 真实 DSH：`scripts/ux49-native-smoke.mjs`，独立 Profile、无模型/MCP 凭据。DSH 0.1.2-rc.1 + Sidebar 0.18.1 + 清洗候选/招投标 0.5.11/访前尽调 0.1.35/填表 0.2.30 共装通过。原生模板、正确 Hero 标题、不移动焦点、主动清空不补回、刷新保留修改、A/B/普通会话隔离、零业务 API mutation、零可见工作台、零浏览器异常均通过。
- 实机客户端 SHA-256 `bacfd1faa7eff584ddec3e948ee3f2e19f1d710224de9068d9a62415345a28a1`，测试包 SHA-256 `e93fac1541934a43bc54789283d57c378fbd721fe0d8fc86b922b2a69c5747c5`。原始报告/截图在 `/var/folders/ws/tmsn44b140lf8b89ml5qqjf00000gn/T/cleaning-ux49-native-HtQGy0/`；本地日志 `/private/tmp/ux49-{check,ui,artifact,native}-release-candidate.log`，UI 截图 `_scratch/ui-layout/`。测试包不是 npm 发布物；随后文档和验收脚本路径清理不改变已验收客户端字节。
- 未验证边界：真实模型执行占位符澄清（仅验证 Skill 优先规则，不冒充实际模型决策）、系统级真实中文输入法（已覆盖组合事件）、收费 QCC/OCR、多账号/其他 Host 版本，以及其余三产品各自 UX49 候选版本。正式 3080/Profile 未修改。
- 本次仅 commit/push/PR/CI；不合并、不升版本、不 tag/Release/npm publish。

## v1.5.4 历史采用记录

日期：2026-09-14。基线：0.9.11 / a0ec971db0d25d42f67f99e4328cca6f49a2bc2f。
本轮仅本地代码与验收，不发布，不修改正式 Profile 或全局 DSH。

## 已采用

- UX-05：首页删除 ProductHome 副标题组件、挂载与 dcAgentHomeSummary 样式；没有替代空白容器。保留原生工作区/模式/输入控件以及输入框下能力菜单，不修改 npm description/搜索文案。
- UX-45：左菜单固定“数据清洗补全”；创建中通过 disabled/aria-busy 表示，ref 门闩阻止同一渲染周期重复创建。失败仍沿用已有工作台错误状态，菜单名称不变。
- UX-46：保留 0.9.11 的真实 data-phase、openState、所有权立即重读和独立 Session namespace。只接管原生已知 Hero 标题或本插件标记；不覆盖其他产品标题，不再隐藏其他产品 dock。清理仅恢复仍为本插件标题的文字，不调用会话 rename API。
- UX-47：任务区明确展示“任务记录”，匹配/补全记录不冒充模型实时运行证明；元数据恢复/轮询失败明确为“状态同步异常”，保留最后记录且不重新查询。已有确认、取消、失败、完成状态继续来自 Host 任务数据，实际主体进度仍来自服务端计数，不伪造百分比。

## 验证范围

- npm run check：277 项通过，包括安装包检查、正文语法与既有业务测试。
- 新增/调整断言：首页不含副标题组件或专属样式；同时点击只创建一个 Session；外产品标题和 dock 不被接管；既有 settling→hero、文本刷新、普通 Session、phase observer 清理继续回归。
- scripts/ui-layout-regression.mjs：10/10 通过，真实 React/Chromium，合成 Host DOM/API fixture，浅/深色 × 5 尺寸。验证品牌、普通会话恢复、晚挂载和无副标题；完整现有导入/映射/确认/下载测试保留。
- 浏览器 fixture 不等于完整真实 DSH 宿主。当前本轮未验证四包真实共装、用户正式页面或真实模型/QCC/OCR；正式版本仍为 0.9.11。

## 边界

清洗目前没有已验证的模型 running 状态接口，不新增假定宿主正在思考的状态条，也不声称掌握模型停止原因。恢复仅读取任务元数据。模型运行态由原生会话显示。

证据：`/private/tmp/dc-unified-home-check.log`、`/private/tmp/dc-unified-home-ui-final.log` 与本工作树 `_scratch/ui-layout/results.json`。最后的未知标题保护收紧由观察器行为测试覆盖，未影响布局；其后完整 277 项检查再次通过。
