# DSH-UX-001 v1.5.4 采用记录

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
