# Host API contracts — `llm` + `tools` (verbatim, this installed harness)

Status: authoritative reference for implementing the plugin. **Nothing here is invented.**
Every claim is tagged with its evidence class:

- `[LIVE]` — read from the running harness via `cordis_inspect_query` / `cordis_inspect_list` (authority).
- `[SRC]` — copied verbatim from the extracted package source in `tools/ref/dsh/node_modules/@deepseek-ai/...` (shipped in the asar).
- `[README]` — copied verbatim from a shipped package README (`@deepseek-ai/dsh-llm`, `@deepseek-ai/dsh-tools`).
- `[INFERRED]` — read off code but not itself a declared type.
- `UNVERIFIED:` — could not be proven; says what was checked.

Environment this was recorded against (2026-10-25):

| fact | value |
|---|---|
| package versions | `@deepseek-ai/dsh-llm` **0.2.1-rc.3**, `@deepseek-ai/dsh-tools` **0.2.1-rc.3** `[SRC package.json]` |
| installed location | `D:\Program Files (x86)\deepseek harness\resources\app.asar` (asar; extractor at `tools/asar-extract.js`; **no `.d.ts` and no `docs/` inside the asar** — verified by parsing the asar header, 18188 entries, 0 `*.d.ts`) |
| live profile | `%USERPROFILE%\.dsh\profiles\desktop` (bundles from `package.json` → `dsh.profile.bundles`, then `cordis.patch.yml`, then `--patch`) |
| live default model row | `provider: deepseek-official`, `model: deepseek-flash`, `reasoningEffort: high` — `[SRC]` live `~/.dsh/profiles/desktop/cordis.patch.yml` |

> Because the asar ships **no** `.d.ts` files, the "verbatim type declarations" below come from the live
> introspection projection (which reads the runtime Typert registry, e.g.
> `tools/ref/dsh/node_modules/@deepseek-ai/dsh-llm/lib/typert.host.js`) — that is the same text the harness
> itself publishes, so it is the closest thing to the real `.d.ts` that exists on this machine.

---

## 0. Service keys that actually exist

`cordis_inspect_query({platform:"host", provider:"Service", method:"listService"})` with **no** input returns a
catalog of **every** service key (86 KB). Confirmed relevant keys:

```
llm
tools
agentDefaultModel
agents
agentTeams          (provided by @deepseek-ai/dsh-experimental-agent-team)
session / sessions  -> see UNVERIFIED note below
```

- `[LIVE]` `service: "llm"` → OK. `service: "tools"` → OK. `service: "agent"` → **`Error: no catalogued Service named "agent"`**.
  There is **no `agent` service**; agent-scoped things are reached through `exec.agent` (tool execution), `agents`
  (registry), or `agentDefaultModel`.
- `UNVERIFIED:` the exact `session`/`sessions` service key — I did not spend a query on it because the
  plugin needs `llm` + `tools` (+ optionally `agentDefaultModel`); re-run `listService` with no input and
  search the 86 KB result if needed.

Access forms `[LIVE]`:

```ts
// optional access
ctx.get("llm")            // returns undefined when unmounted -> requiresUndefinedCheck: true
// hard dependency (declare in `inject`)
inject: ["llm"]           // then: ctx.llm
inject: ["tools"]         // then: ctx.tools
```

---

## 1. `llm` service — streaming

`[LIVE]` service description: *"The abstract `llm` service: an adapter registry plus a streaming model-call API,
interceptable via the `llm/stream` waterfall."*

### 1.1 Exact method signatures (verbatim from `listService({service:"llm"})`)

```ts
registerAdapter(providers: string[], adapter: LlmAdapter): AdapterRegistrationHandle
@Remote listProviders(): LlmProviderInfo[]
registerConfigurableProviders(entries: readonly LlmConfigurableProvider[]): DirectoryRegistrationHandle
@Remote listConfigurableProviders(): LlmConfigurableProvider[]
registerModelDiscovery(
  settingsNs: string,
  discover: (request: LlmModelDiscoveryRequest, signal?: AbortSignal) => Promise<readonly LlmDiscoveredModel[]>,
): () => void
async discoverModels(settingsNs: string, request: LlmModelDiscoveryRequest, signal?: AbortSignal): Promise<LlmDiscoveredModel[]>
@Remote('discoverModels') async remoteDiscoverModels(settingsNs: string, request: LlmModelDiscoveryRequest, signal: AbortSignal): Promise<LlmDiscoveredModel[]>
providerRetryPolicy(provider: string): ResolvedRetryPolicy
imageRequestPricing(provider: string, model: string): LlmImageRequestPricing | undefined
imageRequestTarget(provider: string, model: string, image: ImageAttachmentRef): ImageRequestTarget
fileRequestText(ref: FileAttachmentRef): string
async listModels(provider: string): Promise<LlmModelInfo[]>
async resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>
async resolveCallConfig(config: LlmCallConfig, signal?: AbortSignal): Promise<LlmCallConfig>
async prepareCall(config: LlmCallConfig, signal?: AbortSignal, configure?: ConfigureCall): Promise<PreparedLlmCall>
stream(options: GenerateOptions): AsyncIterable<StreamChunk>
```

