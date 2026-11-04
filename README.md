# dsh-multi-model-collab

让**同一个任务同时交给多个大模型**协作完成，而不是单模型串行——一个 DeepSeek Harness（dsh）插件。

插件向当前 Profile 注册一个 `multi_model_run` 工具。主 Agent 调用它时，插件内部通过 `ctx.llm` 服务**并行**（或按主/副角色）发起多次模型调用，再按配置的策略聚合，把「每个模型的独立结果 + 聚合摘要」返回给主 Agent。

- 不修改 dsh 源码，纯 Cordis 插件挂载：`ctx.tools.register` + `ctx.llm`。
- 不硬编码任何 API Key、端点或模型清单；模型一律用 `ctx.llm.listProviders()` 报告的 `<provider>/<model>` 路由。
- 单个模型失败**不会**让整个工具调用失败；只有全部模型失败时 `execute` 才抛异常。
- 遵循 `exec.signal`：调用方取消时，仍在进行的模型调用一并取消。

---

## 一、安装

### 方式 A：安装到 Profile（推荐，长期生效）

```bash
# 在插件包目录内（即本仓库根目录）
dsh plugin --profile desktop add .
```

该命令把本包装进 `~/.dsh/profiles/<profile>/node_modules`，`package.json` 的
`dsh.bundle.patch` 指向的 `cordis.patch.yml` 会作为 bundle patch 层生效。

也可以用 dsh 的插件管理器（在 dsh 会话内）：

```text
plugin_manager(action="install_bundle", target="<本目录绝对路径>")
```

### 方式 B：`--patch` 覆盖层（不安装，直接试）

`cordis.patch.yml` 里插入行的 `name` 是相对路径（`./lib/index.js`），
Loader 会把它锚定在**该 patch 文件旁边**，所以无需安装即可挂载：

```bash
dsh web --patch ./cordis.patch.yml            # 若用 pnpm 管理 dsh：pnpm dsh web --patch ./cordis.patch.yml
dsh web --patch ./cordis.patch.yml --no-open --port 0   # 不抢端口、不自动开浏览器
# 或一次性 headless 验证：
dsh --profile <headless-profile> --patch ./cordis.patch.yml "用 multi_model_run 跑一个任务"
```

> headless 模板默认把 `credentials` 行设为 `disabled: true`；若你的 Profile 没有
> 其它层重新启用它，API Key 会查找失败（`MISSING_CREDENTIAL`）。再叠一层
> `- id: credentials\n  disabled: false` 即可（见 `verify/patch-forms/enable-credentials.yml`）。
> Web / Desktop Profile 本来就启用了该行，无需处理。

### 构建

`lib/` 是 `src/` 的编译产物，随包发布；改源码后重新生成：

```bash
npm install          # 仅需 typescript 与 dsh 的类型包（devDependencies）
npm run build        # tsc -> lib/ ，并 node --check 校验产物
npm test             # 离线行为测试（假 ctx.llm，不发网络请求）
```

---

## 二、配置

所有配置都在 Loader 行（`cordis.yml` / `cordis.patch.yml`）的 `config:` 下，
改值不需要改代码。字段与默认值如下（同 `src/index.ts` 的 `Config`）。

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `models` | `string[]` | `["deepseek-official/deepseek-flash", "deepseek-official/deepseek-v4-pro"]` | 默认模型组合，格式 `<provider>/<model>`。`primary_secondary` 模式下**第一个**是主模型。 |
| `mode` | `parallel` \| `primary_secondary` | `parallel` | 执行模式，见下文。 |
| `aggregate` | `all` \| `vote` \| `longest` | `all` | 聚合策略，见下文。 |
| `defaultProvider` | `string` | `""` | 模型标识不带 provider 前缀时使用哪个 provider；空则按各 provider 的目录自动匹配。 |
| `system` | `string` | `""` | 发给每个模型的 system prompt；空则不发。 |
| `temperature` | `number` | `-1` | 采样温度；负数表示不发该字段（用适配器默认）。 |
| `maxTokens` | `number` | `0` | 单次调用的输出 token 上限；`0` 表示不限制（用适配器默认）。 |
| `perModelTimeoutMs` | `number` | `180000` | 单个模型调用的取消预算。 |
| `toolTimeoutMs` | `number` | `900000` | 整个工具调用的协作预算；`0` 表示交给注册表默认。 |
| `maxConcurrency` | `number` | `4` | 同时在飞的模型调用数上限。 |
| `clipChars` | `number` | `12000` | 每个模型返回文本的截断长度；`0` 表示不截断。未截断长度仍记录在 `chars`。 |
| `includeUsage` | `boolean` | `true` | 是否上报每个模型的 token 用量（适配器提供时）。 |
| `secondaryInstruction` | `string` | 审阅指令（中英双语） | `primary_secondary` 模式下要求副模型做什么。 |

