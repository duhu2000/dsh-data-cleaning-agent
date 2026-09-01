# Spike #3 — 文件边界（File Boundary）验证报告

- 状态：**PASS（双基线同构）**
- 日期：2026-08-31
- 探针：`spike3/plugin/`（`@qcc/dsh-data-cleaning-agent@0.0.3-spike3`）
- 基线：`0.1.1-rc.2`（全局 `dsh`）与 `0.1.2-alpha.2`（`spike1/cli-alpha2/.../lib/bin.js`）
- 隔离 home：`spike3/home-rc2`、`spike3/home-alpha2`；端口 43124 / 43125（已停服，未触碰线上 `~/.dsh/profiles/web`）

## 目标

验证"专用 CSV/XLSX 上传 → 结构化解析 → 模型只收摘要"这条链路上的**文件边界 seam**，即：
1. 插件能否拿到 `ctx.fs`（存储原语）与 `ctx.storageDomain`（持久元数据）；
2. `ctx.fs` 的沙箱边界是否真在强制（`workspace-write` 下越界写被拒、`readBytes` 上限被拒、平台临时区放行）；
3. 上传文件能否经 `ctx.fs` 落盘、有界读回、解析后**只回摘要不回原文**。

## 结论摘要

| 验收项 | rc.2 | alpha.2 |
|---|---|---|
| `plugin add` 进 web profile | ✅ | ✅ |
| `ctx.fs` / `ctx.storage` / `ctx.storageDomain` / `ctx.tools` 四 seam present | ✅ | ✅ |
| `fs.sandboxMode` | `workspace-write` | `workspace-write` |
| 上传路由（POST `/data-cleaning/api/upload`）落盘→读回→解析→**仅摘要** | ✅ | ✅ |
| `readBytes` maxBytes 上限强制 | ✅ `FS_TOO_LARGE` | ✅ `FS_TOO_LARGE` |
| 越界写（cwd 外） | ✅ `FS_SANDBOX_DENIED` | ✅ `FS_SANDBOX_DENIED` |
| 平台临时区（`/tmp`）写 | ✅ 放行 | ✅ 放行 |

**双基线结果逐字节一致**（除落盘时间戳/version 外），文件边界 seam 无版本分歧。

## 关键实测证据

### 1. seam 报告（`GET /data-cleaning/api/seam`）

```json
{
  "ok": true,
  "marker": "spike3-seam",
  "report": { "fs": "present", "storage": "present", "storageDomain": "present", "tools": "present" },
  "fsSandboxMode": "workspace-write"
}
```

说明：web profile（base + web-app 两 bundle）已默认提供 `ctx.fs`（`@deepseek-ai/dsh-fs-sandbox` 提供，`dsh-tool-fs` 同一 `fs` 服务）与 `ctx.storage`/`ctx.storageDomain`，插件**无需自备后端**即可注入。注：本次只验"可注入 present"，`storageDomain` 的 schema 校验写/读路径留给 Spike #4（Job/Storage）。

### 2. 上传 → 有界读回 → 仅摘要（`POST /data-cleaning/api/upload`）

输入 CSV `name,age,city\nAlice,30,Beijing\nBob,25,Shanghai\nCarol,35,Guangzhou`，响应：

```json
{
  "ok": true,
  "marker": "spike3-upload-summary",
  "fileId": "f-1a1f025c36d25524",
  "path": "<workspace>/spike3/.spike3-uploads/f-1a1f025c36d25524.csv",
  "bytes": 66, "size": 66,
  "writeVersion": "16777232:178547290:66:...",
  "summary": {
    "headers": ["name","age","city"],
    "rowCount": 3, "columnCount": 3,
    "sampleRows": [["Alice","30","Beijing"],["Bob","25","Shanghai"],["Carol","35","Guangzhou"]]
  }
}
```

链路：`fs.resolve(relPath)` → `fs.writeText(target, text)`（原子写，返回 version）→ `fs.stat` → `fs.readBytes(target, signal, 4MiB)` → 自写 CSV 解析器 → **只回 `summary`（表头/行列数/≤3 行样例），原文不进入响应**。"模型只收摘要"在边界上成立：原文件只存于 cwd 沙箱目录，路由回包仅含摘要。

### 3. 边界负例（`GET /data-cleaning/api/probe-fs`）

```json
{
  "checks": {
    "readCap": { "enforced": true, "code": "FS_TOO_LARGE",
      "message": "cannot read \"...\": 64 bytes exceeds the 8-byte limit" },
    "outsideCwdWrite": { "denied": true, "code": "FS_SANDBOX_DENIED",
      "message": "cannot write \".../spike3-outside-root.txt\": file access denied under workspace-write mode" },
    "tmpWrite": "allowed"
  }
}
```

要点：
- `fs.readBytes` 的 `maxBytes` 是**硬上限**（读 64B 却报 8B 上限，`FS_TOO_LARGE`），符合"有界读取"的安全预期。
- `fs.writeText` 在 `workspace-write` 下按 `sandbox-policy` 的可写根收口：**cwd 之外（`../`）拒绝**，报 `FS_SANDBOX_DENIED`；`/tmp` 作为平台临时区**放行**。与本环境"workspace-write：仅工作区可写 + 部分平台临时区可写"完全一致。

## 对设计的落地结论

1. **无需自备文件存储后端**：`ctx.fs`（`fs-sandbox`，默认 `workspace-write`、`workspaceRoot=process.cwd()`）即插件可用的存储 seam；原文件落 cwd 沙箱目录，不进模型上下文。
2. **上传走插件专用受保护路由**（本次用 `webServer.register` + `sec-fetch-site !== 'cross-site'` 信任围栏，与 Spike #2 一致）；DSH 未提供通用上传 seam，与规划"专用受保护上传面"的决策一致。
3. **有界读取由 `ctx.fs.readBytes(maxBytes)` 保证**，上限强制，插件侧无需自建流式截断。
4. **`ctx.storageDomain` 存在但未验写路径**——schema 校验、跨重启持久、未来 schema 拒绝/迁移的实测留给 Spike #4（Job/Storage）。
5. **XLSX 解析不在本次范围**：探针只验证了 CSV 文本路径（XLSX 需引入 `exceljs`/`xlsx` 依赖，属实现细节而非 DSH seam 分歧，不阻塞基线决策）。文件边界 seam 对二进制文件同样适用（`readBytes` 返回原始字节）。

## 产物与清理

- 探针：`spike3/plugin/`（`package.json`、`cordis.patch.yml`、`lib/index.js`、`lib/web.js`）
- tarball：`spike3/qcc-dsh-data-cleaning-agent-0.0.3-spike3.tgz`
- 启动日志：`spike3/rc2-web-boot.log`、`spike3/alpha2-web-boot.log`
- 已验证无版本分歧 → ADR-0001 维持"暂保留 rc.2 最小兼容"，新增 5d（文件边界）。
