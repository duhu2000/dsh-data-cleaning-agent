# dsh-data-cleaning-agent 0.8.0 发布记录

> 日期：2026-09-05
> 主题：图片企业名单粘贴、原生缩略图、Agent-owned OCR 与人工核对闭环

## 1. 产品结果

0.8.0 把早期“只把图片附加到对话”的兼容 Bridge 升级为完整可执行流程：

1. 用户在「数据清洗补全」会话原生 Composer 直接粘贴图片，或在提示词向导粘贴、拖入、选择图片。
2. DSH 原生 draft attachment 展示缩略图；向导另提供 64px 缩略图、移除和放大预览。
3. Host 临时保存原图并只向可编辑的对话说明回填随机 `dci-*` commandId；回填前释放 Composer 图片附件，使本轮成为文本模型也能接受的纯文本调用。
4. 用户发送说明后，Agent 只调用一次 `data_cleaning_extract_image_companies`。该高层工具以父执行 token/Session 调用已探测的图片文字 Provider。
5. Host 确定性抽取企业全称与 18 位统一社会信用代码，去重后回传向导。
6. 用户核对名单、选择匹配主键、清洗目标和补全字段，再进入原有 taskId 主体匹配与 QCC 补全闭环。

## 2. 已验证与建议的边界

### 已验证事实

- DSH `0.1.1-rc.2` 提供 `conversation.createDraftImages` / `releaseDraftImage(s)` 与 `conversation.input.shell(sessionId).addImages/removeImage`。
- 当前本机 DSH Profile 中 `@liustack/modlens@3.25.2` 注册 `modlens_read_image`，入参为本地 `path` 和可选 `prompt`，返回 OCR 文本/行。
- QCC `parse_document` 只接受公网 HTTP(S) 文档；当前未验证任何可安全上传本地图片的 QCC 工具，因此本版不硬编码 QCC 智能文档解析。

### 设计建议

- Modlens 作为可选 Provider，不是本 npm 包的直接依赖；运行时以 `ctx.tools.get('modlens_read_image')` 探测。
- 未来如 DSH 发布稳定的原生图片内容读取接口，可在 Provider 适配层新增实现，不改变 Web 指令和 taskId 契约。

## 3. 安全与费用

- 格式：PNG/JPEG/WebP；严格魔数验证；单张上限 8 MiB；单图最多输出 100 个主体标识。
- 临时目录 0700、文件 0600；识别成功、失败、用户移除或 15 分钟 TTL 到期后删除。
- 原图不进入 `storageDomain`、任务元数据或导出制品；对话中不显示 Host 文件路径。
- 图片识别不调用 QCC，所以不产生 QCC MCP 额度消耗。核对后的企业匹配/字段补全仍由当前用户使用自己连接的 QCC 账号。

## 4. 验收门

- `npm run check`：lint、中英文版本、市场素材、npm pack 白名单与全量自动化测试。
- 图片契约测试：魔数验证、OCR 两企业抽取/去重、Provider 输出兼容、Agent-owned nested execution、临时文件清理、Provider 缺失 fail closed。
- Web 契约测试：预检与暂存为零 QCC 调用，只有高层图片工具可调 Provider，状态轮询可取回两条名单。
- Client 契约测试：DSH 原生 attachment 增删、Composer 图片粘贴捕获、缩略图/放大、可读指令与四工具 toolview 注册。

## 5. 升级与回滚

```bash
dsh plugin --profile web add dsh-data-cleaning-agent@0.8.0
# 完全停止后重启
dsh web
```

回滚不需要迁移 Host 数据；0.8.0 未修改 `dc_workflows_v2` 或制品 schema：

```bash
dsh plugin --profile web add dsh-data-cleaning-agent@0.7.0
# 完全停止后重启
dsh web
```

回滚前若有尚未发送的图片识别指令，关闭/重启 Host 即可清理临时图片；已有的清洗补全任务和导出制品不受影响。