### 执行模式

- **`parallel`** —— 每个模型独立回答同一个任务，全部并行。适合：要第二意见、要跨供应商一致性、答案可能有分歧的场合。
- **`primary_secondary`** —— 主模型先答；其余模型拿到「原始任务 + 主模型草稿 + `secondaryInstruction`」，
  做审阅、纠错与补全。适合：需要一个"审稿人"、单点判断风险高的场合。
  主模型失败时自动降级为各副模型独立作答（而不是整体失败）。

### 聚合策略

- **`all`** —— 原样返回全部结果，不做选择（`answer` 为空串）。**默认**，因为分歧本身往往是主 Agent 需要的信息。
- **`vote`** —— 先把文本归一化（大小写、标点、空白、Markdown 符号）再分组；严格多数则取该组代表，
  无严格多数则回退到最长答案，并在 `summary` 里说明实际票数与回退原因。
- **`longest`** —— 取最长的成功答案（`answer`）。

---

## 三、工具：`multi_model_run`

### 入参

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `task` | 是 | 要执行的任务/问题。**每个模型只看到这段文本**，看不到当前会话，必须自带上下文。 |
| `models` | 否 | 本次使用的模型列表，覆盖配置的 `models`。 |
| `mode` | 否 | 本次执行模式，覆盖配置。 |
| `aggregate` | 否 | 本次聚合策略，覆盖配置。 |
| `system` | 否 | 本次 system prompt，覆盖配置。 |

### 返回

```jsonc
{
  "task": "…",
  "mode": "parallel",
  "aggregate": "all",
  "models": ["deepseek-official/deepseek-flash", "deepseek-official/deepseek-v4-pro"],
  "succeeded": 2,
  "failed": 0,
  "results": [
    {
      "provider": "deepseek-official",
      "model": "deepseek-flash",
      "id": "deepseek-official/deepseek-flash",
      "role": "peer",              // primary | secondary | peer
      "status": "ok",              // ok | failed
      "text": "…",
      "clipped": false,
      "chars": 12,
      "durationMs": 1840,
      "error": null,               // 失败时 { code, message }
      "usage": { "inputTokens": 10, "outputTokens": 5, "totalTokens": 15 }
    }
  ],
  "answer": "",                    // aggregate=longest|vote 时是被选中的答案
  "summary": "mode=parallel aggregate=all models=2 ok=2 failed=0 elapsed=2140ms\n- OK   …"
}
```

`render()` 把这些渲染成一段 Markdown（每个模型一节 + `## aggregate` 摘要 + 可选 `## selected answer`），
主 Agent 读到的就是这段文本。

### 失败与取消

- 单个模型失败（适配器报错、抛异常、无终止 chunk、超时）→ 该条 `status: "failed"` + `error.code`，
  其余模型继续；工具整体仍然成功。
- **全部**模型失败 → `execute` 抛错，错误信息里带每个模型的 `code: message`，
  并带 `code: "ALL_MODELS_FAILED"`（dsh 将它标记为 `isError`）。
