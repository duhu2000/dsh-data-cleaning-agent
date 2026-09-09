# v1.5.0 统一侧拉采用记录（0.9.0 采用记录）

开发基线 main / 623408e（0.8.23）。2026-09-10 用户授权推进 commit、push、tag 和 npm 发布，本次版本为 0.9.0；不包含市场条目更新。

已完整阅读规范第 7、13.4、14、15、15.1 节，并检查配套 Mockup 的 Session 单例、历史同 Tab 和宿主管理几何语义。

## 主链路与采用范围

- lib/client.js 不再注册 shell.overlay 工作台。移除固定抽屉、拖拽分隔条、width/expanded 状态、容器展开/关闭按钮、全局 resize 与中央会话 padding/位移逻辑。
- WorkbenchContent 只渲染当前任务、五阶段、任务历史和结果操作。Header 由 Host Tab 提供；业务状态集中在任务进度卡。窄栏采用容器查询，不依赖浏览器窗口宽度判断布局。
- lib/better-sidebar-adapter.js 注册稳定命名空间 id：dsh-data-cleaning-agent:workbench，single:true。显式传入 Session scope；五个快捷入口、Header 恢复、执行进度自动打开均经过同一 adapter。
- 插件级控制器按 Session 保存独立业务 store，Tab 只是视图。关闭/隐藏 Tab 不删除、取消或重跑 Host 任务；重新打开恢复原数据和内部视图。读取已有任务绑定不再隐式新建任务。
- 跨作用域事件由一个带引用计数的控制器接收，提示词准备/OCR/数据暂存无需先挂载 Tab。跨 Session 不共用业务 store；非前台 Session reveal 等待订阅切换后消费，不挤占当前会话布局。
- 使用可选 ctx.inject(['betterSidebar'], ...) 子生命周期，避免访问未授予的 Cordis 服务；Provider 缺失或移除不卸载业务控制器、会话入口和 Host 工具。
- 缺依赖/过旧契约/Tab 禁用时显示可行动提示，无旧抽屉回退。Provider 卸载释放描述符和状态订阅；插件卸载移除事件监听、pending intent 和本地命令观察，Host 任务不受影响。
- 任务、规则、字段目录、OCR、MCP 和制品后端契约未重写。

## 接口与构建边界

探测 registerTab/openTab/isTabEnabled/getSnapshot/subscribeState 和 targetedOpen/stateSubscription。
type-only openTab 后通过该 Tab 的公开 store.reduce reveal 所在右侧/底部容器；浮窗不变更几何。
未使用 tabLifecycle，所以没有依赖该能力。

参考类型：本地 Better Sidebar 0.17.1 的 service 声明及 Cordis 4.0.1 的 inject/Fiber 生命周期。
不据此宣称其他 Provider 版本或真实组合场景已经验收。

现有 ModuleLoader 为单文件 CJS 工厂：scripts/sync-sidebar-adapter.mjs 将被测试的 adapter 嵌入 client.js。
修改 adapter 后运行 node scripts/sync-sidebar-adapter.mjs --write；静态测试校验嵌入内容一致，防止源码与运行代码漂移。

## 本地验证

- npm run check：语法、文档、营销/打包门禁与完整 256 项测试通过。
- npm run test:ui：隔离 React/Chromium + 模拟 Better Sidebar，10 组明暗主题/窗口尺寸；另外验证桌面 320px 与宽 Tab。
- 浏览器覆盖：上传/替换失败保留旧数据、映射搜索和重复列、表格横向滚动和固定表头、提示词准备、执行后自动打开、结果制品操作、Tab 关闭重开、宿主折叠恢复、Session 离开与普通会话隔离。
- 单元/静态覆盖：单例注册和入口幂等、Session store 隔离、inactive pending reveal、底部/浮窗 reveal、依赖缺失/过旧/禁用、Provider 到达/移除、重复卸载幂等、无固定几何/中央让位、无任务取消删除副作用。
- 证据：_scratch/ui-layout/results.json 与同目录截图（本地夹具产物，不进入 npm）。
- 没有调用真实 QCC，不消耗用户额度；没有覆盖上传源文件。

## 真实 DSH 验收限制与发布门

本轮未替换运行中 3080 Profile，未进行真实 DSH + Better Sidebar 或四插件共存安装验收。
真实侧栏生命周期、底部停靠/浮窗、四插件切换、Host 动态移除 Provider、实际 OCR/授权链路需在隔离 Profile 联调。
本地 UI 模拟通过不等于真实 Provider 验收；用户已授权在上述已知限制下发布 0.9.0；真实组合联调仍需补做，不将发布成功视为联调通过。
