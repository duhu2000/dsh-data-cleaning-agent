# G5 真实 E2E 验收手册

- 日期：2026-09-02
- 当前状态：**真实 OAuth、跨重启恢复、token 自然到期刷新、QCC 主调用路径与 401/429/配额故障注入均已执行**
- 适用脚本：`npm run e2e:g5`
- 示例夹具：`test/fixtures/g5-e2e.example.json`（仅虚构数据）

## 安全前提

Runner 默认关闭，并同时执行以下硬门：

1. 必须显式设置 `G5_E2E=1`。
2. `G5_BASE_URL` 只允许 `http://127.0.0.1:*` 或 `http://localhost:*`，拒绝远端地址。
3. `G5_E2E_MODE=enrich` 还必须显式设置 `G5_E2E_CONFIRM_PAID_CALLS=YES`。
4. enrich 模式要求 capabilities 已为 `ready:true`；Runner 不代替用户发起 OAuth 连接。
5. 报告仅保留状态、计数、错误码和安全审计数量，不写原始行、候选详情或 QCC 原始响应。
6. 报告文件以 `0600` 权限创建；默认写入系统临时目录。

不要把真实 Token、企业名单或真实 E2E 报告提交到 Git。仓库已忽略 `.env.g5-e2e` 与 `.g5-e2e/`。

> 2026-09-01 补充：在隔离 rc.2 Profile 中，`qcc-dsh-mcp-oauth@0.1.7` 还需要显式安装
> `@deepseek-ai/dsh-mcp-client@0.1.1-rc.2`；其实际工具名不带 `qcc-` 前缀，当前 Bridge 已兼容。
> 20 家公开企业的 400 次当前/历史工商调用已通过 `e2e:phase2` 严格验收。

> 2026-09-02 补充：复用同一隔离 Profile 的自然过期 grant，在端口 `43159` 启动 0.4.0 候选后，
> OAuth 插件自动刷新 access token，16+4 动态工具恢复；随后以 1 行批准夹具执行真实 enrich，
> 1/1 成功、0 失败、2 条安全审计。输入与报告均为 Git 忽略的 `0600` 文件，测试 Host 已停止，
> 生产端口 `43120` 未触碰。
>
> 401、429 与配额耗尽采用 Web→Bridge→Mock ToolRuntime 故障注入，避免伪造真实账号故障或重复付费批次。
> 三类错误均只派发一次失败调用；401/429 仅在显式 `/retry` 后重新派发，配额耗尽拒绝重试；
> 审计仅含工具名、callId、attempt、稳定错误码与耗时。

## 1. 被动 preflight

此步骤只读取 capabilities，不调用 OAuth 或计费 QCC 工具：

```bash
G5_E2E=1 \
G5_E2E_MODE=preflight \
G5_BASE_URL=http://127.0.0.1:43150 \
npm run e2e:g5
```

预期：生成临时脱敏报告；Host 未连接时显示 `not-connected-or-refreshing` 或 `oauth-plugin-missing`。

## 2. 准备本机夹具

把示例复制到仓库外或已忽略目录，再替换为经过批准的脱敏名单：

```bash
cp test/fixtures/g5-e2e.example.json /private/tmp/g5-e2e-input.json
chmod 600 /private/tmp/g5-e2e-input.json
```

夹具结构：

```json
{
  "headers": ["name"],
  "nameField": "name",
  "includeRisk": false,
  "concurrency": 1,
  "rows": [{ "name": "批准用于测试的企业" }],
  "selections": [
    {
      "companyName": "需要人工消歧的输入名",
      "selectedCreditNo": "人工确认的候选信用代码"
    }
  ],
  "retryCompanyNames": []
}
```

`selections` 只能填写 enrich 返回的候选；Host 会再次校验信用代码是否属于待复核列表。`retryCompanyNames` 只能填写错误队列中 `retryable:true` 的企业。

## 3. 真实 enrich Gate

先由用户在隔离 DSH Profile 内完成 QCC OAuth，再确认测试调用额度，最后运行：

```bash
G5_E2E=1 \
G5_E2E_MODE=enrich \
G5_E2E_CONFIRM_PAID_CALLS=YES \
G5_BASE_URL=http://127.0.0.1:43150 \
G5_FIXTURE_PATH=/private/tmp/g5-e2e-input.json \
G5_E2E_REPORT=/private/tmp/g5-e2e-report.json \
npm run e2e:g5
```

Runner 为 enrich、每次候选确认和人工重试生成稳定幂等键。同一 Host 内重复执行相同输入时应得到 `idempotencyReplayed:true`，不得再次调用计费工具。

## 4. 必验场景

1. 未授权：capabilities 非 ready，Runner 在 enrich 前关闭。
2. 首次授权：用户完成 OAuth 后，capabilities 变为 ready。
3. 唯一匹配：完成工商补全。
4. 多候选：初次只进入 `awaiting-review`；未确认前不调用工商详情。
5. 候选确认：只调用工商详情及可选风险，不重复实体检索。
6. 未匹配：保持 unresolved。
7. token 刷新：工具短暂消失后恢复；仅 `UNKNOWN_TOOL` 竞态允许一次内部安全重解析。✅ 自然到期刷新已验
8. 401、403、429、配额不足、超时和 5xx：映射为稳定错误码，且只能由用户显式重试。✅ 401/429/配额故障注入已验，其余有契约测试
9. 混合批次：单企业失败不影响其他企业。
10. 报告、日志和审计中无 Token、企业原名、信用代码、邮箱、手机号或原始工具响应。

## 5. 当前限制

- G5 run 与幂等记录只保存在 Host 内存，默认 TTL 30 分钟、最多 50 个 run；Host 重启或过期后必须新建 run。
- 当前不持久化原始/补全行，这是刻意的隐私边界；后续如需跨重启恢复，应先完成加密存储与保留期设计评审。
- Runner 不自动调用 `qcc_oauth_connect`，真实 OAuth 始终由用户在隔离环境显式完成。
