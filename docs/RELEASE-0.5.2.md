# 0.5.2 DSH 原生 UI 对齐发布记录

> 版本：**0.5.2**
>
> 状态：**正式版本；由 `v0.5.2` 标签触发 npm OIDC Trusted Publishing 与 GitHub Release。**
>
> 发布日期：2026-09-03

## 1. 目的与范围

0.5.2 将数据清洗补全智能体的入口和工作流对齐 DSH 原生交互：

- 左栏入口位于「新会话」与「工作区」之间，不再显示在侧栏底部；
- 点击入口后复用中央原生会话，并预填数据清洗提示词；
- 原生输入框工具行提供上传清洗、质量体检、匹配核验、字段补全和任务历史五个入口；
- 工作台改为非模态右侧面板，中央会话保持可见；
- 任务历史复用 Host `/mvp/jobs` 状态，可恢复已有任务；
- 对 DSH `0.1.1-rc.2` 与 `0.1.2-alpha.2` 的 workspace 连接服务做隔离能力探测。

本版本不扩展历史域、人员域或招投标域，不改变 QCC OAuth、计费确认、工具允许列表或数据契约。

## 2. 验证

- `DSH_RELEASE_MODE=1 npm run check`：lint、双语正式版本文案、marketing、pack 白名单和 132 项测试全部通过；
- DSH `0.1.1-rc.2` / `0.1.2-alpha.2` 全新隔离安装与 UI 冒烟通过；
- 已验证顶部入口、中央原生会话、五能力按钮、非模态右栏、布局避让、上传解析和质量体检；
- 本轮 UI 验收没有调用 QCC，也没有触碰生产 DSH Host。

## 3. 升级与回滚

升级：

```bash
dsh plugin --profile web add dsh-data-cleaning-agent@0.5.2
```

如需回滚，安装上一稳定版本：

```bash
dsh plugin --profile web add dsh-data-cleaning-agent@0.5.1
```

npm 已发布版本不可覆盖；如发布后发现问题，使用新的补丁版本修复。
