# Acceptance evidence — `multi_model_run` against a real Harness

What was actually run, on this machine, with real provider calls. Every block below is
copied from a captured transcript under `verify/evidence/`. Procedure and mechanics live in
[`runtime-install.md`](runtime-install.md); API contracts live in [`api-contracts.md`](api-contracts.md).

- Harness: dsh `0.2.1` — CLI `0.2.1-rc.2` (`@deepseek-ai/dsh/lib/bin.js`), desktop packaged runtime `0.2.1-rc.3`
- Profile: scratch `mmcollab` created from the shipped `headless` template (the live `desktop` profile was never touched)
- Plugin mount: `--patch .\cordis.patch.yml` → row `name: ./lib/index.js`, rewritten by the Loader to
  `file:///D:/deepseek%20harness/.../lib/index.js`
- Models: `deepseek-official/deepseek-flash` (DeepSeek-V4.1-Flash) and `deepseek-official/deepseek-v4-pro` (DeepSeek-V4-Pro)
- Command shape (all four runs):

```powershell
$bin = "C:\Users\admin\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\lib\bin.js"
node $bin --profile mmcollab `
  --patch ".\verify\patch-forms\enable-credentials.yml" `
  --patch ".\cordis.patch.yml" `
  --json "<prompt>"
```

`enable-credentials.yml` re-enables the `credentials` row that the headless template leaves disabled.
`--json` matters: without machine-readable events, a plugin row that silently failed to activate still
exits 0 — so the assertions below are on `tool_call` / `tool_result`, never on the exit code.

One command re-runs all four (`npm run e2e`): **4/4 scenarios passed**, 30 s / 24 s / 34 s / 37 s.

---

## 1. `parallel` — both models answer, call succeeds

`verify/evidence/e2e-json.stdout.txt`

```json
{"type":"tool_call","callId":"call_00_ET_Wn2HWHappeFfNkpUi5DW8948","tool":"multi_model_run","input":{"task":"Reply with exactly the single word PONG and nothing else."}}
```

```text
## multi_model_run — parallel / all
**models**: deepseek-official/deepseek-flash, deepseek-official/deepseek-v4-pro — 2 succeeded, 0 failed

### deepseek-official/deepseek-flash — ok (950ms, 4 chars)
PONG

### deepseek-official/deepseek-v4-pro — ok (1529ms, 4 chars)
PONG

## aggregate
mode=parallel aggregate=all models=2 ok=2 failed=0 elapsed=2258ms
- OK   deepseek-official/deepseek-flash [peer] 4 chars, 645ms, tokens 42→15
- OK   deepseek-official/deepseek-v4-pro [peer] 4 chars, 2257ms, tokens 95→34
- pick: none — aggregate=all returns every answer verbatim
```

`tool_result.status` = `completed`.

## 2. Partial failure — one broken model is reported, the call still succeeds

The requirement: *"某个模型调用失败时，不应让整个工具调用失败。记录该模型的错误"*.
Here `deepseek-official/not-a-real-model` really is rejected by the provider.

`verify/evidence/e2e-json-failure.stdout.txt`

```json
{"type":"tool_call","callId":"call_00_KVDnIL82kNkdQ6EP0h0v9015","tool":"multi_model_run","input":{"task":"Name the capital of France in one word.","models":["deepseek-official/deepseek-flash","deepseek-official/not-a-real-model"]}}
```

```text
**models**: deepseek-official/deepseek-flash, deepseek-official/not-a-real-model — 1 succeeded, 1 failed

### deepseek-official/deepseek-flash — ok (756ms, 5 chars)
Paris

### deepseek-official/not-a-real-model — FAILED (338ms)
INVALID_REQUEST: The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed not-a-real-model. (request_id: f8c4b45f-…)

## aggregate
mode=parallel aggregate=all models=2 ok=1 failed=1 elapsed=757ms
- OK   deepseek-official/deepseek-flash [peer] 5 chars, 756ms, tokens 39→18
- FAIL deepseek-official/not-a-real-model [peer] INVALID_REQUEST: …
```

`tool_result.status` = `completed` — one model's failure did **not** fail the tool call, and its
provider error code/message travelled with the result.

## 3. `primary_secondary` — the second model reviews the first model's draft

`verify/evidence/e2e-json-primary-secondary.stdout.txt`

```json
{"type":"tool_call","callId":"call_00_ET_Afz54RZWhQTrhwe8syM60491","tool":"multi_model_run","input":{"task":"Name the capital of France in one word.","mode":"primary_secondary"}}
```

```text
### deepseek-official/deepseek-flash — ok (834ms, 5 chars)
Paris

