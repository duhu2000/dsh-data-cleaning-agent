# Spike #5 — 工具闭环（内嵌 Skill 触发工具 + 1000 行 Mock 三步闭环）

> 状态：**PASS（双基线同构）**　探针：`spike5/plugin`（`@qcc/dsh-data-cleaning-agent@0.0.5-spike5`）
> 基线：`dsh 0.1.1-rc.2`（端口 43128）　`0.1.2-alpha.2`（端口 43129），均为隔离 `DSH_HOME` + `web` profile

## 1. 结论摘要

| 验证项 | rc.2 | alpha.2 | 说明 |
|---|---|---|---|
| `ctx.tools.register`（hand-rolled definition） | ✅ | ✅ | `output.render` 函数 + `output.schema` 过 `assertSupportedJsonSchema` |
| `ctx.tools.get(name, scope)` 读回 | ✅ | ✅ | `tools.get("data_clean_rows")` 命中 |
| `ctx.tools.schemas()` 模型投射 | ✅ | ✅ | `{ name, description, parameters }`，`visibleInModelSchemas:true` |
| `ctx.tools.execute` 直接调度 | ✅ | ✅ | `signal` + lossless JSON `arguments`，返回 `value` + `renderedText` |
| `ctx.skills.register`（runtime skill） | ✅ | ✅ | `provider:"runtime"`，进全局 layer，`list()` 可见 |
| `ctx.skills.get(name)` 读回 | ✅ | ✅ | `source`（字符串）+ `content`（字符串）缺一不可 |
| 内嵌 Skill 正文指向工具名 | ✅ | ✅ | `bodyHasToolName:true` |
| 1000 行 Mock 三步闭环 | ✅ | ✅ | `total 1000 / kept 600 / dropped 400 / badMissing 200 / badAmount 200` |
| 插件路由双基线均无 token 门禁 | ✅ | ✅ | `/data-cleaning/api/spike5/*` 直接 200 |
| 跨站/非本机 Origin 防护 | ✅ | ✅ | `sec-fetch-site:cross-site` → 403 |

## 2. 关键 seam 契约（一手源码 + 实测）

### 2.1 `ctx.tools`（服务 id `tools`，`@deepseek-ai/dsh-tools`，`ToolRuntime`）

- `register(definition)`：只校验三件事——`output` 为对象且 `output.render` 是函数（`presentationMeta` 若存在须为函数）、`output.schema` 过 `assertSupportedJsonSchema`、`name !== "run_code"`（保留名）。**不**校验 `parameters`（那层校验在 `defineTool` 的 `parameterSchemaSpecToJsonSchema` 里做）。返回 disposer。
- `get(name, scope)`：按 scope 分层查；无 scope 走全局层。
- `schemas(scope)`：返回**模型面向投射** `{ name, description, parameters }[]`（`schemaOf` + `snapshotJsonValue` 脱机快照）。实测 host bundle 全局层只有自己注册的 `data_clean_rows`（`totalSchemas:1`）——**base 里的 `skill`/`bash` 等工具注册在 agent 作用域层，不在 host bundle 的全局层可见**。
- `execute(exec)`：`exec` 须含 `{ callId, name, signal (AbortSignal), arguments (lossless JSON，deepFrozen) }`；`rootCallId` 缺省回退 `callId`；`agent`/`parent` 可选。直接 `execute` 自定义工具**不会被 code-mode 折叠**（`collapses = !nested && modeFor(scope)==="code" && name!=="run_code"`，`defaultMode="native"`）。流水线：`tools/pre-execute` waterfall → guards（无 guard → `{kind:"allow"}`，不弹审批）→ `tool.execute(args, exec)` → `createSuccessResult`（按 `output.schema` 校验 value）→ `output.render(args, value)` → `content:[{type:"text",text}]`。

### 2.2 手写 tool definition 的 schema 方言（关键踩坑）

`register` 校验的 `output.schema` 是**纯 JSON Schema 子集**（`type/oneOf/properties/required/additionalProperties/items/enum/const` + `description/title/default/examples` 注解）：

- `required` 必须是**对象级字符串数组**（如 `required: ["total","kept"]`），且列出的键必须出现在 `properties` 里。
- **`required: true` 写进 property 内部是 `defineTool` 的 schemastery 作者方言**，`register` 会拒：实测首版把 `required:true` 放进每个 property，报
  `unsupported JSON schema: schema.properties.total.required is not supported on type "integer"`。
- `parameters` 同理（尽管 `register` 不校验它，但 `schemas()` 投射与后续 `validateArgs` 都按同一子集解释），统一改成对象级 `required` 数组。
- `additionalProperties` 只允许 boolean；`items` 只允许挂在 `type:"array"` 上；`enum`/`const` 只允许挂在标量类型上。

### 2.3 `ctx.skills`（服务 id `skills`，`@deepseek-ai/dsh-skill`，`SkillRegistry`）

