# Spike #6 证词：端到端接真实模型

- 日期：2026-08-31
- 基线：`0.1.1-rc.2`（本机 `/opt/homebrew/bin/dsh`）与 `0.1.2-alpha.2`（`spike1/cli-alpha2` 树）
- 结论：**PASS（双基线同构）** —— 真实模型在 headless 一次性任务里，先加载内嵌 Skill、再按 Skill 正文调度自定义工具 `data_clean_rows`，工具真实执行、返回摘要、模型只回摘要不回原文。Spike #1–#5 证明的"注册/挂载/调度 seam"，在本 spike 中首次被一条活的 LLM 回合端到端串联起来。

## 目的

前五个 spike 全部用 **无模型** 的方式验证 seam：

| Spike | 验证了什么 | 是否经过真实模型 |
|---|---|---|
| #1 | Bundle 安装 → `--dump-config` 可见 | 否 |
| #2 | Host/Client 双向桥 | 否 |
| #3 | `fs` 文件边界 | 否 |
| #4 | Job / Storage | 否 |
| #5 | `tools.register` / `skills.register` / `tools.execute` 三步闭环 | 否（`tools.execute` 是宿主手动调度，不是模型自己调） |

Spike #6 补上最后一块：**让真实 LLM 通过 agent 回路，自主走到"加载 Skill → 调用工具 → 消费工具结果 → 产出终答"**。这是 `dsh-tool-skill` 与 agent 组合在双基线上的首次活体验证。

## 方法

### 1. 插件变体（headless-safe）

`spike6/plugin` 由 `spike5/plugin` 复制而来，仅两处差异：

1. 版本升为 `0.0.6-spike6`。
2. web 半区挂载改为**存在性守卫**：

```js
if (ctx.get('webServer') !== undefined && ctx.get('webRuntime') !== undefined) {
  // 挂 /data-cleaning/api/* 探测路由
} else {
  console.log('[spike6] headless composition detected: web routes skipped');
}
```

原因：headless 一次性任务合成树里没有 `webServer`/`webRuntime`，若沿用 spike5 的 `ctx.inject(['webServer', ...])`，缺依赖会以**异步 fiber 失败**的形式炸掉（与 Spike #5 踩过的 `required:true` 同类：同步 try/catch 接不住）。`ctx.get(name)` 对缺失服务返回 `undefined`（不抛），是干净的存在性守卫。

3. 工具 `execute` 内加一行**落地证据日志**：`[spike6] data_clean_rows executed: total=… kept=… dropped=… badMissing=… badAmount=…`，证明执行发生在活的 agent 回合内，而非宿主探测路由。

### 2. 隔离 headless profile

两个隔离 home（绝不触碰 `~/.dsh/profiles/web` 正在运行的 GUI）：

```
spike6/home-rc2/profiles/headless/{package.json,cordis.yml,cordis.patch.yml,pnpm-workspace.yaml}
spike6/home-alpha2/profiles/headless/{同上}
```

- `dsh.profile.bundles`：`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless` + `@qcc/dsh-data-cleaning-agent`。
- `dependencies`：`@qcc/dsh-data-cleaning-agent: file:<绝对路径 tarball>`。
- `settings.yaml`（隔离 home 根，**不含机密**）：

```yaml
agent-default-model:
  provider: deepseek-v4-pro
  model: deepseek-v4-pro
llm-pi-ai:
  providers:
    deepseek-v4-pro:
      displayName: deepseek-v4-pro
      apiKeyEnv: DEEPSEEK_V4_PRO_API_KEY
      api: openai-completions
      baseURL: https://ai-gateway.greatld.com/duhu/v1/all/v1
      models:
        - id: deepseek-v4-pro
```

### 3. 密钥注入（env-only，不落盘）

`apiKeyEnv: DEEPSEEK_V4_PRO_API_KEY` 是 credential-ref 名；`dsh-credentials-local` 的解析顺序是**进程环境变量 → `$DSH_HOME/.credentials.yaml` refs → dotenv 兜底**。故运行时从 live `~/.dsh/.credentials.yaml`（只读）读出该 ref 的真实值，**仅注入子进程 env**，不写进 workspace、不回显（`key_len=36`，内容全程不打印）。

### 4. 任务设计（不短路）

任务文本给 5 行脏数据（1 行缺 name、1 行负金额、1 行非数字金额、2 行干净），只说"用 data-cleaning 技能清洗、只报告汇总、不要回显原始行"。**不**在 prompt 里点名 `data_clean_rows` 工具名，把"走哪个工具"交给 Skill 正文去引导。

## 结果

### `--dump-config` 合成校验（双基线一致）