### 1.2 `stream()` — the five answers you need

1. **Signature is single-argument**: `stream(options: GenerateOptions)`.
   `[LIVE]` `"parameters": [{"name": "options", "description": "the full request; `options.provider` selects the adapter."}]`
   **There is no second argument** (`configure` lives only on `prepareCall`).
2. **Cancellation is a plain `AbortSignal` field inside the options** — not `exec.signal` at this layer:

```ts
signal?: AbortSignal;     // GenerateOptions.signal
```

   A tool passes `exec.signal` (or a child of it) into `options.signal`; see §3.4.
3. **Terminal success vs error** is a terminal `finish` chunk, and only that:

   - success: `reason.kind === 'stop' | 'tool-calls' | 'max-tokens'`
   - failure: `reason.kind === 'error'` → `reason.failure` is an `LlmFailure`
   - cancelled: `reason.kind === 'aborted'` → `reason.failure` is an `LlmFailure`

   `[LIVE]` *"Adapter selection, dispatch, and iteration failures become terminal `error` or `aborted` finish
   chunks; middleware, nested-call, cleanup, and consumer failures remain thrown."*
   So: **you must `try/catch` around the `for await` loop AND check the finish reason.** Two failure channels.
   `[SRC]` `dsh-llm/lib/index.js:2306-2324` — `async *adapterStream(options, prepared)` wraps
   `this.registration(options.provider)` (which throws `NO_ADAPTER`) into the terminal chunk path.
4. **Failure codes**: `LlmFailure.code` is an open `string` (route on it, never parse `message`).
   Canonical exported constants `[SRC] dsh-llm/lib/types/error.js`:

   | constant | value |
   |---|---|
   | `CONTEXT_WINDOW_EXCEEDED_CODE` | `'CONTEXT_WINDOW_EXCEEDED'` |
   | `QUOTA_EXCEEDED_CODE` | `'QUOTA'` |
   | `ACCOUNT_QUOTA_EXCEEDED_CODE` | `'ACCOUNT_QUOTA'` |
   | `EMPTY_RESPONSE_CODE` | `'EMPTY_RESPONSE'` |
   | `INVALID_CREDENTIAL_CODE` | `'INVALID_CREDENTIAL'` |

   Other codes observed in source (thrown, not in-band): `NO_ADAPTER`, `INVALID_ADAPTER`, `DUPLICATE_ADAPTER`,
   `REGISTRATION_DISPOSED`, `INVALID_DIRECTORY`, `DUPLICATE_DIRECTORY`, `INVALID_DISCOVERY`,
   `DUPLICATE_DISCOVERY`, `NO_DISCOVERY`, `INVALID_PREPARED_CALL`, `IMAGE_OFFLOAD_REQUIRED`,
   and the doc-cited `AUTH`, `RATE_LIMIT`, `MISSING_CREDENTIAL` `[SRC index.js:122,154,1613,1662,1836,1846,1857,1871-1874,1933-1945,1979-2001,2247-2261]`.
5. **`MISSING_CREDENTIAL` / auth failures** are produced by adapters; the deepseek adapter's provider route is
   `deepseek-official` `[SRC] live profile patch`.

### 1.3 `GenerateOptions` — verbatim `[LIVE]`

```ts
export interface GenerateOptions {
    provider: string;
    model: string;
    reasoningEffort?: ReasoningEffortId;
    messages: RequestMessage[];
    system?: string;
    tools?: ToolSchema[];
    toolHistory?: ToolHistory;
    temperature?: number;
    maxTokens?: number;
    stop?: string[];
    signal?: AbortSignal;
    sessionId?: Branded<'SessionId'>;
    purpose?: 'compaction' | 'session-title';
}
```

`reasoningEffort` is a branded `ReasoningEffortId` (`export type ReasoningEffortId = Branded<'ReasoningEffortId'>`).
`[SRC]` `dsh-agent-default-model/lib/index.js:10` shows the coercion helper used in-tree:
`ReasoningEffortId(settings.reasoningEffort)` — i.e. the brand is applied by calling the exported function on a plain string.

