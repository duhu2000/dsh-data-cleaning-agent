# 使用指南 / User Guide

## 1. 安装

```bash
dsh plugin --profile web add dsh-data-cleaning-agent
```

没有 `dsh` CLI 时：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/duhu2000/dsh-data-cleaning-agent/main/install.sh)
```

安装后**完全重启** DeepSeek Harness。

## 2. 使用方式

### 2.1 对话式（推荐）

在对话中说：

> 帮我清洗这批企业名单数据，先做画像，再清洗，缺失的金额补 0。

插件会加载内嵌 Skill `data-cleaning`，自动按 `data_profile → data_clean_rows → data_complete_rows` 工作流调度。

### 2.2 web 界面

打开 DeepSeek Harness 后访问插件的同源界面（`/data-cleaning/`），可上传 CSV/XLSX/JSON，
执行解析、清洗、补全、导出 CSV。web 界面的后端路由前缀为 `/data-cleaning/api/mvp/*`。

## 3. 能力说明

| 工具 | 作用 |
| --- | --- |
| `data_profile` | 输出列概览与金额分布（min/max/sum/count） |
| `data_clean_rows` | trim、手机号规范化、剔除缺失必填/负金额/重复行 |
| `data_complete_rows` | 空金额填 0、空姓名填占位、报告不可确定性补全的项 |

## 4. 数据边界

- 模型只收到统计摘要（total / kept / dropped / incomplete），**从不读取原始明细行**。
- 明细数据只经同源 web 端点（`127.0.0.1` / `localhost`）交付；非可信跨源请求被拒绝。
- 不要上传含真实敏感业务数据的文件到公开环境做演示；开发测试请用脱敏夹具。

## 5. 支持的数据格式

- CSV：RFC4180 子集（引号字段、转义引号、字段内换行、BOM、CRLF）。
- XLSX / XLS：懒加载 `xlsx` 依赖；headless 组合无 `xlsx` 时返回 `XLSX_UNAVAILABLE`。
- JSON：对象数组，每项一行。

## 6. 常见问题

- **Q：安装后工具不出现？** A：确认已完全重启 DSH；确认 `dsh plugin list`（或 profile 的
  `package.json` → `dsh.profile.bundles`）含 `dsh-data-cleaning-agent`。
- **Q：XLSX 解析报 `XLSX_UNAVAILABLE`？** A：当前 DSH 组合未安装 `xlsx`；web 组合默认可用。
- **Q：能接企查查补全企业信息吗？** A：路线图见 [PLAN-OSS.md](PLAN-OSS.md)（方案 A 模型中介，后续版本）。