| 条目 | rc.2 | alpha.2 |
|---|---|---|
| `agent-default-model`（`@deepseek-ai/dsh-agent-default-model`） | ✅ | ✅ |
| `llm-pi-ai`（`@deepseek-ai/dsh-llm-pi-ai`） | ✅ | ✅ |
| `headless-runner`（`@deepseek-ai/dsh-headless`，`task: !!js ctx.headlessStartup.task`） | ✅ | ✅ |
| `code-runtime`（`dsh-code-runtime-worker-thread`） | ✅ | ✅ |
| `data-cleaning-tool-skill`（`@qcc/dsh-data-cleaning-agent`） | ✅ | ✅ |
| `web-app` / `webServer` 行 | 无（headless） | 无（headless） |

### 真实模型一次性任务

**rc.2**（`/opt/homebrew/bin/dsh --profile headless "<task>"`）：

```
[spike6] headless composition detected: web routes skipped
[spike6] host apply() ran
[spike6] data_clean_rows executed: total=5 kept=2 dropped=3 badMissing=1 badAmount=2
清洗完成：共 5 行，保留 2 行，丢弃 3 行（缺失 1 行，金额异常 2 行）。
exit=0
```

**alpha.2**（`node spike1/cli-alpha2/.../dsh/lib/bin.js --profile headless "<task>"`）：

```
[spike6] headless composition detected: web routes skipped
[spike6] host apply() ran
[spike6] data_clean_rows executed: total=5 kept=2 dropped=3 badMissing=1 badAmount=2
清洗完成：共 5 行，保留 2 行，丢弃 3 行（缺少必填字段 1 行、金额无效 2 行）。
exit=0
```

alpha.2 stderr 的 `reasoning:` 轨迹进一步坐实了自主决策链：

```
reasoning: The user wants me to use the data-cleaning skill. I should load it first.
reasoning: We need to clean 5 rows via data_clean_rows tool. The skill says send every raw row in a single call, report only summary.
reasoning: We need to report only the summary, not echo raw rows.
```

### session JSONL 证据（`DSH_HOME/sessions/**/session.jsonl.zstd`）

两个 home 各 1 个 session。解压后 `tool/call` 事件序列**完全一致**：

| 序号 | 事件 | 内容 |
|---|---|---|
| 1 | `tool/call` | `skill`，`{"name":"data-cleaning"}` |
| 2 | `tool/result` | `<skill_content name="data-cleaning">…`（正文成功加载） |
| 3 | `tool/call` | `data_clean_rows`，`{"rows":[{"name":"张三",…}, {"name":"李四",…"-20"}, {"name":"",…}, {"name":"王五",…"abc"}, {"name":"赵六",…}]}` |
| 4 | `tool/result` | `cleaned 5 rows: kept 2, dropped 3 (missing 1, bad-amount 2)` |

事件类型分布（rc.2 65 行 / alpha.2 66 行）均含 `tool/call ×2`、`tool/result ×2`、`step/start ×3`、`turn/start`、`turn/end`——标准的"加载 Skill（step 1）→ 调工具（step 2）→ 终答（step 3）"三步回合。

## 结论

1. **端到端闭环成立**：真实模型 → `skill` 工具加载内嵌 Skill → 按 Skill 正文调用 `data_clean_rows` → 工具真实执行（`execute` 日志落地）→ 模型只回摘要。链路里没有一个环节是宿主代跑。
2. **双基线同构**：rc.2 与 alpha.2 输出、退出码、session 事件序列一致；唯一差别是 alpha.2 额外打印 `reasoning:` 轨迹（透明化，非行为差异）。
3. **headless 一键任务可行**：`dsh --profile headless "<task>"` 在双基线上都是"合成 → 建 agent → 跑回合 → flush session → 打印终答 → exit 0"，可作为 CI 的冒烟入口。
4. **密钥卫生**：真实 key 仅存在于子进程 env，隔离 home 与 workspace 内无任何落盘密钥。

## 风险与遗留

- 本 spike 任务规模为 5 行；Spike #5 已验证工具可吞吐 1000 行 Mock，但**"模型自行生成/上传千行级真实数据 → 工具批处理"**的完整链路尚未联合验证（skill 正文已改为"清洗用户提供的行，不编造填充"，与 spike5 的 1000 行 Mock 语义不同）。是否值得一个千行级真实数据联合 spike，留待产品决策，不阻塞基线。
- `deepseek-v4-pro` 经 `ai-gateway.greatld.com` 网关，非官方直连；真实模型行为可能随网关/模型版本漂移，属运行环境变量，非 DSH seam 差异。
- 本次未验证 agent 组合内的 `dsh-tool-jobs`（长任务归因），属 Spike #4 已记录的产品级遗留，不在本 spike 范围。