### 1.4 `StreamChunk` — verbatim `[LIVE]`

```ts
export type StreamChunk = {
    type: 'block-start';
    index: number;
    blockType: ContentBlockType;
} | {
    type: 'text-delta';
    index: number;
    text: string;
} | {
    type: 'reasoning-delta';
    index: number;
    text: string;
} | {
    type: 'tool-call-delta';
    index: number;
    id: ToolCallId;
    name?: string;
    argumentsDelta: string;
} | {
    type: 'block-end';
    index: number;
    block: ContentBlock;
} | {
    type: 'usage';
    usage: TokenUsage;
} | {
    type: 'finish';
    reason: FinishReason;
    replayState?: ReplayEnvelope;
};
```

Related, verbatim `[LIVE]`:

```ts
export interface FinishReasonMap {
    'stop': { kind: 'stop'; };
    'tool-calls': { kind: 'tool-calls'; };
    'max-tokens': { kind: 'max-tokens'; };
    'aborted': { kind: 'aborted'; failure: LlmFailure; };
    'error': { kind: 'error'; failure: LlmFailure; };
}
export type FinishReason = FinishReasonMap[keyof FinishReasonMap];

export interface LlmFailure {
    readonly message: string;
    readonly code: string;
    readonly status?: number;
    readonly providerRetryAfterMs?: number;
    readonly requestId?: ProviderRequestId;
    readonly offloadImages?: number;
}

export interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
    totalTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
}

export type ContentBlockType = keyof ContentBlockMap;
export type ContentBlock = ContentBlockMap[ContentBlockType];
export interface ContentBlockMap {
    'text': TextBlock;
    'reasoning': ReasoningBlock;
    'image': ImageBlock;
    'file': FileBlock;
    'tool-call': ToolCallBlock;
    'tool-addition': ToolAdditionBlock;
    'tool-removal': ToolRemovalBlock;
}
export interface TextBlock { type: 'text'; text: string; }
export interface ReasoningBlock { type: 'reasoning'; text: string; }
export interface ToolCallBlock { type: 'tool-call'; id: ToolCallId; name: string; arguments: string; }
```

### 1.5 Messages — how to build a user prompt

Verbatim `[LIVE]`:

```ts
export interface MessageBase {
    readonly id: MessageId;
    readonly content: readonly ContentBlock[];
    readonly source: MessageSource;
}
export type Message = MessageRoleMap[keyof MessageRoleMap];
export interface MessageRoleMap {
    system: SystemMessage;
    developer: DeveloperMessage;
    user: UserMessage;
    assistant: AssistantMessage;
    tool: ToolResultMessage;
}
export interface UserMessage extends MessageBase { readonly role: 'user'; }
export type RequestMessage = Message | RequestUserInput;
export interface RequestUserInput {
    readonly role: 'user';
    readonly content: UserMessage['content'];
    readonly id?: never;
    readonly source?: never;
}
```

**The exact object literal for a one-shot prompt is the request-only form** (no `id`, no `source`) —
this is exactly what the shipped README shows `[README] dsh-llm/README.md`:

```ts
for await (const chunk of ctx.llm.stream({
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
})) {
  // chunks: block-start, text-delta, ..., usage, finish
}
```

`[README]` *"`GenerateOptions.messages` accepts durable `Message` values and request-only `RequestUserInput`
values. Request-only inputs carry user-role content with no `id` or `source`."*
(So `{ role:'user', content:[{type:'text',text:'…'}] }` is legal and is the right choice for a plugin call.
A `{role:'user', id:…, source:…}` durable message is only needed if you write it into the session log.)

`[SRC]` helper exports that build durable messages (they call `structuredClone` + `randomUUID` + deep freeze):
`createMessage`, `createUserMessage(input)`, `createSystemMessage`, `createDeveloperMessage`,
`createAssistantMessage`, `createToolResultMessage` — exported from `@deepseek-ai/dsh-llm`.

### 1.6 `llm/stream` event (waterfall) — `[LIVE]`

```
name: llm/stream
mode: waterfall
signature: 'llm/stream'(this: LlmRuntime, options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk>
description: Waterfall around every streaming model call (retry, replay, routing). Bound to the LlmRuntime;
  call `next()` to reach the resolved adapter's stream, or yield your own chunks to short-circuit.
parameter options: "the full request. A LOOP-built request carries the process-local markAgentLoopRequest identity
  and arrives deep-frozen (mutation throws) ... Hand-built calls do not carry that marker; callers own their
  request inputs and must keep them unchanged until the stream settles."
```