- `register(skill)`：`validateRuntimeSkill` 要求 name 匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`、`description` 非空、`invocation` 合法（缺省 `{modelInvocable:true,userInvocable:true}`）。provider 缺省 `"runtime"`。进全局 layer（`scopeOf(ctx)===undefined` 时），返回 disposer。
- `get(name, options)`：runtime provider 返回 `candidate.locator` 后**再跑一遍 `validateDefinition`**——因此 `source`（字符串）与 `content`（字符串）**都必须是 truthy 字符串**，缺任一即 `get()` 失败。本探针 skill 两个都带，`get()` 返回 body 且正文含工具名 `data_clean_rows`。
- `list(options)`：`renderSkillContent` 走同一投射；实测 `list()` 找到 1 个 runtime skill。

### 2.4 内嵌 Skill 触发工具的"三步闭环"（无真实 LLM 的等价证明）

本 spike 不引入 live model，闭环用三段 curl 证明：

1. **注册**：`ctx.skills.register` 内嵌 runtime skill `data-cleaning`，`content` 明确指示"把每一行原始数据一次性发给 `data_clean_rows` 工具"。
2. **可加载**：`ctx.skills.list()` 可见 + `ctx.skills.get("data-cleaning")` 读回 body，`bodyHasToolName:true`（正文确实指向工具名）。
3. **可调度**：`ctx.tools.execute` 以 1000 行 Mock 脏数据（`mockRows(1000)`，规则 i%10：0 缺名 / 1 缺电话 / 2 金额非数字 / 3 负值 / 其余干净）直接调度 `data_clean_rows`，返回 `value:{total:1000,kept:600,dropped:400,badMissing:200,badAmount:200}` 与 `renderedText:"cleaned 1000 rows: kept 600, dropped 400 (missing 200, bad-amount 200)"`。

等价性：真实链路是「模型 → base `skill` 工具加载正文 → 模型依正文调用 `data_clean_rows` → 结果回灌」。本探针绕开模型，直接验证了该链路的**两端 seam**（skill 可加载、tool 可调度）与**中间约定**（正文指向工具名），且 base 的 `skill` loader 工具（`@deepseek-ai/dsh-tool-skill`，base patch `id: tool-skill`）已在组合内——它按 `agent/pre-step` 注入 skill 正文、按 `cwd/scope` 查 `ctx.skills.get`，与本探针 `get()` 同一 registry。Spike #6 端到端将接真实模型闭环。

### 2.5 插件路由双基线 tokenless + 同源防护

- `/data-cleaning/api/spike5/{seam,schemas,skills,execute}` 在 rc.2 与 alpha.2 **均无 token 门禁、直接 200**（alpha.2 外壳 token 不影响插件路由，延续 Spike #2 结论）。
- `isTrusted(req)` 拒绝 `sec-fetch-site:cross-site`（实测 403）与非 127.0.0.1/localhost Origin。

## 3. 对数据清洗 Agent 的落点

- **工具形状定型**：`data_clean_rows` 用**对象级 `required` 数组**的纯 JSON Schema 子集声明 `parameters` 与 `output.schema`；不要再把 `required:true` 写进 property（那是 `defineTool` 方言，不经它包装会踩 `assertSupportedJsonSchema`）。
- **内嵌 Skill 作为操作手册**：`source` + `content` 都是必填字符串；正文里写清"调哪个工具、一次传多少行"，模型即可依正文触发工具。
- **三步闭环已验证到 seam 层**：skill 注册/加载 ✅、tool 注册/模型投射/调度 ✅、正文指向工具名 ✅；只差真实模型把三段串起来（Spike #6 端到端）。
- **作用域注意**：host bundle 的 `ctx.tools.schemas()` 只见自己的全局工具；agent 组合里的 `skill`/`bash` 等工具在 agent 作用域层，不在 host 全局层——做"工具可见性"自检时要分 scope 看。

## 4. 复现

```bash
cd spike5/plugin && pnpm pack --out ../qcc-dsh-data-cleaning-agent-0.0.5-spike5.tgz
# 隔离 DSH_HOME 各装一次（profile package.json dep 用绝对 file: 路径），然后：
DSH_HOME=$PWD/../home-rc2    dsh --profile web --host 127.0.0.1 --port 43128 --no-open
DSH_HOME=$PWD/../home-alpha2 node $PWD/../../spike1/cli-alpha2/node_modules/@deepseek-ai/dsh/lib/bin.js \
  --profile web --host 127.0.0.1 --port 43129 --no-open
# 四路由（rc.2 43128 / alpha.2 43129 同形）：
curl -H 'sec-fetch-site: same-origin' http://127.0.0.1:43128/data-cleaning/api/spike5/seam
curl -H 'sec-fetch-site: same-origin' http://127.0.0.1:43128/data-cleaning/api/spike5/schemas
curl -H 'sec-fetch-site: same-origin' http://127.0.0.1:43128/data-cleaning/api/spike5/skills
curl -H 'sec-fetch-site: same-origin' http://127.0.0.1:43128/data-cleaning/api/spike5/execute
```

`/execute` 期望回显：`loop:true`、`value:{total:1000,kept:600,dropped:400,badMissing:200,badAmount:200}`、`renderedText` 含 "kept 600, dropped 400"。

## 5. 已知边界 / 遗留

- **未接真实模型**：闭环证明到 seam 层（注册/加载/调度 + 正文指向），模型把三段串起来留 Spike #6（端到端）。
- **base `skill` 工具作用域**：`ctx.tools.schemas()` 全局层只有本插件工具；base 工具在 agent 作用域层，需 agent 组合才可见——Spike #6 在 agent 组合内复核 `skill` loader 的 `agent/pre-step` 注入是否与本探针 skill 一致。
- **打包格式**：直接 `tar -czf`（无 `package/` 前缀）会被 pnpm 解成扁平目录导致 `lib/index.js` 缺失；必须用 `pnpm pack`（产生 `package/lib/...` 前缀）或等价 npm 格式。已用 `pnpm pack --out` 修正。
