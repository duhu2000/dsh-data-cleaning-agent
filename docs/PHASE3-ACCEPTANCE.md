# 0.5.0 三域补全验收记录

> 状态：**本地 / Mock / 双基线零调用门已通过；维护者测试账号的真实三域计费 E2E 待显式批准。**
>
> 记录日期：2026-09-02

## 1. 验收范围

0.5.0 覆盖企查查风险、知识产权、经营三域：

| 域 | 工具数 | 规范前缀 |
| --- | ---: | --- |
| 风险 | 38 | `mcp__qcc-risk__*` |
| 知识产权 | 18 | `mcp__qcc-ipr__*` |
| 经营 | 35 | `mcp__qcc-operation__*` |
| 合计 | 91 | — |

验收同时覆盖批量 Host Bridge、同源 Web API、四步工作台、安全门、任务恢复、导出与发布包。

## 2. 已通过门

### 2.1 自动化

- `npm run check`：125/125 测试通过。
- 三域工具规范名、OAuth 0.1.7 legacy 名和短名共 91 个逐一归一化测试通过。
- 未确认付费、幂等冲突、调用上限、工具缺失、多候选、部分失败、人工重试、TTL 失效均有回归。
- `e2e:phase3` 默认关闭、只允许回环 Host、preflight 失败关闭、`0600` 脱敏报告均有测试。

### 2.2 DSH 双基线零调用 Host 冒烟

使用当前 tarball 装入隔离 profile，未触碰生产端口 `43120`：

| 基线 | 端口 | 结果 |
| --- | ---: | --- |
| DSH `0.1.1-rc.2` | 43136 | 12/12 PASS |
| DSH `0.1.2-alpha.2` | 43137 | 12/12 PASS |

每条基线覆盖 Host 启动、MVP seam/parse/clean/complete/profile/jobs/UI、Phase-3 capabilities、
零调用 estimate，以及未确认 enrich 在 ToolRuntime 前返回 409。合计 24/24 PASS。

### 2.3 rc.2 实际渲染与交互

- DSH 侧边栏「数据清洗」入口可发现。
- 四步工作台实际渲染：上传与映射 → 数据体检 → 匹配核验 → 补全与导出。
- 修复真实 React Host 才暴露的 #310 hooks 顺序问题；修复后工作台打开无崩溃。
- 中文 CSV 的“企业名称”自动映射；解析后留在映射页供确认。
- 两行中文企业数据进入本地清洗后保留 2、误删 0；未发起任何真实 QCC 调用。

### 2.4 0.5.0 最终候选安装物

- `npm run check` 通过，pack 白名单共 35 个文件。
- 0.5.0 最终 tarball 已安装到全新 DSH `0.1.1-rc.2` 隔离 profile，并在端口 `43164` 启动。
- `mvp-seam` 返回 Host/Web/三工具/两个 Skill 注册成功，`enrichSkillRegistered: true`。
- Phase-3 capabilities 和 estimate 可达；一行企业、三域全选的调用上界估算为 92 次。
- 未确认付费 enrich 在 ToolRuntime 前返回 409；全新 profile 未安装 OAuth 插件时明确返回
  `oauth-plugin-missing`，未误报三域工具可用。
- 未触碰生产端口 `43120`，未产生任何真实 QCC 调用。

## 3. 开发者测试账号的真实计费 E2E 门（尚未执行）

本节只约束发布前由维护者使用**自己的测试 Key / QCC 账号**执行的真实三域 E2E；测试产生的额度
或费用由维护者自己承担。客户在生产使用时必须连接客户自己的 QCC MCP 账号，额度或费用由客户
依据其自身企查查合同承担；插件开发者不代付、不垫付，也不向客户提供开发者 Key。

真实三域测试会消耗维护者测试账号的 QCC 调用额度，因此不从本地门自动继承授权。执行前必须明确批准：

1. 企业夹具（建议先 1–3 家公开企业）；
2. 精确域或工具清单；
3. `maxCalls` 上限与维护者测试账号预算；
4. 隔离 DSH Home、端口和报告目录；
5. 是否允许候选确认后的续跑与失败工具人工重试。

未同时获得上述批准时，不得设置 `PHASE3_E2E_CONFIRM_PAID_CALLS=YES`。

## 4. Runner 用法

零调用 preflight 仍要求 Host 已注册 91/91 三域工具：

```bash
PHASE3_E2E=1 \
PHASE3_E2E_MODE=preflight \
PHASE3_BASE_URL=http://127.0.0.1:43162 \
npm run e2e:phase3
```

真实 enrich 仅在批准后执行。夹具应放在 Git 忽略目录，并设为 `0600`：

```json
{
  "headers": ["name"],
  "nameField": "name",
  "rows": [{ "name": "APPROVED_PUBLIC_COMPANY" }],
  "domains": ["risk"],
  "tools": [],
  "maxCalls": 39,
  "concurrency": 1
}
```

```bash
PHASE3_E2E=1 \
PHASE3_E2E_MODE=enrich \
PHASE3_E2E_CONFIRM_PAID_CALLS=YES \
PHASE3_BASE_URL=http://127.0.0.1:43162 \
PHASE3_FIXTURE_PATH=.phase3-e2e/approved.json \
PHASE3_E2E_REPORT=.phase3-e2e/report.json \
npm run e2e:phase3
```

## 5. 发布判断

- 本地代码、Mock、Web、UI 和双基线零调用门：**GO**。
- npm pack / 全新隔离安装物料：**GO**。
- 维护者测试账号真实三域计费 E2E：**HOLD，等待维护者批准测试夹具、调用上限及自担测试预算**。
- tag、npm publish、GitHub Release：**HOLD，必须单独批准**。