Invariant worth respecting in the plugin `[README]`: *"Model-visible ⟺ logged — callers must keep every provider
request's model-visible input reconstructable from the session log"*. A plugin's hand-built fan-out call is a
side-channel call (like `purpose: 'session-title'` generation); do not mutate `options` after dispatch.

---

## 2. `llm` service — provider & model metadata

### 2.1 `listProviders()` verbatim `[LIVE]`

```ts
@Remote listProviders(): LlmProviderInfo[]

export interface LlmProviderInfo {
    id: string;
    name: string;
}
```
Returns *"detached provider metadata in registration order."*

### 2.2 `listModels(provider)` verbatim `[LIVE]`

```ts
async listModels(provider: string): Promise<LlmModelInfo[]>

export interface LlmModelInfo {
    provider: string;
    id: string;
    name: string;
    description?: string;
    inputModalities?: readonly ModelModality[];
}
```
Takes **one positional provider id**, returns a Promise of a flat array. *"Discover models advertised by one
registered provider. Catalog membership does not constrain core routing."*

### 2.3 Rich metadata — `resolveModelInfo` (this is the one with context window / maxTokens / reasoning)

```ts
async resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>

export interface LlmResolvedModelInfo extends LlmModelInfo {
    context?: LlmModelContext;
    defaultMaxTokens?: number;
    reasoning?: LlmModelReasoningInfo;
    systemPromptUpdate?: SystemPromptUpdate;
    toolUpdate?: ToolUpdate;
}
export interface LlmModelContext { contextWindow: number; }
export interface LlmModelReasoningInfo {
    efforts: readonly LlmReasoningEffortInfo[];
    defaultEffort?: ReasoningEffortId;
}
export interface LlmReasoningEffortInfo { id: ReasoningEffortId; name: string; description?: string; }
export type SystemPromptUpdate = 'in-history';
export type ToolUpdate = 'in-history' | 'addition-only';
export type ModelModality = ModelModalityMap[keyof ModelModalityMap];
export interface ModelModalityMap { text: 'text'; image: 'image'; }
```

If you only need to *pass through* a model selection, you do not need this; if the plugin must clamp
`maxTokens` to the model or expose reasoning efforts, use `resolveModelInfo`.

### 2.4 Active selection helper — `agentDefaultModel` `[LIVE]`

```ts
currentSelection(): ModelSelection
async saveSelection(next: ModelSelection): Promise<void>
```
`[SRC] dsh-agent-default-model/lib/index.js:6-12,38-45` shows the shape it returns:

```ts
{ provider, model, reasoningEffort? }   // reasoningEffort only when set
```
`UNVERIFIED:` the declared `ModelSelection` type text (the catalog returns only signatures). The three fields
above are read off the shipped implementation; treat `provider`/`model` as always present.

---

## 3. `tools` service

`[LIVE]` description: *"Tool registry and execution pipeline. Scoped registrations shadow globals; one
visibility resolver feeds presentation, lookup, and dispatch."*

### 3.1 Exact methods (verbatim)

```ts
presentAs(mode: ToolPresentationMode): () => void
register(definition: ToolDefinition): () => void
restrict(filter: ToolRestriction): () => void
guard(guard: ToolGuard): () => void
get(name: string, scope?: ScopeKey): ToolDefinition | undefined
schemas(scope?: ScopeKey): ToolSchema[]
executionMode(exec: ToolExecutionInput): ToolExecutionMode
async execute(exec: ToolExecutionInput): Promise<ToolExecutionResult>
```

Key semantics `[LIVE]`:

- `register` — *"Register globally or in the calling agent scope. Scoped tools shadow globals; duplicates within
  one layer and the reserved `run_code` name fail."* Returns *"the exact disposer that unregisters the tool."*
  → **a plugin at root scope registers global tools; registration is disposed with the plugin fiber.**
- `guard` — monotonic post-`tools/pre-execute` check; returning a string denies.
- `executionMode` — *"Only an exact `true` is parallel; unknown, hidden, undeclared, invalid, or throwing
  classifiers are exclusive."* (this is how `isConcurrencySafe` is consumed)
- `execute` — full pipeline; cancellation *"skips a not-yet-started body with `ABORTED_BEFORE_DISPATCH` or
  replaces a successful started outcome with `ABORTED`"*.

### 3.2 `ToolDefinition` and `ToolSchema` verbatim `[LIVE]`

