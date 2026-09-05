# 数据清洗补全智能体 v2 · 工作流与 Host 契约

> 状态：T0～T9 已完成实现与隔离验收，归入 `0.6.0`。
> 开发基线：`main@0be4de3` / 已发布 `0.5.3`。
> 本文记录实现契约；外部发布状态以 `docs/RELEASE-0.6.0.md` 和 npm/GitHub 为准。

## 1. 产品主流程

业务主流程与企查查专业版“数据清洗补全”一致，固定为五步：

1. **上传数据**：文本、CSV、XLSX、JSON；图片入口需等待已验证的智能文档解析工具后接通。
2. **规则确认**：字段映射、清洗目标、匹配规则、补全字段选择。
3. **数据匹配**：以企业名称、统一社会信用代码或注册号作为主体锚点；精确、候选、已确认、未匹配、失败分流。
4. **清洗补全**：本地确定性清洗优先；需要 QCC 数据时，先估算调用，再由当前用户确认使用自己的 QCC 账号额度。
5. **下载数据**：生成 Host 制品引用，后续 UI 提供原始数据、清洗结果、补全结果与异常清单下载。

任务设置（提示词生成）、质量体检和任务历史是横向能力，不占用五步编号。

## 2. 当前范围

当前字段目录共 128 项，UI/Host/XLSX 按 8 个来源工具分组：

- 基础 30 项：`get_company_registration_info`（企业工商信息，27 项）和 `get_company_profile`（企业简介，3 项）。
- 第一批 40 项：`get_contact_info`（联系方式，6 项）、`get_listing_info`（上市信息，15 项）、`get_tax_invoice_info`（税务开票，8 项）、`get_import_export_credit`（进出口信用，11 项）。
- 第二批 58 项：`get_company_risk_scan`（企业自身风险扫描，38 项）和 `get_company_related_risk_scan`（企业关联风险扫描，20 项）。
- 基础工商：企业名称、统一社会信用代码、注册号、组织机构代码、纳税人识别号、登记状态、法定代表人、注册/实缴资本、成立日期、企业类型、核准日期、登记机关、纳税人资质、支付系统行号、进出口企业代码、企业简称、英文名。
- 地址与地区：注册地址、通信地址、所属地区原值。
- 经营信息：经营范围、国标行业、企查查行业、营业期限、人员规模、参保人数、分支机构参保人数、企业简介、产业链概览。
- 上传列“联系电话”仍可作为本地质量检查字段；QCC 联系方式另以“首选联系电话/邮箱/官网”等字段输出。电话、邮箱和网址全集不拼接进单元格。
- 风险字段只输出扫描工具已返回的聚合计数、命中摘要与重点维度命中关联方数；风险明细、关联方名单和下钻结果不进入一企一行主表。
- 一级行业、二级行业、省、市、区县、曾用名和知识产权摘要不在当前目录；不得推断、拼接或用其他字段冒充。

字段来源、185 工具审计及后续可适配字段详见 `docs/QCC-185-ONE-TO-ONE-FIELD-CATALOG.md`。

历史域、人员域、招投标域已明确延期，不进入当前实现或字段目录。

## 3. 工作流状态

正常路径：

```text
draft → uploaded → rules_confirmed → diagnosed(可选)
      → matching → review_required(可选) → matched
      → enriching → export_ready → completed
```

异常或暂停状态：`parse_failed`、`authorization_required`、`partial`、`failed`、`cancelled`。

每次写入增加 `revision`。Client 必须带上最后读取的 `expectedRevision`，过期写入返回
`409 DC_WORKFLOW_REVISION_CONFLICT`，防止两个会话互相覆盖。

## 4. 字段映射与匹配契约

- 至少映射一个主体锚点：`company_name`、`credit_no`、`reg_no`。
- 同一目标字段不能被多个输入列重复映射。
- 同一输入列不能重复映射到多个目标；未知目标字段按契约错误处理，不静默忽略。
- 企业名称可以结合输入中的地址、所属地区、电话辅助人工核验，但辅助字段不能取代主体锚点，也不因此成为 QCC 输出字段。
- 匹配结果只保存状态、数量汇总、运行引用和可审计依据；不得生成或展示无来源的置信度百分比。
- 多候选必须进入 `review_required`；人工确认完成后才能进入补全。
- `exact`、`candidate`、`confirmed`、`unresolved`、`failed` 是互斥数量，合计不得超过 `total`。

目录单一来源位于 `lib/qcc-field-catalog.js`，`lib/workflow-contract.js` 对外发布只读契约；Client 仅保留 Host 契约暂不可用时的同版本降级快照。

所选字段先按 `sourceTool` 去重，再执行 `主体查询 + 所选来源工具`。同一工具选择多个字段时每家企业只调用一次；Host 在任何 QCC 调用前以 `唯一企业数 × (1 + 来源工具数)` 校验 300 次调用上限。

## 5. Host 持久化与隐私边界

`lib/workflow.js` 使用 DSH `storageDomain`：