### deepseek-official/deepseek-v4-pro — ok (3589ms, 34 chars)
草稿完全正确，无事实性错误、遗漏或推理跳跃。

最终答案：Paris

## aggregate
mode=primary_secondary aggregate=all models=2 ok=2 failed=0 elapsed=4425ms
- OK   deepseek-official/deepseek-flash [primary] 5 chars, 834ms, tokens 39→18
- OK   deepseek-official/deepseek-v4-pro [secondary] 34 chars, 3589ms, tokens 187→186
- note: the first model drafted the answer; the others reviewed and completed that draft, …
```

The secondary's reply is a review of the draft ("草稿完全正确…"), not an independent answer —
proving the draft + `secondaryInstruction` really reached the second model.

## 4. Every model fails — the tool call itself is an error (`isError`)

`verify/evidence/e2e-json-allfail.stdout.txt`

```json
{"type":"tool_call","callId":"call_00_ET_uVel7jdF9eVgxEWbZ8os7920","tool":"multi_model_run","input":{"task":"Say hi.","models":["deepseek-official/no-such-model-a","deepseek-official/no-such-model-b"]}}
{"type":"tool_result","callId":"call_00_ET_uVel7jdF9eVgxEWbZ8os7920","status":"error","result":"Error: multi_model_run: every model failed (2/2) — deepseek-official/no-such-model-a: INVALID_REQUEST …; deepseek-official/no-such-model-b: INVALID_REQUEST …"}
```

`status` = `"error"` — the Harness turns the throw into `isError`, and the message aggregates every
model's own failure code.

---

## 5. Installed as a profile bundle (`dsh.bundle.patch` honored), no `--patch` row

The other delivery path — `package.json` → `dsh.bundle.patch` — was verified the same way, in the
same scratch profile:

```powershell
node $bin plugin --profile mmcollab add "D:\deepseek harness\任务13_多模型插件"
# → dependencies: + dsh-multi-model-collab 0.1.0 <- D:\deepseek harness\...   (pnpm link)
# → profiles/mmcollab/package.json dsh.profile.bundles gains "dsh-multi-model-collab"
```

`--dump-config` then composes the row **from the package's own patch file**, with its config applied:

```text
# == dsh-multi-model-collab
- id: multi-model-collab
  name: >-
    file:///C:/Users/admin/.dsh/profiles/mmcollab/node_modules/dsh-multi-model-collab/lib/index.js
  config:
    models:
      - deepseek-official/deepseek-flash
      - deepseek-official/deepseek-v4-pro
    …
```

A real turn **without** the plugin patch (only the credentials overlay) still calls the tool:
`verify/evidence/e2e-installed-bundle.stdout.txt` →

```json
{"type":"tool_call","tool":"multi_model_run","input":{"task":"Reply with exactly the single word PONG and nothing else."}}
{"type":"tool_result","status":"completed","result":"… 2 succeeded, 0 failed … PONG … PONG …"}
```

The package was then removed again (`dsh plugin --profile mmcollab remove dsh-multi-model-collab`),
leaving the scratch profile exactly as the template created it.

## 6. Web UI (real browser, `dsh web --patch`)

Verified separately with a headless Chrome driving the real Web UI — screenshots and the captured
transcript are in [`web-ui-verification.md`](web-ui-verification.md).

## 7. Offline behaviour suite (no network)

`npm test` → **21/21 passed**. Covers, with a fake `ctx.llm`: plugin contract, `defineTool` schema
compilation, parallel execution, per-model failure isolation (thrown error / `finish{kind:error}`),
all-fail rejection, `vote` majority and its longest-answer fallback, `longest`, `primary_secondary`
prompt construction and primary-failure degradation, model-reference resolution (explicit
`provider/model`, `defaultProvider`, catalogue lookup, unresolvable reference message), text clipping,
`exec.signal` cancellation before dispatch and in flight, missing terminal chunk, empty task,
and `normalizeConfig` defaults.

## 8. What these runs do not cover

- **Web UI rendering** was verified separately — see [`web-ui-verification.md`](web-ui-verification.md).
- Cross-provider fan-out (two different providers) is supported by the same code path but only
  same-provider routes exist in this profile, so it was exercised with two models of one provider.
- `plugin_manager install_bundle` (the agent-facing tool) is approval-gated in this session and was
  not run; the equivalent CLI route `dsh plugin --profile <p> add <dir>` **was** run and is recorded
  in §5 above.
- Token/cost accounting of these calls is not attributed to the session log (documented in the
  README's known limitations).