```ts
export interface ToolSchema {
    deferLoading?: true;
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

export interface ToolDefinition extends ToolSchema {
    readonly output: ToolOutputDefinition;
    execute(args: unknown, exec: ToolRunContext): Promise<unknown>;
    projectContent?(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): ContentBlock[] | undefined;
    finalizeContent?(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): ContentBlock[] | undefined;
    timeoutMs?: number;
    isConcurrencySafe?(args: unknown): boolean;
    presentCall?(args: unknown): ToolCallView | undefined;
    presentResult?(args: unknown, result: ToolResult): ToolResultView | undefined;
}

export interface ToolOutputDefinition {
    readonly schema: JsonSchemaNode;
    render(args: unknown, value: JsonValue): ContentBlock[];
    presentationMeta?(args: unknown, value: JsonValue): JsonValue;
}

export type ToolPresentationMode = 'native' | 'ptc';
export interface ToolRestriction { readonly allow?: readonly string[]; readonly deny?: readonly string[]; }
export type ToolGuard = (execution: Readonly<ToolExecution>) => string | undefined;
export type ScopeKey = object;
export interface Agent { readonly id: SessionId; }   // the `agent` you get in exec
```

Note: `output` and `execute` are **required** on a `ToolDefinition`. There is no "content-only" variant —
even plain text results are declared as a value schema and rendered with `render()`.

### 3.3 `exec` — exactly what a tool body receives

```ts
export interface ToolExecutionInput {
    readonly callId: ToolCallId;
    readonly rootCallId?: ToolCallId;
    readonly name: string;
    readonly schema?: ToolSchema;
    readonly arguments: unknown;
    readonly agent?: Agent;
    readonly parent?: ToolExecutionToken;
    readonly signal: AbortSignal;
}
export interface ToolExecution extends ToolExecutionInput {
    readonly rootCallId: ToolCallId;
    readonly token: ToolExecutionToken;
}
export interface ToolRunContext extends ToolExecution {
    deferContext(context: UserMessage): void;
    concludeTurn(): void;
}
```

So `exec` contains: **`signal` (`AbortSignal`), `agent` (optional `{id: SessionId}`), `callId`,
`rootCallId`, `name`, `schema`, `arguments`, `parent`, `token`, plus `deferContext()` / `concludeTurn()`.**

- `exec.signal` is the cancellation channel — *"every tool body receives the caller-owned `exec.signal` and must
  observe it"* `[LIVE]`.
- **There is no `exec.cwd`, no `exec.session`, no `exec.toolCallId` field.** The tool call id is `exec.callId`
  (`ToolCallId`); the session id, when needed, is `exec.agent.id` (`SessionId`).
  `UNVERIFIED:` whether `exec.arguments` is the *same object* handed in as `args` (both exist; the registry
  materializes parsed arguments) — the type places it on the input record, so treat it as read-only.
- Working directory: not on `exec`. `[INFERRED]` tools that need cwd take it as a **parameter** with a
  description saying "Relative paths use your current directory; omitted inherits it" (see the shipped
  `subagent` tool below) — that is the pattern this harness uses.

Results `[LIVE]`:

```ts
export type ToolExecutionResult = ToolExecutionSuccess | ToolExecutionFailure;
export interface ToolExecutionSuccess {
    readonly isError: false;
    readonly value: JsonValue;
    readonly content: ContentBlock[];
    readonly error?: never;
    readonly meta?: JsonValue;
    readonly additionalContexts?: UserMessage[];
    readonly concludesTurn?: true;
}
export interface ToolExecutionFailure {
    readonly isError: true;
    readonly error: ToolFailure;
    readonly value?: never;
    readonly content: ContentBlock[];
    readonly meta?: JsonValue;
    readonly additionalContexts?: UserMessage[];
    readonly concludesTurn?: never;
}
export interface ToolResult { content: ContentBlock[]; isError: boolean; meta?: JsonValue; }
export interface ToolFailure { message: string; info?: ToolErrorInfo; }
export interface ToolErrorInfo { name: string; code: string; reason?: string; }
```

