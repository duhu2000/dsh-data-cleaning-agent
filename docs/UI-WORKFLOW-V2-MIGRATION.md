# 数据清洗补全 v2 · 升级、迁移与回滚

> 适用对象：从已发布 `0.5.3` 升级到 `0.6.0` 五步工作流版本。
> 外部发布状态以 `docs/RELEASE-0.6.0.md` 和 npm/GitHub 为准。

## 1. 为什么建议使用 0.6.0

本次变更不是单纯视觉补丁：新增五步 taskId 工作流、Host 持久化元数据、耐久 CSV/XLSX 制品、
异常清单以及任务恢复 API。旧功能继续可用，但公开的同源 Host 能力和用户任务生命周期都有实质新增，
因此按语义化版本建议使用次版本 `0.6.0`，而不是 `0.5.4`。

## 2. 升级前检查

1. 记录当前 DSH Profile、插件版本和回滚目标；稳定基线使用 DSH `0.1.1-rc.2`。
2. 完成当前任务并下载需要保留的文件；`0.5.3` 的浏览器下载引用不能迁移成 Host 制品。
3. 确认工作区可写。v2 制品写入工作区 `.dsh-data-cleaning-artifacts/v1/`。
4. 备份 DSH Profile 和工作区；不要复制 OAuth token、Key 或 QCC 原始响应到源码仓库。
5. 在隔离 Profile 安装候选 tarball并运行验收，再更新日常使用的 Profile。

## 3. 数据迁移行为

| 数据 | 升级行为 | 回滚行为 |
| --- | --- | --- |
| `dc_tasks_v1` 旧异步任务 | 原样保留 | 原样可用 |
| `dc_workflows_v2` 任务元数据 | 新版本按 schema 2 增量创建 | 0.5.3 忽略，不删除 |
| `.dsh-data-cleaning-artifacts/v1` | 新版本创建并校验 SHA-256 | 0.5.3 忽略，文件保留 |
| 浏览器 runtime 原始行 | 不迁移、不写入 Host KV | 回滚后仍不可恢复 |
| QCC OAuth / Key | 不由本插件迁移或读取 | 由用户自己的 QCC MCP 连接管理 |

v2 没有破坏性数据库迁移，也没有自动删除步骤。升级后首次打开任务时按 taskId 读取元数据；如果任务尚未
生成 Host 制品，用户需要重新提供原始数据才能继续处理。已经生成的四类制品可跨 Host 重启下载。

## 4. 隔离安装与验收

以下命令中的 Profile 名称仅为示例，必须使用隔离 Profile，不得直接操作生产端口 `43120`：

```bash
npm pack --cache .npm-cache
dsh plugin --profile data-cleaning-v2-test add ./dsh-data-cleaning-agent-0.6.0.tgz
dsh web --profile data-cleaning-v2-test --port 43190
```

验收至少覆盖：创建任务、上传/映射、规则确认、匹配或本地清洗、生成四类制品、下载真实 XLSX、停止并
重启 Host 后按同一 taskId 恢复。QCC 路径只有在用户自己的连接已授权且明确确认使用其账号额度时测试。

## 5. 回滚

若候选版本出现阻断问题，停止隔离 Host，并把插件切回已发布的 `0.5.3`：

```bash
dsh plugin --profile data-cleaning-v2-test add dsh-data-cleaning-agent@0.5.3
```

回滚不会删除 `dc_workflows_v2` 或 `.dsh-data-cleaning-artifacts/v1`。不要手工清空工作区；修复后重新升级
即可继续读取同一批 v2 元数据和制品。0.5.3 无法显示 v2 五步任务属于预期降级，不是数据丢失。

## 6. 前滚与兼容原则

- schema 2 只做增量字段扩展；需要破坏性变化时必须新增 schema/domain 版本和显式迁移器。
- 制品路径版本固定为 `v1`；格式变化必须创建新目录版本，不能原地重写旧文件。
- `0.1.2-alpha.2` 只作兼容探针；发现差异时优先调整隔离 Bridge，不把实验 API变成稳定依赖。
- 发布前必须通过 `npm run check`、双基线跨重启、深浅色/窄屏回归和 npm tarball 白名单。
