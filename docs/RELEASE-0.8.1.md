# dsh-data-cleaning-agent 0.8.1 发布记录

> 日期：2026-09-05  
> 主题：企查查智能文档解析图片名单与单次完整任务说明

## 1. 产品结果

0.8.1 修正图片名单入口的执行路径：

1. 用户在提示词向导粘贴、拖入或选择 PNG/JPEG/WebP 图片，继续选择匹配规则、清洗动作与补全字段。
2. 向导一次生成完整、可读、可编辑的中文任务说明，不再要求先发送 OCR 专用指令、识别后再发送第二轮任务。
3. 回填前 Client 释放 Composer 原生图片附件；DeepSeek 等不支持图片的文本模型只接收纯文本任务说明。
4. Agent 只调用一次 `data_cleaning_extract_image_companies` 高层工具；Host 以父执行上下文调用用户连接的企查查智能文档解析。
5. Host 通过本地 `qcc-document-mcp` 准确提交一次 `parse_document(file_path)`，仅在任务仍处理中时使用同一 `task_id` 查询 `get_parse_result`。
6. 识别出的企业名称和统一社会信用代码进入同一 taskId 工作台人工核对，再继续主体匹配、字段补全和 CSV/XLSX 导出。

## 2. 连接要求

本地图片必须使用官方 `qcc-document-mcp` stdio 服务：

```json
{
  "mcpServers": {
    "qcc-document-mcp": {
      "command": "npx",
      "args": ["-y", "qcc-document-mcp"],
      "env": {
        "QCC_DOCUMENT_AUTHORIZATION": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

- Key 由用户配置在自己的 DSH/MCP 环境中，不进入插件代码、日志或发布包。
- `qcc-document-mcp` 会读取本地文件并上传到企查查文档解析网关；用户只应提交有权处理且允许上传的数据。
- 远端市场连接 `qcc-document` 的 `parse_document` 只接受公网 `file_url`，不能读取 Host 本机路径。
- 只连接远端服务时，本插件返回 `DC_IMAGE_LOCAL_DOCUMENT_PROVIDER_REQUIRED`，不会自动上传图片、暴露本地路径或回退到聊天模型视觉能力。
- 文档解析额度或费用由当前用户自己的企查查账号承担；后续企业补全继续遵守现有 BYO QCC 确认门。

## 3. 安全边界

- 图片限制为 PNG/JPEG/WebP、8 MiB，使用魔数而非文件扩展名校验。
- Host 临时目录权限 0700、文件权限 0600；成功、失败、移除或 15 分钟 TTL 到期后删除。
- 原图不写入 `storageDomain`、工作流任务元数据、模型上下文或导出制品。
- Agent 只能取得随机 `dci-*` commandId，看不到 Host 文件路径；Web handler 不直接派发动态 MCP 工具。
- 文档解析失败、认证失效、协议异常与超时均安全收敛，不重试提交或扩大调用范围。

## 4. 验收范围

- `npm run check`：语法、版本一致性、市场素材、发布白名单与全量自动化测试。
- 图片契约：QCC Markdown 结果提取、一次提交、处理中轮询、两企业抽取、临时文件清理、认证/协议/超时错误。
- Provider 门：本地服务未配置和仅有远端 `qcc-document` 时分别 fail closed，并返回可操作说明。
- Client 契约：原生缩略图、一次完整任务说明、发送前释放附件、识别结果进入同一 taskId 工作台。
- Web 契约：能力预检报告当前用户 QCC 文档连接计费边界，高层工具保持 Agent-owned nested execution。

真实图片 QCC E2E 需要维护者在隔离 DSH Profile 中配置自己的 `qcc-document-mcp` Key；发布包不包含测试凭据或真实解析响应。

## 5. 升级与回滚

```bash
dsh plugin --profile web add dsh-data-cleaning-agent@0.8.1
# 完全停止后重启
dsh web
```

0.8.1 未修改 `dc_workflows_v2`、制品 schema 或已完成任务，可直接回滚：

```bash
dsh plugin --profile web add dsh-data-cleaning-agent@0.8.0
# 完全停止后重启
dsh web
```

回滚会恢复 0.8.0 的 Modlens 两轮图片流程；文本、Excel、主体匹配、字段补全和历史制品不受影响。