**Your `execute()` returns the plain JSON value** (`unknown`, validated against `output.schema`);
throwing produces a structured error result without ending the turn (`[README]`: *"return finalized results
without ending a turn on ordinary tool failures"*).

### 3.4 `tools/*` events `[LIVE]`

```
'tools/change'(): void                                                        # emit
'tools/pre-execute'(this: Scoped<ToolRuntime>, exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision>   # waterfall
'tools/execute'(this: Scoped<ToolRuntime>, exec: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult>  # waterfall
'tools/post-execute'(this: Scoped<ToolRuntime>, exec: ToolExecution, result: Readonly<ToolExecutionResult>, next: () => Promise<PostToolDecision>): Promise<PostToolDecision>   # waterfall
'tools/result'(this: Scoped<ToolRuntime>, exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): undefined             # emit
'tools/ptc-dispatch-log'(this: Scoped<ToolRuntime>, dispatch: PtcDispatchLog, next: () => Promise<ContentBlock[]>): Promise<ContentBlock[]>
```

Pipeline order `[README]`: `tools/pre-execute` → guards → `tools/execute` → `tools/post-execute` →
`finalizeContent` → `tools/result`. **A plain tool plugin needs none of these.**

---

## 4. `parameters` / `output.schema` dialect — definitively answered

Two different dialects exist. **They are not interchangeable.**

### 4.1 `defineTool({ parameters })` and `defineTool({ output: { schema } })` use the *author DSL* (`ValueSchemaSpec` / `ParameterSchemaSpec`)

`[SRC] dsh-tools/lib/index.js:601-616, 655-752` — the compiler. `required` is **a per-property boolean, never an array**:

```js
if (Object.hasOwn(task.property, "required") && task.property.required !== true)
    authorError(`${task.path}.required must be true when present`);
if (Object.hasOwn(task.property, "required") && task.property.required === true) task.required.push(task.key);
```

So `dsh-blender`'s `required: true` inside a property object is **correct and is the only accepted spelling**;
`required: ["a","b"]` at any node is *not* accepted (a raw `required` array is a different dialect, §4.2).

Accepted shapes, exhaustively (the compiler rejects every other key — verbatim messages quoted):

| node | allowed keys (besides annotations `description`, `title`, `default`, `examples`) |
|---|---|
| any property of `parameters` / of a nested `properties` map | `type` **or** `oneOf`, plus `required: true` (property level only) |
| `type: 'json'` | `type` only → compiles to annotation-only (unconstrained JSON) |
| `type: 'object'` | `type`, `properties`, **`additionalProperties` (required, must be a boolean)** |
| `type: 'array'` | `type`, `items` |
| `type: 'string' \| 'number' \| 'integer' \| 'boolean' \| 'null'` | `type`, `enum`, `const` |
| `oneOf` | `oneOf` (≥ 2 branches) and **not** `type` |

Verbatim author errors (these are what you will see at load time):

```
`${path}.${key} is not supported by the value schema DSL`
`${path}.required must be true when present`
`${path} must be a value schema object`
`${path} is circular`
`${path} cannot declare both type and oneOf`
`${path}.oneOf must be an array of at least two value schemas`
`${path}.additionalProperties must be explicitly true or false`
`${path}.enum must be a non-empty array of scalar values`
`${path}.type must be string/number/integer/boolean/null/array/object/json, or use oneOf`
`${path} must be an object of value schemas`
```

Consequences to code against:

- A node **must** declare `type` (or `oneOf`); `{}` is an error.
- Every `type: 'object'` node **must** carry `additionalProperties: false` (or `true`). Omitting it is a load-time error.
- `required: true` is legal at property level including inside nested `properties` maps
  (`[SRC] index.js:609` sets `allowRequired: true` for property nodes), but **not** on the root node itself
  (`compileValueSchema` passes `allowRequired: false`).
- `parameters` itself is a map `{ propName: <node>, ... }`; `defineTool` compiles it to
  `{ type: 'object', properties: {...}, required: [...] }` `[SRC] index.js:802-811`.
- Idiomatic example, copied from the shipped `subagent` tool `[SRC] dsh-tool-subagent/lib/index.js:385-440`:

```js
parameters: {
  cwd:         { type: "string", description: "..." },
  description: { type: "string", required: true, description: "..." },
  prompt:      { type: "string", required: true, description: "..." },
  agent_preset:{ type: "string", enum: [...presets.choices], description: "..." },
},
output: {
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      kind:       { type: "string", required: true, const: "activation" },
      subagentId: { type: "string", required: true },
    },
  },
  render: (_args, value) => [{ type: "text", text: `started subagent ${value.subagentId}` }],
},
```

### 4.2 Raw JSON Schema (`JsonSchemaNode`) — the wire form, only for `ToolSchema.parameters` handed to `ctx.llm.stream` / subagents / MCP

`[SRC] dsh-tools/lib/index.js:196-207` — the assertion, verbatim (the message enumerates the whole subset):

```
`${path}.${key} is not a supported keyword (subset: type/oneOf/properties/required/additionalProperties/items/enum/const + annotations)`
```

```ts
export interface JsonSchemaNode {
    type?: JsonSchemaType;
    oneOf?: JsonSchemaNode[];
    properties?: Record<string, JsonSchemaNode>;
    required?: string[];                 // <- array form ONLY here
    additionalProperties?: boolean;
    items?: JsonSchemaNode;
    enum?: JsonSchemaScalar[];
    const?: JsonSchemaScalar;
    description?: string;
    title?: string;
    default?: JsonValue;
    examples?: JsonValue;
}
export type JsonSchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
export type JsonSchemaScalar = string | number | boolean | null;
```

Extra raw-subset rules `[SRC index.js:208-260]`: `description`/`title` must be strings; `type` must be a single
string (type arrays rejected); `type` + `oneOf` together rejected; per-type keyword legality
(`properties`/`required`/`additionalProperties` only on `object`, `items` only on `array`,
`enum`/`const` only on scalars). Annotation-only (`{}`) is accepted *by the raw assertion* but **not** by the
`defineTool` DSL compiler.

**Practical rule for this plugin:** write tools with `defineTool` (§4.1). Only reach for the raw dialect if you
are passing `tools?: ToolSchema[]` into `ctx.llm.stream` — and then `parameterSchemaSpecToJsonSchema` /
`valueSchemaSpecToJsonSchema` are exported from `@deepseek-ai/dsh-tools` to convert for you (`[SRC] index.js:3810` export list).

---

## 5. Plugin module contract

### 5.1 The exact module shape (verified on two shipped tool plugins)

`[SRC] dsh-tool-subagent/lib/index.js:303-324,354,615`:

```js
const name = "tool-subagent";
const inject = ["tools", "subagents", "systemPrompt", "sessionProjections"];
const Config = z.object({
	provider: z.string().required(),
	toolName: z.string().default("subagent"),
	modelSelectionSettings: z.boolean().default(false),
	agentOptions: z.object({ /* … */ }).default(void 0),
	agentPreset: z.string().min(1),
	allowedAgentPresets: z.array(z.string().min(1)).min(1).default(void 0),
	maxDepth: z.union([z.natural().max(Number.MAX_SAFE_INTEGER), z.const("provider-managed")])
});
async function apply(ctx, config, session) { /* … */ }
export { Config, apply, inject, name };
```

`[SRC] dsh-experimental-tool-agent-team/lib/index.js:7-20,556`:

```js
const name = "tool-agent-team";
const inject = ["agents", "agentTeams", "tools", "systemPrompt"];
const Config = z.object({
	interrupt: z.boolean().default(true),
	freshProvider: z.string().default("spawn"),
	forkProvider: z.string().default("fork")
});
export { Config, apply, inject, name };
```

So the contract is **named ESM exports** (a `package.json` with `"type": "module"`):

| export | required | meaning |
|---|---|---|
| `name` | yes (shipped plugins all have it) | Cordis plugin name (string) |
| `inject` | yes when using services | array of **service keys**; `apply` runs only once all are mounted, and `ctx.<key>` is available |
| `Config` | optional | `@deepseek-ai/schemastery` schema (`import z from '@deepseek-ai/schemastery'`) used by the Loader to validate/default the row's `config` |
| `apply(ctx, config, session?)` | yes | plugin body; may be `async`. `session` is only passed by direct Agent setup, not standing composition `[SRC] JSDoc @param session` |

Import paths that exist in the installed harness:

```js
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
// types only: import type { … } from '@deepseek-ai/dsh-llm'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'   // runtime value export
```

### 5.2 How row `config` reaches `apply`

- The Loader row carries `config:`. The Cordis Loader validates it against the module's `Config` (schemastery
  schema) — that is what the live `Config` inspect provider projects (`$schema: draft 2020-12`, `default: {}`,
  `required: ["provider","model"]` for the default-model row) `[LIVE]`.