- `exec.signal` 触发 → 已发出的模型调用被取消；若一个都没成功则抛 `ABORTED`。
- 模型引用无法解析（例如只写了 `deepseek-flash` 但目录里匹配不到、又没配 `defaultProvider`）→
  抛错并**列出当前所有可用的 `provider/model` 路由**，方便直接改对。

---

## 四、验证

### 离线行为测试（不发网络请求，21 个用例）

```bash
npm test
```

覆盖：插件契约、`defineTool` 参数/输出 schema 编译、并行执行、失败隔离、全失败抛错、
`vote`/`longest` 聚合、`primary_secondary` 的审阅 prompt 与主模型失败降级、
模型引用解析（含目录查找与报错文案）、文本截断、取消、缺终止 chunk。

### 端到端（真实模型，需要已配置的供应商）

```bash
npm run e2e        # 4 个真实场景，约 2 分钟，会消耗真实 token
```

它会自建/复用临时 headless profile（默认 `mmcollab`），挂 `./cordis.patch.yml` 让真实 Agent
调用 `multi_model_run`，并断言四件事：并行双模型都返回、单模型失败被隔离、`primary_secondary`
的副模型真的审阅了草稿、全部失败时工具调用本身报错。

手工单跑（等价）：

```bash
# 1) 造一个临时 headless profile（不影响 desktop）
node "<dsh>/lib/bin.js" --profile mmcollab --from-default-profile headless --dump-config

# 2) 挂 patch 跑一次真实多模型调用
node "<dsh>/lib/bin.js" --profile mmcollab \
  --patch ./verify/patch-forms/enable-credentials.yml \
  --patch ./cordis.patch.yml --json \
  "Call the multi_model_run tool exactly once with task='Reply with exactly the single word PONG and nothing else.' and omit every other argument. Then print the tool result verbatim."
```

> ⚠️ 只看退出码是不够的：Loader 对**没能激活**的插件行只打印一条 stderr 警告，进程照样 exit 0。
> 验收必须断言 `--json` 输出里出现 `tool_call` / `tool_result`。

实测记录（含四个场景的逐字输出）见 [`docs/acceptance-evidence.md`](docs/acceptance-evidence.md)；
挂载机制与负例（目录行 / 裸包名行为何失败）见 [`docs/runtime-install.md`](docs/runtime-install.md)。

---

## 五、设计说明

**为什么走 `ctx.llm.stream()` 而不是复用子 Agent？**

dsh 里"多 Agent"插件（子 Agent、agent-team）解决的是**带工具、带会话、多步**的委派：每个子 Agent 有
自己的 loop、工具集和上下文。本插件解决的问题不同——**一个任务要 N 个模型各答一遍**，不需要工具、
不需要多步，只需要"同一请求发给多个模型并对比结果"。这种场景直接用 `ctx.llm.stream()` 最省：

- 一次调用只产生 N 条模型请求，没有子 Agent 的会话/工具/编排开销；
- 结果结构是确定的 JSON，主 Agent 可以直接比较；
- 取消语义直接映射到 `exec.signal` → `options.signal`；
- 天然跨供应商：只要 `listProviders()` 里有，就能混用。

代价是这些调用不是完整 Agent 回合（没有工具循环），对于"需要模型自己查资料再回答"的任务，
应改用子 Agent 机制。

**关键实现事实**（均取自本机 dsh 0.2.1 的实测/类型）：

- `ctx.llm.stream(options)` 只接受**一个**参数；取消用 `options.signal`（不是第二个参数）。
- 终止情况有两条通道：`for await` 可能抛异常，**并且**一定会有终止 chunk
  `{ type: 'finish', reason: { kind } }`；`kind` 为 `stop | tool-calls | max-tokens` 是成功，
  `error | aborted` 失败并带 `failure.code/message`。
- 工具定义用的是 dsh 的**作者 DSL**而非原始 JSON Schema：`parameters` 是隐式对象根的属性表，
  必填写在属性内 `required: true`；`output.schema` 里每个 `type: 'object'` 必须显式写
  `additionalProperties`。

