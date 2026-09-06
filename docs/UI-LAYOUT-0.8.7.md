# 0.8.7 页面职责收敛与验收

## 范围

中央首页只负责表达任务，提示词向导负责组织任务，右侧工作台负责核验、执行、结果与历史管理。保留既有 Host taskId、字段目录、QCC 调用与导出契约；不新增领域或收费能力。

菜单仅导航，不标记为任务执行进度。质量体检与规则共用第二阶段；历史独立于五步工作流。帮助文案折叠在工作台。新建任务由同会话向导接收成功后才清理旧的浏览器运行态；Host 历史任务/制品不删除。

## 兼容边界

DSH 当前公开的 input.dock 位于 composer 之前，仅设置 order 不能保证跨容器重排。自有菜单 Portal 根据 data-composer-seat 与 data-composer-card 定位到输入分支后面，保留共享槽位与其他插件 DOM；卸载删除自有节点，观察器断开。标记不可用时保留原槽位可操作菜单，不猜测其他插件容器。

向导触发器继续使用官方 input.overlay；对话框本体 Portal 到 document.body，避开输入框裁切。会话归属变更后关闭并清理业务表面；不改写已安装 DSH bundle。

## 自动化验收

- npm run check：213 项测试（含完整清单、图片回填、规则、匹配、导出与恢复），另含 lint、文档与发布包白名单检查。
- scripts/ui-layout-regression.mjs：真实 React 19 + 无头 Chromium，复刻本机 DSH 的 composer seat/stack/card/slot 层级；不是已安装 DSH 的端到端验收。
- 8 个组合：light/dark × 1440×900、1024×768、390×700、900×500。
- 断言：菜单在输入框下方且只有一份；共享的其他插件节点保留；模态弹窗在视口内、长字段正文可滚动、底部按钮可见；Tab 循环和 Escape；关闭重开保留设置；两企业文本任务回填、输入框焦点及发送按钮可用；工作台正常/展开不遮挡输入框；任务历史与流程导航隔离；活动会话和普通会话切换清理。
- 截图与结果写入 _scratch/ui-layout，使用合成名单，不包含真实客户记录、不调用 QCC。

## 复现

在仓库执行（测试依赖隔离，不加入插件运行依赖）：

```sh
npm install --prefix _scratch/ui-deps --ignore-scripts --no-audit --no-fund react@19.2.8 react-dom@19.2.8 esbuild@0.25.12 playwright@1.62.1
node _scratch/ui-deps/node_modules/playwright/cli.js install chromium
DCQ_UI_DEPS=_scratch/ui-deps/node_modules DCQ_PLAYWRIGHT=_scratch/ui-deps/node_modules/playwright npm run test:ui
```

可使用 DCQ_CHROME 指向本机 Chrome 可执行文件。浏览器使用临时 profile，不使用当前用户浏览器资料。

## 更新与回滚

市场更新到 0.8.7 后完全重启 DSH，再检查真实宿主的首页与活动会话。重启前下载尚未保存的原始核验数据；该版本不迁移 Host 存储结构。需回滚时固定安装 0.8.6 并重启；已保存任务和下载制品不因本次 UI 调整删除。不同 DSH/第三方插件组合仍需安装后现场确认，不能将隔离组件测试视为所有宿主版本的实测通过。