- `apply` therefore receives an **already-validated, default-applied plain object**: shipped code reads
  `config.provider` (string), `config.toolName ?? "subagent"`, `config.maxDepth !== "provider-managed"`,
  `config.agentOptions` `[SRC]`. It is *not* a refs object — the refs form (`this.config.provider.get()`) is
  only for the **Service class** variant (`static Config = z.object(...)`, `dsh-agent-default-model`) `[SRC]`.
- A matching patch override **replaces the complete `config`**, it does not merge:
  *"a matching override replaces the complete `config`"* `[SRC] dsh-agent-preset/skills/cordis-plugin-development/references/host-plugin.md:3`.
- `!!js` scalars in YAML become `{__jsExpr: "<source>"}` and are *"evaluated and validated only at runtime"*
  `[LIVE] Config provider projection, $defs.loaderExpression`.
- `UNVERIFIED:` behavior when a plugin exports **no** `Config` but its row carries `config` — not tested;
  assume the object is passed through unvalidated and do not rely on defaults.

### 5.3 Bundle/patch row forms observed live

`[SRC]` live `~/.dsh/profiles/desktop/cordis.patch.yml` (id-targeted override):

```yaml
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: deepseek-official
    model: deepseek-flash
    reasoningEffort: high
```

`[SRC]` live `~/.dsh/cordis.patch.yml` (insert form):