---

## 六、已知限制

1. **这些调用不进入会话日志**：`ctx.llm.stream()` 直调不是 Agent 回合，因此不会写入 session，
   也不会被按会话计量的插件（如 cost-meter）统计——`GenerateOptions.sessionId` 没有设置。
   每个模型的实际用量请看返回里的 `usage` 字段（`includeUsage: true` 时）。
2. **没有工具循环**：模型只拿到 `task` 文本，不能自己检索或执行命令。需要模型动手的任务请用子 Agent 机制。
3. **`vote` 是文本归一化后的严格多数**，不是语义投票：开放式答案几乎不会逐字一致，通常会回退到最长答案，
   并在 `summary` 里写明实际票数与回退原因。
4. **结果体积**：默认每个模型最多 12000 字符 × 模型数。模型多或答案长时请调小 `clipChars`。
5. **版本对齐**：实测于 dsh `0.2.1`（CLI rc.2 / 桌面打包运行时 rc.3）。契约细节见
   [`docs/api-contracts.md`](docs/api-contracts.md)。

---

## 七、与同名项目的区别

GitHub 上存在一个**同名但无关**的项目 [`zanapeng/dsh-multi-model-collab`](https://github.com/zanapeng/dsh-multi-model-collab)
（2026-08 创建）。它的做法是把一条**固定四段流水线**写死：mimo-v2.5 识图/接需求 → deepseek-v4-pro 决策 →
mimo-v2.5-pro 执行 → deepseek-v4-flash 审核。

本插件不是流水线，而是一个**通用工具**：

| | zanapeng 的同名项目 | 本插件 |
| --- | --- | --- |
| 模型来源 | 写死的特定模型 | 任意已配置供应商/模型，`ctx.llm.listProviders()` 动态解析 |
| 调用结构 | 固定 4 段串行编排 | `parallel` 并行 / `primary_secondary` 主副复核，由调用方或配置决定 |
| 聚合 | 流水线内固定交接 | `all` / `vote` / `longest` 可选 |
| 失败处理 | 未公开说明 | 单模型失败隔离并逐条上报，全失败才报错 |
| 取消 | 未公开说明 | 遵循 `exec.signal`，取消时终止在飞的模型调用 |

两者互不依赖、可共存；投稿说明里已把这一点写清楚，避免被误判为重复条目。

---

## 八、目录结构

```
src/index.ts         插件源码（唯一实现，TypeScript）
lib/index.js         编译产物，插件运行时入口（package.json main）
assets/icon.png      插件图标（180×180，由 scripts/make-icon.py 生成）
cordis.patch.yml     bundle patch 层：插入行 + 全部可配置项
test/run.mjs         离线行为测试（假 ctx.llm，21 用例）
scripts/e2e.mjs      真实模型端到端验收（npm run e2e，4 场景）
scripts/publish-to-github.mjs  一条命令建仓 + push + topic + 回填仓库元数据
scripts/open-market-pr.mjs     一条命令 fork 精选列表 + 提交市场条目 + 开 PR
scripts/make-icon.py           重新生成 assets/icon.png
.github/workflows/ci.yml  CI：Node 20/22/24 上 build + 校验 lib 与源码一致 + 离线测试
CHANGELOG.md         版本记录
docs/api-contracts.md        dsh `llm` / `tools` 服务契约实测记录（实现依据）
docs/runtime-install.md      --patch 挂载机制、负例与安装流程实测
docs/acceptance-evidence.md  四个真实场景的逐字证据
docs/web-ui-verification.md  Web UI 中的验证记录
docs/market-submission.md    上架 dsh 插件市场（awesome-dsh-plugin）全流程
verify/              验证用临时 bundle、patch 形态与证据（不随 npm 包发布）
tools/               研究辅助脚本（asar 提取、类型声明导出）
```

## License

MIT
