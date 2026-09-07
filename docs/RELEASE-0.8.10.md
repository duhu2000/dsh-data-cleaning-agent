# v0.8.10 发布清单

日期：2026-09-07；状态：release candidate（发布前快照）。

## 范围

- 包名：`dsh-data-cleaning-agent`；远端：`duhu2000/dsh-data-cleaning-agent`；分支：`main`；目标 Tag：`v0.8.10`；回滚版本：`0.8.9`。
- 包含右侧工作台连续调宽、键盘/指针取消/复位、手动宽度恢复、实际可用区域约束和原生输入区让位。
- Host、QCC、OCR、128 字段、任务存储与导出格式不变；不自动安装或重启本机 DSH。
- 共享规范及 HTML 原型已在仓库外更新到 v1.3.0，不复制进本仓库或 npm 包；本仓库记录采用边界与验收证据。

## 发布门禁与执行顺序

1. 版本及中英文 README、Changelog 同步；保留 Unreleased。
2. `npm run check`：214 项检查测试、语法/文档/市场材料/打包白名单通过。
3. `npm run test:ui`：深浅色各 5 种窗口尺寸，共 10 组隔离 Chromium 回归通过。
4. 提交和推送 main，等待必需 CI 通过，再创建并推送 annotated Tag。
5. Tag 工作流核对版本、复跑门禁，通过 GitHub OIDC 发布 npm（含 provenance），创建 GitHub Release。
6. 回读远端 main/Tag SHA、npm 版本/latest/provenance 与 Release；不重复发布相同版本。

## 验收与回滚边界

详细证据见 [调宽验收](WORKBENCH-RESIZE-ACCEPTANCE.md)。隔离组件回归不等于真实 DSH 安装验收；升级后需验证实际侧边栏布局、工作台拖拽与输入区让位。宽度偏好仅保留在客户端生命周期内，无持久数据迁移；异常时安装上一稳定包 `dsh-data-cleaning-agent@0.8.9` 并重启 DSH。Tag/npm 不覆盖、不移动。

最终发布结果以 GitHub Actions、Release 与 npm Registry 实际记录为准，不以本文候选快照代替。