```yaml
- insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: rea
        transport: stdio
        command: C:\Program Files\nodejs\node.exe
        args: [ 'C:\Users\admin\AppData\Roaming\npm\node_modules\rea-agents\scripts\rea.mjs', 'mcp' ]
```

`[SRC]` bundle manifest requirement (`host-plugin.md:3,11-27`):

```json
{
  "name": "@local/my-plugin",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./index.js" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

> `--patch` / profile-patch mechanics and the proof of a live boot are **out of scope for this file** — see
> `docs/runtime-install.md` (owned by the runtime teammate). The row forms above are evidence, not a
> recommendation about where to mount.

---

## 6. Minimal working plugin + tool (copy-paste ready)

One file `index.js`. Registers one tool that calls `ctx.llm.stream()` exactly once, collects `text-delta`
chunks into a string, and returns `{ text }`. Every API used here is quoted above.

```js
// index.js — Host plugin: one tool that fans one prompt out to an explicit provider/model.
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'multi-model-probe'
export const inject = ['llm', 'tools']

export function apply(ctx, config) {
  ctx.tools.register(defineTool({
    name: 'ask_model',
    description:
      'Ask one explicitly chosen model one question and return the visible text reply. ' +
      'Use when a second opinion from another model is needed.',
    parameters: {
      provider: {
        type: 'string',
        required: true,
        description: 'LLM provider route, e.g. "deepseek-official".',
      },
      model: {
        type: 'string',
        required: true,
        description: 'Model id interpreted by that provider, e.g. "deepseek-flash".',
      },
      prompt: {
        type: 'string',
        required: true,
        description: 'The complete question for that model.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      let text = ''
      let finish
      for await (const chunk of ctx.llm.stream({
        provider: args.provider,
        model: args.model,
        messages: [{ role: 'user', content: [{ type: 'text', text: args.prompt }] }],
        signal: exec.signal,                     // cancellation flows from the tool call
      })) {
        if (chunk.type === 'text-delta') text += chunk.text
        else if (chunk.type === 'finish') finish = chunk.reason
      }
      if (finish === undefined) throw new Error('model stream ended without a finish chunk')
      if (finish.kind === 'error' || finish.kind === 'aborted') {
        throw new Error(`${finish.kind}: ${finish.failure.code}: ${finish.failure.message}`)
      }
      return { text }
    },
  }))
}
```

Companion `package.json` (bundle form, from §5.3):

```json
{
  "name": "@local/multi-model-probe",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./index.js" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

With `cordis.patch.yml`:

```yaml
- insert:
    - id: multi-model-probe
      name: '@local/multi-model-probe'
      config: {}
```

Making it configurable instead of hard-coded (the `Config` route, §5.2):

```js
import z from '@deepseek-ai/schemastery'
export const Config = z.object({
  provider: z.string().required(),
  model: z.string().required(),
})
export function apply(ctx, config) { /* config.provider, config.model are plain strings */ }
```

---

## 7. Open questions / UNVERIFIED (do not build on these without a test)

1. `UNVERIFIED:` `exec.arguments` identity vs the first `execute(args)` parameter (both exist in the type).
2. `UNVERIFIED:` whether a plugin row's `config` is passed unvalidated when the module exports **no** `Config`.
3. `UNVERIFIED:` `ModelSelection` declared type text; only `{provider, model, reasoningEffort?}` is proven from the
   shipped implementation of `agentDefaultModel.currentSelection()`.
4. `UNVERIFIED:` the live `session`/`sessions` service key and its API (not needed for `llm`+`tools`; query the
   no-input `listService` catalog if the plugin must write into the session).
5. `UNVERIFIED:` cost/telemetry effect of a plugin-originated `ctx.llm.stream()` call without a `purpose`
   (`purpose` only allows `'compaction' | 'session-title'`, so ordinary plugin calls must omit it).
6. `UNVERIFIED:` whether `ctx.llm` is available to a **root-scope** plugin before the first agent exists —
   `inject: ['llm']` is the stated mechanism, but ordering was not observed at boot.
