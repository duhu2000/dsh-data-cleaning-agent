# 0.4.0 工商全景验收手册

## 1. 目的与边界

`scripts/phase2-acceptance.mjs` 是 0.4.0 源码仓库的本地验收 Runner（不进 npm 运行时包）。
它只读取从真实 DSH/QCC
工具轨迹整理出的 JSON 证据，不主动联网、不发起付费调用、不读取 OAuth token。

Runner 验证：

- 不少于 20 条企业记录；
- 每条的主体消歧已完成，不允许多候选或未解析；
- `resolveEntity` 和 `registration` 必须是含非空原值对照的 `resolved`，不能以 `no_data` 充数；
- 每条不少于 15 个当前工商维度已交付；
- 维度使用的 `sourceTool` 必须与 `lib/qcc-phase2.js` 中的已验证契约一致；
- `resolved` 字段的 `value` 与 `sourceValue` 必须深度全等，防止金额、比例、计数或股权链被二次计算；
- 启用历史域门时，必须标记企业认证账号，且每条 4 个历史工商维度都已交付。

Runner 是「证据结构和结果契约」的自动检查，不是 QCC 调用器。真实性还需与同次
DSH session/tool transcript 的时间和调用记录对应；Mock 或人工编造的数据不能作为发布证据。

`sourceTool` 同时接受规范名 `mcp__qcc-company__*` / `mcp__qcc-history__*` 与
`qcc-dsh-mcp-oauth@0.1.7` 实测 legacy 名 `mcp__company__*` / `mcp__history__*`；
除此之外的别名仍会以 `SOURCE_TOOL_MISMATCH` 拒绝。

### 1.1 真实调用前的只读预检

在隔离 DSH Host 完成 OAuth 后，先请求：

```bash
curl -fsS -H 'sec-fetch-site: same-origin' \
  http://127.0.0.1:<隔离端口>/data-cleaning/api/phase2/capabilities
```

该端点只读取 ToolRuntime 注册表，不调用 QCC，返回 `paidCalls:false` 和
`executesTools:false`。进入当前工商 E2E 前应有 `companyRegistered:16` / `companyReady:true`；
历史域应有 `historyRegistered:4` / `historyToolsReady:true`。

`historyAuthorizationVerified:false` 在预检中始终为 false：工具已注册不等于企业认证账号已获权，
账号权限只能在用户明确同意后通过真实历史工具调用验证。

## 2. 证据文件契约

真实证据不进 Git，建议放在已忽略的 `.phase2-e2e/`。企业名及信用代码不写入
`reference`，只使用 `row-001` 这类不透明行号。

```json
{
  "schemaVersion": 1,
  "evidenceKind": "qcc-phase2-real-tool-transcript",
  "synthetic": false,
  "historyAccess": "enterprise-certified",
  "records": [
    {
      "reference": "row-001",
      "entityStatus": "resolved",
      "dimensions": [
        {
          "domain": "company",
          "id": "registration",
          "status": "resolved",
          "sourceTool": "mcp__qcc-company__get_company_registration_info",
          "fields": [
            {
              "key": "reg_capital",
              "value": "<实际输出值>",
              "sourceValue": "<同次工具返回原值>"
            }
          ]
        },
        {
          "domain": "company",
          "id": "listing",
          "status": "no_data",
          "sourceTool": "mcp__qcc-company__get_listing_info",
          "fields": []
        }
      ]
    }
  ]
}
```

维度状态：

- `resolved`：工具成功返回数据；必须至少有一个非空 `fields` 条目，且输出值与源值完全一致。
- `no_data`：工具调用成功但该主体无此数据；`fields` 必须为空。该维度计入覆盖。
- `permission_required` / `not_available` / `error`：显式降级，不计入覆盖数。

公司域 `id` 和历史域 `id` 必须使用 [qcc-phase2.js](../lib/qcc-phase2.js) 的对象键。

## 3. 执行命令

只验收当前工商全景：

```bash
QCC_PHASE2_ACCEPTANCE=1 \
QCC_PHASE2_EVIDENCE="$PWD/.phase2-e2e/evidence.json" \
QCC_PHASE2_REPORT="$PWD/.phase2-e2e/report.json" \
npm run e2e:phase2
```

同时强制验收企业认证历史域：

```bash
QCC_PHASE2_ACCEPTANCE=1 \
QCC_PHASE2_REQUIRE_HISTORY=YES \
QCC_PHASE2_EVIDENCE="$PWD/.phase2-e2e/evidence.json" \
QCC_PHASE2_REPORT="$PWD/.phase2-e2e/report-history.json" \
npm run e2e:phase2
```

退出码：

- `0`：全部验收门通过；
- `1`：证据可读，但记录数、维度、消歧、来源或原值一致性未达标；
- `2`：Runner 未显式启用、文件缺失或 JSON 无法读取。

## 4. 安全要求

- 报告文件以 `0600` 权限写入，只包含计数、失败代码和 `row-xxx` 引用。
- 不将 evidence、session transcript、OAuth 参数、token、企业名单或信用代码提交到 Git。
- `synthetic:true` 的证据会被 Runner 显式拒绝，不能用单元测试夹具代替真实 E2E。
- 若需付费调用，必须先在隔离 DSH Profile 内由用户明确确认额度和企业名单。

## 5. 2026-09-01 真实验收记录

- 环境：隔离 DSH `0.1.1-rc.2`，未触碰生产 `43120`。
- 授权：OAuth PKCE 成功，6 个 Server 挂载，授权跨多次 Host 重启恢复成功。
- 样本：20 家公开知名企业；顺序执行 400 次工具调用。
- 结果：20/20 主体解析；每企业当前工商最低 15 维、历史工商 4 维；严格历史门通过。
- `verifyIdentity` 因输入只含企业名而统一不交付，符合 Skill 的按需调用规则，15 维门不受影响。
- 原始证据与报告位于 Git 忽略的 `.phase2-e2e/` 且为 `0600`；不进入 npm 包、Git、Issue 或日志。