| 项 | 值 |
| --- | --- |
| domain | `dc_workflows_v2` |
| domain version | `1` |
| table | `tasks` |
| record schema | `2` |

允许持久化：任务标题、阶段/状态、输入文件元数据、表头、字段映射、选中字段、数字汇总、QCC run 引用、导出制品引用、时间和 revision。

禁止持久化：原始数据行、企业名称清单、匹配候选详情、QCC 原始响应、OAuth token、Key、真实付费调用证据。

原始数据行按 taskId 隔离在当前浏览器 runtime，Host KV 只保存来源元数据、映射、规则、质量/匹配/
补全摘要和制品引用。导出时，Client 把最终结果行一次性提交给同源 Host 制品端点；Host 通过 `ctx.fs`
写入工作区 `.dsh-data-cleaning-artifacts/v1/`。CSV 直接保存为 UTF-8，XLSX 保存为 Base64 文本并在下载
时恢复真实字节；读取时验证 SHA-256。原始行不会进入 `storageDomain`。

已完成任务可在浏览器 runtime 丢失原始行后，按 taskId 重新读取制品引用并跨 Host 重启下载；尚未生成
制品的中途任务仍需用户重新上传输入。制品只保存在用户当前工作区，不跨设备同步。

## 6. 同源 API

所有接口继续使用回环同源守卫；以下接口不会调用 QCC，不产生费用：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/data-cleaning/api/workflow/contract` | 获取五步、状态、字段目录和隐私契约 |
| GET | `/data-cleaning/api/workflow/tasks` | 任务列表 |
| POST | `/data-cleaning/api/workflow/tasks` | 新建草稿 |
| GET | `/data-cleaning/api/workflow/tasks/:id` | 按 taskId 恢复 |
| PATCH | `/data-cleaning/api/workflow/tasks/:id` | 更新未锁定草稿 |
| POST | `/data-cleaning/api/workflow/tasks/:id/actions/upload` | 记录上传元数据 |
| POST | `/data-cleaning/api/workflow/tasks/:id/actions/rules` | 确认规则 |
| POST | `/data-cleaning/api/workflow/tasks/:id/actions/quality` | 记录质量汇总 |
| POST | `/data-cleaning/api/workflow/tasks/:id/actions/match-start` | 进入匹配中 |
| POST | `/data-cleaning/api/workflow/tasks/:id/actions/match` | 记录匹配汇总 |
| POST | `/data-cleaning/api/workflow/tasks/:id/actions/enrich-start` | 进入补全中 |
| POST | `/data-cleaning/api/workflow/tasks/:id/actions/enrichment` | 记录补全汇总 |
| POST | `/data-cleaning/api/workflow/tasks/:id/actions/local-export-ready` | 本地确定性流程进入可导出状态 |
| GET | `/data-cleaning/api/workflow/tasks/:id/artifacts` | 列出已登记的 Host 耐久制品 |
| POST | `/data-cleaning/api/workflow/tasks/:id/artifacts` | 生成结果/异常清单的 CSV 与 XLSX，并完成任务 |
| GET | `/data-cleaning/api/workflow/tasks/:id/artifacts/:artifactId` | 校验 checksum 并下载制品 |
| POST | `/data-cleaning/api/workflow/tasks/:id/actions/export` | 兼容记录已有制品引用并完成 |
| POST | `/data-cleaning/api/workflow/tasks/:id/actions/parse-failed` | 记录解析失败（仅保存错误码） |
| POST | `/data-cleaning/api/workflow/tasks/:id/actions/authorization-required` | 暂停并提示连接 QCC |
| POST | `/data-cleaning/api/workflow/tasks/:id/actions/fail` | 记录失败（仅保存安全错误码） |
| POST | `/data-cleaning/api/workflow/tasks/:id/actions/cancel` | 取消任务 |

`/match` 与 `/enrichment` 记录的是已有执行结果摘要，不自行触发 QCC。后续编排器接入真实 QCC 时仍需沿用现有
`estimate → confirmPaidCalls:true → idempotencyKey → maxCalls` 安全门。

## 7. T0～T9 验收矩阵

| 门 | 验收项 | 结论 |
| --- | --- | --- |
| T0 | 0.5.3 `main` 基线干净，建立 `feat/ui-workflow-v2` | 通过 |
| T0 | 基线 `npm run check` | 138/138 通过 |
| T1 | 五步、字段目录、映射锚点、状态转换、无虚构置信度 | 自动化覆盖 |
| T2 | taskId 隔离、revision 并发保护、重启恢复 | 自动化覆盖 |
| T2 | 原始行/企业名/候选/QCC 响应不进入 KV | 自动化覆盖 |
| T2 | 同源守卫、无 storageDomain 降级、零 QCC 调用 | 自动化覆盖 |
| T2 | DSH `0.1.1-rc.2` 真实 Host 写入与跨重启恢复 | 43180 隔离 Profile 通过 |
| T3 | 上传/粘贴解析、数据预览、自动字段映射、任务目标、规则与字段选择全部绑定 taskId | 自动化 + rc.2 浏览器通过 |
| T3 | 规则确认后自动质量体检并推进 `diagnosed / match` | revision 5 与质量摘要实测通过 |
| T4 | 四步提示词向导：数据来源、匹配规则、清洗与补全、确认描述 | rc.2 浏览器通过 |
| T4 | 文本/文件数据经事件桥进入同一任务，生成描述回填原生 Composer；并发创建收敛为单 taskId | 自动化覆盖 |
| T5 | 中央七阶段业务首页、输入框下五能力入口、右侧五步工作台与最近任务恢复 | rc.2 浏览器通过 |
| T5 | 当前基础企业 G5 匹配/补全、零调用估算、BYO-QCC 确认 | 自动化覆盖；未执行真实 QCC |
| T6 | Host 四类耐久制品、真实 XLSX、异常清单、checksum 与安全路径 | 自动化 + 双基线通过 |
| T6 | rc.2 / alpha.2 隔离安装、Host 重启恢复及真实 XLSX 反向解析 | 43190 / 43191 通过 |
| T6 | rc.2 深色、浅色、820×900 窄屏无横向溢出 | 真实浏览器通过 |
| T7 | 多候选人工核验、`partial` 显式重试、补全后回到 `export_ready` | 自动化覆盖 |
| T8 | 最近任务携带原 taskId 恢复、无原始 runtime 行时下载四类 Host 制品 | 自动化 + rc.2 浏览器通过 |
| T9 | 迁移/回滚、兼容矩阵、发布检查和版本决策 | 文档完成；0.6.0 已发布并完成公共安装核验 |

### 真实 Host 证据（2026-09-03）

- 将当前 41 文件 tarball 临时装入仓库内隔离 Profile，启动 DSH `0.1.1-rc.2` 于 `127.0.0.1:43180`。
- `GET /workflow/contract` 返回 schema 2 和完整五步，明确 `executesTools:false`、`paidCalls:false`。
- 新建测试任务后依次记录上传与规则确认，状态为 `rules_confirmed`、阶段为 `match`、revision 为 3。
- 停止并重启 Host 后，使用同一 taskId 读回上述状态、映射和 revision，确认 `storageDomain` 跨进程恢复有效。
- 测试 Host 已停止；隔离 Profile 的原插件目录已恢复。未触碰生产端口 `43120`，未安装/调用 QCC。

### T3～T5 真实 UI 证据（2026-09-03）

- 将最新本地 tarball 安装到隔离 DSH `0.1.1-rc.2` Profile，并启动于 `127.0.0.1:43182`。
- 中央首页显示七阶段流程，五能力按钮位于原生 Composer 下方；右侧工作台显示 Host taskId 和五步状态。
- 粘贴 2 行 CSV 后自动映射“企业名称”和“统一社会信用代码”，确认规则后自动生成质量报告。
- Host 读回任务 `state=diagnosed`、`stage=match`、`revision=5`，`qualitySummary` 与页面统计一致。
- 四步提示词向导在真实页面完整渲染；同一会话并发事件创建经 coalescing/队列保护后只生成一个任务。
- 实测过程中未检测或调用 QCC，未使用真实企业数据；43182 隔离 Host 已停止。

### T6～T9 真实 Host / UI 证据（2026-09-04）

- 将最新本地 tarball 分别安装到隔离 DSH `0.1.1-rc.2`（43190）和
  `0.1.2-alpha.2`（43191）Profile。
- 两条基线均创建同一结构的完成任务和四类制品；XLSX 文件头为 `PK`，反向解析工作表为
  “清洗补全结果”。停止并重启后按原 taskId 和 artifactId 下载仍通过。
- rc.2 真实页面完成浅色、深色与 820×900 窄屏回归；窄屏 `scrollWidth` 与视口宽度相同。
- 最近任务恢复实测显示原完成 taskId、输入行数和四个下载按钮，没有创建新草稿。
- 全程使用合成数据，未触碰生产端口 43120，未连接或调用 QCC。

## 8. 当前实现与发布顺序

1. T3（完成）：上传解析、字段映射、任务设置和规则确认接入 v2 taskId API。
2. T4（完成）：提示词生成器四步向导接入 taskId 工作流，支持文本/本地文件/图片 Bridge。
3. T5（完成）：中央业务首页、五能力入口、右侧工作台、基础企业匹配/补全和任务历史统一到 taskId。
4. T6（完成）：Host 耐久下载制品、XLSX 与异常清单、双基线、视觉回归、迁移与回滚。
5. T7（完成）：候选人工核验、部分失败重试、匹配与补全状态闭环。
6. T8（完成）：四类制品导出、最近任务恢复及跨 Host 重启下载。
7. T9（完成）：`0.6.0` 已完成代码审查、合并、Tag、npm OIDC 发布、GitHub Release 与公共安装核验。

详细验收见 `docs/UI-WORKFLOW-V2-ACCEPTANCE.md`，升级/回滚见
`docs/UI-WORKFLOW-V2-MIGRATION.md`。
