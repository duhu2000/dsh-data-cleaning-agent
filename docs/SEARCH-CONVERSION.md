# 搜索发现与安装验收

拟议市场中文描述：数据清洗补全智能体：面向 Excel/CSV/JSON 企业名单，提供数据清洗、表格清洗、清洗补全、去重、企业数据补全与字段补全，支持企查查 MCP 和结果导出。

拟议英文描述：Data cleaning and data enrichment for CSV/XLSX/JSON enterprise lists in DeepSeek Harness, including spreadsheet cleaning, deduplication, profiling, optional Qichacha MCP and exports.

npm keywords 已在包清单内更新。GitHub description 建议使用上述英文描述；topics 在保留现有项的基础上加入：dsh-plugin, data-cleaning, data-enrichment, spreadsheet-cleaning, enterprise-data。

市场只检索登记字段，不读取 npm keywords、README 或 GitHub topics。默认下载排序保持原规则；不承诺文案直接提升默认排名。

固定查询：数据清洗补全 / 数据清洗 / 清洗补全 / 表格清洗 / 企业数据补全 / 字段补全 / data cleaning / data enrichment / spreadsheet cleaning / 数据 清洗 补全 / 数据清洗、补全 / 企查查MCP / 企查查 MCP。

验收：使用实时完整目录和原版搜索函数对比登记描述更新前后；记录语言、命中位置、结果数与版本。独立目录缺失条目必须标为未上线，不能把模拟添加的结果当作上线结果。

发布清单：完成仓库 check；审核 README 与包清单差异；如需让 npm 展示更新内容，另行授权一个新的补丁版本并按项目发布流程执行。当前改动未更改版本，不得覆盖已发布版本或移动 tag。仅登记 YAML 更新无需发布 npm。

## 安装与三分钟上手

数据清洗补全智能体：面向 Excel/CSV/JSON 企业名单，提供数据清洗、表格清洗、清洗补全、去重、企业数据补全与字段补全，支持企查查 MCP 和结果导出。

```sh
dsh plugin --profile web add dsh-data-cleaning-agent@0.8.14
```

请先满足下文的 DSH、连接器及侧边栏依赖要求；安装后完整停止并重启对应 Profile。

上传一份合成 CSV（如表头“姓名,手机号,金额”，两行重复的“演示用户,13800000000,100”），选择去重并检查结果，再导出新文件。企业字段补全另需已授权的企查查 MCP；先用本地清洗体验流程。

**流程样例（示意，非真实调用结果）：** 输入两条相同合成记录 → 选择去重规则 → 预览一条保留记录 → 导出结果。

**能力边界：** 本地清洗与企业数据补全是不同步骤；外部事实来自用户授权的数据源，无法确定的主体或字段交给人工复核，不编造企业事实。

**升级与回滚：** 升级前停止 Profile 并备份任务目录，记录当前精确版本；使用上面的固定版本命令升级，再完整重启。回滚时将版本号替换为升级前记录的版本，并使用升级前任务目录副本；不以旧版直接读取已迁移任务目录。

相关智能体：[数据清洗补全](https://github.com/duhu2000/dsh-data-cleaning-agent) · [AI填表](https://github.com/duhu2000/dsh-form-fill-agent) · [访前尽调](https://github.com/duhu2000/dsh-pre-duediligence) · [招投标](https://github.com/duhu2000/dsh-tender-workbench)
