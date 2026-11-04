# Runtime install & end-to-end proof: workspace bundle → `dsh --patch` → live agent tool call

Status: **proven by running it**, on this machine, against the installed harness.
Every claim below is tagged:

- `[RUN]` — observed in a real boot/agent turn; the transcript or log file is named.
- `[SRC]` — copied from the shipped source (extracted out of `app.asar` into `verify/ref/`, or the installed
  package in `C:\Users\admin\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\...`).
- `[DOC]` — copied from a shipped package README.
- `UNVERIFIED:` — could not be proven here; says exactly what was and was not checked.

Environment this was recorded against (2026-10-25):

| fact | value |
|---|---|
| global CLI | `@deepseek-ai/dsh` **0.2.1-rc.2** at `C:\Users\admin\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\lib\bin.js` `[RUN]` |
| packaged harness | `app.asar` **0.2.1-rc.3** at `D:\Program Files (x86)\deepseek harness\resources\app.asar` `[RUN]` |
| `DSH_HOME` | `C:\Users\admin\.dsh` |
| scratch profile used | `mmtest` (created for this task; the real `desktop` profile was never booted or edited) |
| default model row | `provider: deepseek-official`, `model: deepseek-flash` (`- id: agent-default-model`) `[RUN --dump-config]` |
| shell | PowerShell 7 on Windows; **`.ps1` execution is blocked**, so every command below is an inline `node ...` invocation, and reusable logic is a Node script (`verify/run-smoke.mjs`). |

---

## 0. TL;DR — the two things that actually matter

**(a) The patch row form that resolves a workspace bundle** (insert row, `name` = **entry file**, relative with `./`
or absolute). Placed in `verify/hello-bundle/cordis.patch.yml` and applied with `--patch`:

```yaml
- insert:
    - id: hello-bundle
      name: ./index.js
```

The loader rewrites that to an absolute `file:///.../verify/hello-bundle/index.js` URL **anchored beside the patch
file** before mounting it `[SRC dispatch anchorInsertedPluginNames, verify/ref/boot/.../dsh-app-boot/lib/index.js:3970-3979]`.

**(b) The exact working command line** (real agent turn, real tool call):

```powershell
$env:DSH_HOME = "C:\Users\admin\.dsh"
node "C:\Users\admin\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\lib\bin.js" `
  --profile mmtest `
  --patch "verify\patch-forms\enable-credentials.yml" `
  --patch "verify\hello-bundle\cordis.patch.yml" `
  --json "Call the hello_probe tool with note=`"ping-123`" and then print the tool's exact output as your final answer."
```

and the `--json` stream proves the call:

```json
{"type":"tool_call","callId":"call_00_ET_...","tool":"hello_probe","input":{"note":"ping-123"}}
{"type":"tool_result","callId":"call_00_ET_...","status":"completed",
 "result":"{\"sentinel\":\"HELLO_FROM_PATCH_BUNDLE_9f3c2\",\"note\":\"ping-123\",\"pid\":3344,\"plugin\":\"dsh-hello-bundle\"}"}
{"type":"final","text":"{\"sentinel\":\"HELLO_FROM_PATCH_BUNDLE_9f3c2\",\"note\":\"ping-123\",\"pid\":3344,\"plugin\":\"dsh-hello-bundle\"}"}
```

`[RUN] verify/evidence/smoke2-json.stdout.txt`, exit code 0, model `deepseek-flash` (one real provider round trip).

Two gotchas that cost the most time here, both solved in `verify/`:

1. A **directory** URL cannot be mounted — the row must name the **entry file** (`./index.js`, not `./`).
2. The shipped `headless` profile template has **no credentials service** (dsh-base ships that row `disabled: true`),
   so every model turn dies with `MISSING_CREDENTIAL` until you re-enable it with one override overlay
   (`verify/patch-forms/enable-credentials.yml`). See §7.

---

## 1. How a profile is composed (and where `--patch` sits)

`[SRC] verify/ref/cli/dsh/node_modules/@deepseek-ai/dsh/lib/profile-boot-C14i-8IN.js:224-247` — the effective patch
stack for `dsh --profile <name> --patch <file>` is, in this order:

1. one layer per bundle listed in the profile's `package.json` → `dsh.profile.bundles` (in order);
2. the profile's own `cordis.patch.yml`;
3. `$DSH_HOME/cordis.patch.yml` (machine-local layer, **outranks** the profile layer);
4. each `--patch <path>` overlay, in argv order;
5. the telemetry switch.

`--patch` paths are resolved with `resolve(file)`, i.e. **relative to the invoking working directory**, not to the
profile `[SRC verify/ref/cli/.../lib/profile-boot-C14i-8IN.js:245, lib/dump-config-CWs_HdOc.js:52-57]`.

The visible profile root is always rewritten to an empty list, because the whole tree is patch layers
`[SRC profile-boot-C14i-8IN.js:201-222]`.

Relevant row semantics `[DOC cordis-composition-reference skill]`:

- `insert: [rows]` appends rows at that level; with an `id` naming a `group: true` row, inside that group.
- A patch **with an `id` and no `insert`** targets the existing row with that id; supplied fields replace its fields,
  and `config` is replaced wholesale.
- `name` on an inserted row is a plugin specifier. Absolute / `./` / `../` names are converted to `file://` URLs
  anchored beside the patch file `[SRC dsh-app-boot/lib/index.js:3970-3979]`.

`--dump-config` renders this composition **without booting and without evaluating `!!js`**
`[SRC lib/dump-config-CWs_HdOc.js:6-28]`, so it proves *composition* but never *activation* (see §6).

---

## 2. Create the scratch profile (isolation-safe)

`--from-default-profile` replaces/creates a **custom** profile from a shipped template; shipped names are reserved
`[SRC profile-boot-C14i-8IN.js:146-160]`. Shipped templates are `acp`, `web`, `headless`, `sdk`, `sdk-minimal`
`[SRC dsh-app-boot/lib/index.js:550-557]`.

```powershell
$env:DSH_HOME = "C:\Users\admin\.dsh"
node "C:\Users\admin\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\lib\bin.js" `
  --profile mmtest --from-default-profile headless --dump-config
```

`[RUN]` result: `C:\Users\admin\.dsh\profiles\mmtest\` is created with

```
package.json   {"name":"dsh-profile-mmtest","private":true,"dependencies":{},
                "dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base","@deepseek-ai/dsh-headless"]}}}
cordis.patch.yml   (the shipped template: a commented `[]`)
cordis.yml         (empty root entry list; rewritten on every boot)
pnpm-workspace.yaml
```

Full composed tree saved as `verify/evidence/dump-config-mmtest.txt`.

Isolation facts:

- The `desktop` profile is **not** bootable from the CLI — it answers
  `error: profile "desktop" is managed exclusively by the Electron application` `[RUN]`. Nothing here touched it.
- `$DSH_HOME/cordis.patch.yml` is a **home layer that applies to every profile**, including scratch ones. On this
  machine it inserts an MCP server (`- id: rea-mcp`, stdio `rea.mjs`) `[RUN dump-config-mmtest.txt]`. Expect that
  side effect in every scratch boot; it is not part of this task's composition.
- Reset is `Remove-Item -Recurse "C:\Users\admin\.dsh\profiles\mmtest"` — no other location is written by the CLI
  except the profile directory and session logs under `$DSH_HOME/sessions`.

---

## 3. The throwaway bundle (`verify/hello-bundle/`)

Three files, deliberately **zero runtime imports**, so the mount cannot be confused with dependency resolution:

`verify/hello-bundle/package.json`
```json
{
  "name": "dsh-hello-bundle",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "index.js",
  "exports": { ".": "./index.js" },
  "dsh": { "bundle": { "patch": "cordis.patch.yml" } }
}
```

`verify/hello-bundle/cordis.patch.yml`
```yaml
# The insert row's relative name is anchored BESIDE THIS FILE, so `./index.js`
# becomes file:///<...>/verify/hello-bundle/index.js whether this layer is applied
# as a profile bundle patch or as a `dsh --patch <this file>` overlay.
- insert:
    - id: hello-bundle
      name: ./index.js
```

`verify/hello-bundle/index.js` (abridged; full file on disk)
```js
export const name = 'dsh-hello-bundle'
export const inject = ['tools']

export function apply(ctx) {
  ctx.tools.register({
    name: 'hello_probe',
    description: 'Return a fixed sentinel string plus the note you passed. ...',
    parameters: { type: 'object', properties: { note: { type: 'string' } },
                  required: ['note'], additionalProperties: false },
    output: {
      schema: { type: 'object', properties: { sentinel: {type:'string'}, note: {type:'string'},
                pid: {type:'number'}, plugin: {type:'string'} },
                required: ['sentinel','note','pid','plugin'], additionalProperties: false },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) { return { sentinel: SENTINEL, note: String(args?.note ?? ''), ... } },
  })
  // mount beacon (no agent turn needed): writes verify/hello-bundle/apply-beacon.json
}
```

Why this shape works `[SRC dsh-tools/lib/index.js:2974-2983]`: `ctx.tools.register(definition)` validates only the
*structure* — `output` must be an object with a function `output.render`, `output.schema` must be a supported raw
JSON Schema node, the name must not be reserved (`run_code`). It does **not** require the object to come from
`defineTool`. So a hand-rolled definition is a first-class tool.

The module contract is the ordinary Cordis one: a namespace whose exports are `name` / `inject` / `apply`
(the loader does `exports.default ?? exports` `[SRC cordis-plugin-loader/lib/index.js:667-673]`).

A `defineTool`-based variant with **bare imports** is `verify/import-probe/index.js`
(`import { defineTool } from '@deepseek-ai/dsh-tools'`) — proven to mount and register from a file-URL row; see §4.1.

---

## 4. Patch row form matrix — what actually resolved

**Badge:** ✅ **entry file** (`./index.js` beside the patch, or an absolute path to the file) · ❌ **directory**
(`ERR_UNSUPPORTED_DIR_IMPORT`) · ❌ **bare package name** (only resolves once the package is installed into the
profile). A relative path without a leading `./` is treated as a package name, not a path.

All rows were composed with `--dump-config` (`[RUN] verify/evidence/`), and the decisive ones were booted.
Patch files live in `verify/patch-forms/`.

| # | row `name:` | after anchoring `[SRC]` | mounts? | evidence |
|---|---|---|---|---|
| **A1** | `D:\...\verify\hello-bundle\index.js` (absolute file) | `file:///.../index.js` | ✅ yes | dump-config shows the file URL; same URL form as the smoke test |
| **A2** | `D:\...\verify\hello-bundle` (absolute **dir**) | `file:///.../hello-bundle` | ❌ **no** | `[RUN]` `hello-bundle-absdir (...): failed to import: Error [ERR_UNSUPPORTED_DIR_IMPORT]: Directory import 'D:\...\verify\hello-bundle' is not supported resolving ES modules imported from C:\Users\admin\.dsh\profiles\mmtest\ Did you mean to import "file:///.../index.js"?` (`verify/evidence/form-a2.stderr.txt`) |
| **B (canonical)** | `./index.js` beside the patch | `file:///.../index.js` | ✅ **yes** | `[RUN]` full smoke transcript, §5 |
| **B1** | `../hello-bundle/index.js` (relative to a patch elsewhere) | `file:///.../index.js` | ✅ yes | `[RUN dump-config]` resolves to the same `file:///.../hello-bundle/index.js` |
| **B2** | `hello-bundle/index.js` (**no** leading `./`) | *unchanged* → bare specifier | ❌ no | `[RUN]` `hello-bundle-barerel (hello-bundle/index.js): failed to import: Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'hello-bundle' imported from C:\Users\admin\.dsh\profiles\mmtest\` |
| **C** | `dsh-hello-bundle` (bare **package** name) | unchanged | only once the package is installed into the profile | `[RUN]` via the install route, §9 (`dsh plugin --profile mmtest add <dir>`); not tested as an extra `--patch` row |

**Rules that follow from the matrix**

1. Always point the row at the **entry file**, never at the directory (§4 A2).
2. Use `./`-relative (best: patch file sits next to the entry) or an absolute path. A relative path *without*
   `./` is a package name, not a path.
3. A bare package name is only for a **profile-installed** plugin (§9), not for a workspace directory.
4. A failed row does **not** abort the boot: the loader logs
   `dsh: warning: 1 entry did not activate` + `<id> (<name>): failed to import: ...` on stderr and continues
   `[RUN, both negative boots]`. Silent-looking success is therefore possible — always assert on the tool call, not
   on the exit code alone (`exit 1` in those runs came from `MISSING_CREDENTIAL`, not from the failed row).

### 4.1 Bare imports inside a file-URL mounted plugin (asked by the Lead)

A file-URL mounted plugin is imported by plain Node ESM: **bare specifiers resolve from the plugin file's own
directory upward. There is no harness alias for it** (the app-boot interception layer only applies to module paths
inside the profile tree `[SRC dsh-app-boot/lib/index.js:1323-1340, 1583-1595]`).

Proven with `verify/import-probe/index.js` (a copy of the bundle that does
`import { defineTool } from '@deepseek-ai/dsh-tools'` and registers a `defineTool`-built tool):

```powershell
node $bin --profile mmtest `
  --patch "verify\patch-forms\enable-credentials.yml" `
  --patch "verify\import-probe\cordis.patch.yml" `
  --patch "verify\tool-list-probe\cordis.patch.yml" "noop"     # [RUN] exit 0
```

- it **mounted**: beacon wrote `{"mounted":true}`;
- `defineTool` + `ctx.tools.register` **worked**: the registry probe (§6) lists `import_probe` among the live
  model-facing schemas;
- it resolved because the **workspace** already has `node_modules\@deepseek-ai\dsh-tools` (0.2.1-rc.3) and
  `node_modules\@deepseek-ai\schemastery` (3.18.5) `[RUN]`.

Version caveat `[RUN]`: the workspace copy is `dsh-tools` **0.2.1-rc.3** while the *global CLI's* own copy is
**0.2.1-rc.2** — two instances coexist. That is safe here because `register()` validates structurally (shape checks,
no `instanceof`), but do not pass class instances across that boundary.

---

## 5. End-to-end smoke test (the acceptance evidence)

Command (exactly as run; `verify/run-smoke.mjs` is the packaged form of it — §5.1):

```powershell
$env:DSH_HOME = "C:\Users\admin\.dsh"
node "C:\Users\admin\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\lib\bin.js" `
  --profile mmtest `
  --patch "verify\patch-forms\enable-credentials.yml" `
  --patch "verify\hello-bundle\cordis.patch.yml" `
  --json "Call the hello_probe tool with note=`"ping-123`" and then print the tool's exact output as your final answer."
```

Full `--json` transcript `[RUN] verify/evidence/smoke2-json.stdout.txt` (exit code 0, model `deepseek-flash`):

```json
{"type":"session","sessionId":"session-2f8f3e03-07c5-428d-934e-f9ff04c2bec3","cwd":"D:\\deepseek harness\\任务13_多模型插件"}
{"type":"status","phase":"turn_start","turn":1}
{"type":"status","phase":"step_start","turn":1,"step":1}
{"type":"thinking","text":""}
{"type":"tool_call","callId":"call_00_ET_tOzjaKm4o69BcaUNci5M5247","tool":"hello_probe","input":{"note":"ping-123"}}
{"type":"tool_result","callId":"call_00_ET_tOzjaKm4o69BcaUNci5M5247","status":"completed","result":"{\"sentinel\":\"HELLO_FROM_PATCH_BUNDLE_9f3c2\",\"note\":\"ping-123\",\"pid\":3344,\"plugin\":\"dsh-hello-bundle\"}"}
{"type":"status","phase":"step_end","turn":1,"step":1,"usage":{"inputTokens":249219,"outputTokens":41,"cacheReadTokens":1792,"cacheWriteTokens":0,"totalTokens":251052}}
{"type":"status","phase":"step_start","turn":1,"step":2}
{"type":"thinking","text":"Print exact output."}
{"type":"text","text":"{\"sentinel\":\"HELLO_FROM_PATCH_BUNDLE_9f3c2\",\"note\":\"ping-123\",\"pid\":3344,\"plugin\":\"dsh-hello-bundle\"}"}
{"type":"status","phase":"step_end","turn":1,"step":2,"usage":{"inputTokens":225,"outputTokens":46,"cacheReadTokens":250880,"cacheWriteTokens":0,"totalTokens":251151}}
{"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"completed"}}
{"type":"final","text":"{\"sentinel\":\"HELLO_FROM_PATCH_BUNDLE_9f3c2\",\"note\":\"ping-123\",\"pid\":3344,\"plugin\":\"dsh-hello-bundle\"}"}
```

Cross-check: the plugin's own mount beacon for that same process
`[RUN] verify/hello-bundle/apply-beacon.json`:

```json
{ "at": "2026-10-25T12:18:23.772Z", "plugin": "dsh-hello-bundle", "tool": "hello_probe",
  "sentinel": "HELLO_FROM_PATCH_BUNDLE_9f3c2", "pid": 3344 }
```

`pid` in the tool result (`3344`) equals `pid` in the beacon ⇒ the tool that the model called is the module this
patch mounted in that very process. That closes the "is it really my plugin?" gap.

### 5.1 Reusable runner

`verify/run-smoke.mjs` (Node, because `.ps1` is blocked) boots a profile, passes overlays, parses the `--json`
stream, and asserts: exit 0, `tool_call` for the expected tool, `tool_result.status == completed`, expected
substring present, no `MISSING_CREDENTIAL`. It writes a machine-readable artifact into `verify/evidence/`.

```powershell
node verify\run-smoke.mjs --patch "verify\hello-bundle\cordis.patch.yml"
# → SMOKE PASS (24.2 s), verify/evidence/smoke-mmtest-<stamp>.json
```

For the real plugin:

```powershell
node verify\run-smoke.mjs --profile mmcollab `
  --patch "cordis.patch.yml" `
  --tool multi_model_run `
  --expect "<a literal your tool returns>" `
  --task "Call multi_model_run ... and print its exact output."
```

Notes: `--expect` defaults to the hello sentinel, so **always pass your own marker** for the real plugin. Extra
`--patch` overlays are appended after the built-in credentials overlay.

---

## 6. Proving the tool is live **without** an agent turn

Three levels, cheapest first. Only the last two prove *activation/registration*; `--dump-config` does not.

1. **Composition only** — `--dump-config` shows the inserted row and its anchored `file://` URL.
   Proves the patch parsed and the name resolved; proves nothing about `import`/`apply` success.
   `[RUN verify/evidence/dump-config-mmtest.txt]`
2. **Mount beacon** — the plugin writes `apply-beacon.json` from `apply()`. If the file appears (with a fresh
   timestamp/pid), the module was imported and `apply()` ran, with **no model call at all**.
   `[RUN]` written on every successful boot; absent in both negative boots.
3. **Registry probe** — `verify/tool-list-probe/index.js` injects `tools`, waits 400 ms, then dumps
   `ctx.tools.schemas()` (the model-facing projection) plus `ctx.llm.listProviders()` to
   `verify/tool-list-probe/tool-list.json`:

```powershell
node $bin --profile mmtest `
  --patch "verify\patch-forms\enable-credentials.yml" `
  --patch "verify\hello-bundle\cordis.patch.yml" `
  --patch "verify\tool-list-probe\cordis.patch.yml" "noop"
```

`[RUN] verify/tool-list-probe/tool-list.json` (abridged):

```json
{ "schemas": [ { "name": "hello_probe", "descriptionLength": 142, "parameterKeys": ["note"] },
               { "name": "read", ... }, ... ],
  "hasHelloProbe": true,
  "llmService": true,
  "providers": [ { "id": "deepseek-official", "name": "DeepSeek" },
                 { "id": "deepseek-account", "name": "DeepSeek Account" } ] }
```

This is the strongest no-turn check available without the (approval-gated) `plugin_manager`/inspect surface:
it reads the same registry the model sees, from inside the booted harness.

`UNVERIFIED:` no **documented** CLI flag prints a profile's tool list without booting it — `dsh --help` lists only
`--dump-config`, `--dump-config-schema`, `--dump-default-config`, and those render entry/config trees only
(`--dump-config-schema` evaluates/loads entries to build a config schema, but it does not print the tool registry;
not exercised further here). The live GUI *does* have
`cordis_inspect_query` (`Tool` / `Service` providers), but that reflects the running Desktop profile, not a
scratch one.

---

## 7. Credentials: why a headless-template profile cannot talk to the model

Without the overlay, every real turn ends like this `[RUN] verify/evidence/smoke-json.stderr.txt`:

```
dsh: MISSING_CREDENTIAL: llm-deepseek: no API key for provider route "deepseek-official";
store DEEPSEEK_API_KEY through the credentials service (the web Models page writes it),
or export DEEPSEEK_API_KEY in the launching environment
```

Cause `[RUN dump-config + probe]`: `dsh-base` ships the credential provider row **disabled** —

```yaml
- id: credentials
  name: '@deepseek-ai/dsh-credentials-local'
  disabled: true
```

— and the `web` / `desktop` app layers are what re-enable it. The `headless` template is
`dsh-base + dsh-headless`, so no `credentials` service exists at all; a probe row then reports
`pending (waiting for service: credentials)` `[RUN verify/evidence/credprobe.stderr.txt]`.

Fix (shipped in `verify/patch-forms/enable-credentials.yml`, an id-targeted override — no insert needed):

```yaml
- id: credentials
  disabled: false
```

After that overlay, on this machine:

- `ctx.get('credentials')` exists; `describe('DEEPSEEK_API_KEY')` → `{ configured: true, source: "file" }` `[RUN probe]`;
- the provider authenticates and `deepseek-flash` answers (exit 0) `[RUN §5]`.

Storage facts (metadata only — **values were never read, printed, or copied** by this work):

- store: `$DSH_HOME/.credentials.yaml`;
- shape: `{ version, records: { "<scope>/<id>": { kind: "api-key" | "grant", ... } }, refs: { "<REF>": "<record key>" } }`
  `[RUN structural dump with values redacted, verify/cred-shape.cjs]`;
- on this machine `refs.DEEPSEEK_API_KEY` exists and the three records are `grant` records
  (`client-connection/browser-session`, `deepseek-account-platform/device`, `deepseek-account-platform/default`)
  `[RUN probe listRecords()]`.

If a session ever needs the value itself, read it **inside** a process and pass it to the provider — never echo it.
For a scratch acceptance run the overlay above is sufficient; no secret handling is required.

---

## 8. Provider / model ids actually available at runtime

| what | value | how |
|---|---|---|
| default model row | `provider: deepseek-official`, `model: deepseek-flash` | `[RUN] --dump-config`, `- id: agent-default-model` |
| provider routes composed | `deepseek-official` (`@deepseek-ai/dsh-llm-deepseek-api-key`), `deepseek-account` (`@deepseek-ai/dsh-llm-deepseek-account`), plus `@deepseek-ai/dsh-llm-pi-ai` | `[RUN] --dump-config` |
| live registry answer | `[{ "id": "deepseek-official", "name": "DeepSeek" }, { "id": "deepseek-account", "name": "DeepSeek Account" }]` | `[RUN] ctx.llm.listProviders()` via the tool-list probe |
| the model that actually served the smoke turn | `deepseek-flash` (`deepseek-official`), usage `inputTokens 249219 / outputTokens 41` on step 1 | `[RUN] --json status.step_end.usage` |

`UNVERIFIED:` per-provider `listModels()` output (context window / max tokens metadata) is not recorded here; the
plugin does not need it for a smoke test, and querying it needs a credential-bearing live call.

---

## 9. Alternative route: install the bundle into the profile (verified)

If the plugin must be reachable by **package name** (or by `plugin_manager`), install it instead of patching.
Verified sequence:

```powershell
node $bin plugin --profile mmtest add "D:\deepseek harness\任务13_多模型插件\verify\hello-bundle"
```

`[RUN] verify/evidence/plugin-add.stdout.txt`, exit 0, ~600 ms with pnpm 11.28.5:

```
dependencies:
+ dsh-hello-bundle 0.0.1 <- D:\deepseek harness\任务13_多模型插件\verify\hello-bundle   (pnpm: Already up to date / Done)
```

Effects `[RUN]`:

- profile `package.json` gains `"dependencies": { "dsh-hello-bundle": "link:<abs dir>" }` **and**
  appends `"dsh-hello-bundle"` to `dsh.profile.bundles`;
- `profiles/mmtest/node_modules/dsh-hello-bundle` is a directory junction to the workspace directory;
- the bundle's own `dsh.bundle.patch` (`cordis.patch.yml`) becomes a profile layer, so the tool mounts **without**
  any `--patch`:

```powershell
node $bin --profile mmtest --patch "verify\patch-forms\enable-credentials.yml" --json "Call the hello_probe tool ..."
# [RUN] tool_call hello_probe {note:"via-installed-bundle"} → status completed → exit 0
```

Notes / limits:

- It needs `pnpm` on PATH (present here) but **no registry access** for a local directory with no dependencies
  (`link:`), so it works offline.
- It **mutates** the profile (`package.json` + `node_modules`). Restore with
  `Copy-Item verify/evidence/mmtest-package.json.before <profile>\package.json -Force` and delete the
  `node_modules\<pkg>` junction — that is exactly how `mmtest` was returned to its pre-install state.
- Even as a profile bundle, the inserted row in this bundle is `./index.js`, i.e. the plugin is still imported from
  the **workspace** path via a `file://` URL — installing only makes the *bundle layer* known.
- `plugin_manager` `install_bundle` is the approval-gated equivalent; **not exercised here** (approvals are disabled
  in this session) — `UNVERIFIED:` its exact behaviour in this environment.

---

## 10. Failure modes seen, and the fix

| symptom | cause | fix |
|---|---|---|
| `error: profile "desktop" is managed exclusively by the Electron application` | the CLI refuses the Desktop-owned profile | use a custom profile (`--from-default-profile headless`) |
| `MISSING_CREDENTIAL: llm-deepseek: no API key for provider route "deepseek-official"` | headless template has the `credentials` row disabled | add `- id: credentials / disabled: false` overlay (§7) |
| `warning: 1 entry did not activate` + `failed to import: ERR_UNSUPPORTED_DIR_IMPORT` | row names a directory | point at the entry **file** (`./index.js`) |
| `failed to import: ERR_MODULE_NOT_FOUND: Cannot find package 'x'` | relative name without `./`, or a bare package name that is not installed into the profile | use `./` / absolute path, or install the bundle (§9) |
| `failed to import: ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/dsh-tools'` | the plugin's own imports cannot resolve from its directory | put the plugin where `node_modules` is reachable upward (workspace root behaves; `verify/` also worked because it walks up to the repo root), or install the bundle into the profile |
| `pending (waiting for service: credentials)` | the row injects a service this profile does not compose | enable that service row, or drop the dependency |
| tool silently absent, boot looks fine | row failed but the runner continued (only a stderr warning) | assert on `--json` `tool_call` / `tool_result`, or use the beacon / registry probe (§6) |
| `--dump-config` shows the row but nothing happens at runtime | dump is composition-only | boot and check level 2/3 evidence |

---

## 11. Copy-paste final acceptance procedure for `dsh-multi-model-collab`

Preconditions (verified for this workspace `[RUN]`):

- repo root has `node_modules` containing `@deepseek-ai/dsh-tools` (0.2.1-rc.3) and `@deepseek-ai/schemastery`
  (3.18.5) — a file-URL mounted plugin resolves its own imports from there;
- the plugin package is ESM with the entry file at `lib/index.js` (adjust the row if it differs);
- repo-root `cordis.patch.yml` (Lead's file) contains exactly this row form — the plugin file is anchored **beside
  the repo-root patch file**:

```yaml
- insert:
    - id: multi-model-collab
      name: ./lib/index.js
```

Steps:

```powershell
# 0. one-time: variables (PowerShell)
$env:DSH_HOME = "C:\Users\admin\.dsh"
$bin = "C:\Users\admin\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\lib\bin.js"
Set-Location "D:\deepseek harness\任务13_多模型插件"

# 1. create your own scratch profile from the headless template (does NOT touch desktop)
node $bin --profile mmcollab --from-default-profile headless --dump-config

# 2. composition check: the row must appear as an absolute file:// URL
node $bin --profile mmcollab --patch "cordis.patch.yml" --dump-config |
  Select-String -Pattern 'multi-model-collab|file://'

# 3. real end-to-end turn, asserting the tool was actually called
node verify\run-smoke.mjs --profile mmcollab --patch "cordis.patch.yml" `
  --tool multi_model_run --expect "<a literal your tool returns>" `
  --task "Call the multi_model_run tool with <the arguments you want to prove> and then print its exact output."

# 4. (fallback only) install the repo as a profile bundle instead of patching
#    - requires repo-root package.json to declare dsh.bundle.patch
node $bin plugin --profile mmcollab add "D:\deepseek harness\任务13_多模型插件"
node $bin --profile mmcollab --patch "verify\patch-forms\enable-credentials.yml" --json "Call the multi_model_run tool ..."
```

Pass criteria (all four, from the `--json` stream — do not accept a bare exit code):

1. `exit code 0`;
2. a `{"type":"tool_call","tool":"multi_model_run",...}` event;
3. the paired `{"type":"tool_result","status":"completed"}` carries the expected literal;
4. no `MISSING_CREDENTIAL` on stderr, and `{"type":"turn_end","reason":{"kind":"completed"}}`.

The command the Lead actually used for the real plugin (verbatim, `[RUN by Lead]` — profile `mmcollab`, all four runs
exit 0, evidence `verify/evidence/e2e-json*.stdout.txt`):

```powershell
node $bin --profile mmcollab --patch ".\verify\patch-forms\enable-credentials.yml" --patch ".\cordis.patch.yml" --json "Call the multi_model_run tool exactly once with task='Reply with exactly the single word PONG and nothing else.' and omit every other argument. Then print the tool result verbatim."
```

Expected outcomes, all verified on that command family `[RUN by Lead, verify/evidence/e2e-json*]`:

| scenario | expected `tool_result` | observed |
|---|---|---|
| `mode: parallel`, 2 real models | `status: "completed"`, one answer per model with latency/token usage | ✅ both answered (`PONG`, 645 ms / 2257 ms) |
| partial failure (`models: [deepseek-flash, <bogus>]`) | `status: "completed"`, per-model ok/failed, failure recorded with a code | ✅ 1 ok / 1 failed, `INVALID_REQUEST` per model |
| `mode: primary_secondary` | `status: "completed"`, secondary actually reviews the primary's draft | ✅ primary drafted `Paris`, secondary reviewed that draft |
| all models bogus | `status: "error"` (dsh surfaces it as an isError result), both failures aggregated in the message | ✅ |

So for the real plugin the acceptance signal is broader than the hello probe: a `tool_result` that is `completed`
**or** an aggregated `error` — both prove the tool executed and returned through the harness; `UNKNOWN_TOOL` /
no `tool_call` at all is the failure to watch for.

If (2) is missing while (1) passes, the row did not mount — re-read stderr for
`failed to import` / `did not activate`, and re-check the row form against §4.

### 11.1 Pre-flight recorded for the real plugin (2026-10-25, at the time of writing)

Two read-only checks were run against the Lead's actual `cordis.patch.yml` + `lib/index.js`; both passed, so the
only remaining risk is the live `multi_model_run` turn itself (provider latency/quota, not mounting):

```powershell
# composition: the repo-root overlay resolves the row to a file:// URL beside cordis.patch.yml
node $bin --profile mmtest --patch "cordis.patch.yml" --dump-config
# → - id: multi-model-collab
#     name: >-
#       file:///D:/deepseek%20harness/%E4%BB%BB%E5%8A%A113_%E5%A4%9A%E6%A8%A1%E5%9E%8B%E6%8F%92%E4%BB%B6/lib/index.js
#     config: { models: [...], mode: parallel, aggregate: all, ... }        exit 0
#   [RUN verify/evidence/root-patch-dump.txt]  (row source form: `name: ./lib/index.js`)

# module pre-flight: the plugin's own bare imports resolve from the workspace
node --input-type=module -e "await import('file:///.../lib/index.js')"
# → MODULE IMPORT OK / exports: Config, apply, inject, name, normalizeConfig / inject: ["tools","llm"]
#   [RUN verify/evidence/lead-plugin-preflight.txt]
```

### 11.2 GUI path (documented, not verified by this task)

The same overlay mechanism applies to the Web app. Its flags are `--host`, `--port <n>` (`0` = OS-assigned free
port), `--no-open`, `--public-url`, `--trusted-host`, TLS pair `[SRC dsh-web-app/lib/startup.js:25 — commander
`.option()` list]`. Launcher flags (`--profile`, `--patch`) must come **before** the app's own flags:

```powershell
# custom web-based scratch profile (bundle list from the shipped `web` template)
node $bin --profile webscratch --from-default-profile web --dump-config
node $bin --profile webscratch --patch ".\cordis.patch.yml" --no-open --port 0

# the shipped `web` profile directly — the form the Lead used
node $bin web --patch ".\cordis.patch.yml" --no-open --port 0
```

`headless`-template profiles (like `mmtest`) mount no UI, so a GUI run needs a `web`-template profile.
`UNVERIFIED by this task:` the GUI route itself (server boot, page, whether the tool appears in the UI) is another
teammate's check; this section records only the command shape and the flag-ordering rule above. Neither command in
this subsection was executed here.

---

## 12. Isolation & cleanup

- Only `C:\Users\admin\.dsh\profiles\mmtest` was created/modified by this task (plus the home patch layer, which
  pre-existed). The `desktop` profile was never booted, dumped, or edited.
- `mmtest` is currently **restored** to its pre-install state: `package.json` back to
  `bundles: [dsh-base, dsh-headless]`, `dependencies: {}`, `node_modules\dsh-hello-bundle` removed, and
  `--dump-config` no longer lists the bundle layer `[RUN]`.
- To dispose of the scratch profile entirely:
  `Remove-Item -Recurse -Force "C:\Users\admin\.dsh\profiles\mmtest"`.
- Session logs from these runs live under `$DSH_HOME/sessions` (normal harness behaviour).

---

## 13. What is *not* verified here

- `plugin_manager install_bundle` (approval-gated; approvals are disabled in this session). The CLI equivalent
  `dsh plugin add` **is** verified (§9).
- The bare-package **row form** (`name: dsh-multi-model-collab`) as an extra `--patch` row — only the install route
  was exercised for package-name resolution.
- Web/GUI surfaces: only the `headless` app was booted; nothing here claims the tool appears in the Web UI.
- `llm.listModels()` metadata (see §8).
- The Lead's real plugin itself (`dsh-multi-model-collab`) — the acceptance procedure in §11 is written for it but
  was executed against the throwaway `hello_probe` bundle.

---

## 14. Evidence index (`verify/`)

| path | what it is |
|---|---|
| `verify/hello-bundle/{package.json,index.js,cordis.patch.yml}` | the mounted probe bundle (`hello_probe`), zero imports |
| `verify/import-probe/index.js` + `cordis.patch.yml` | `defineTool` + bare-import variant (proves imports resolve from workspace `node_modules`) |
| `verify/tool-list-probe/index.js` + `cordis.patch.yml` | dumps `ctx.tools.schemas()` + `ctx.llm.listProviders()` without an agent turn |
| `verify/cred-probe/index.js` + `cordis.patch.yml` | reports credentials-service metadata only (no secret values) |
| `verify/patch-forms/*.yml` | the row-form matrix (`a1`-absolute file, `a2`-absolute dir, `b1`-`../` relative, `b2`-bare relative, `c`-bare package) + `enable-credentials.yml` |
| `verify/run-smoke.mjs` | reusable acceptance runner (asserts tool_call/tool_result/exit) |
| `verify/cred-shape.cjs` | prints the credential document structure with values redacted |
| `verify/asar-extract.cjs` | copy of `tools/asar-extract.js` (the original is ESM-blocked by the root `package.json` `"type":"module"`) |
| `verify/ref/cli/...`, `verify/ref/boot/...`, `verify/ref/headless/...` | extracted sources cited as `[SRC]`: `profile-boot`, `dump-config`, `dsh-app-boot`, `dsh-headless` |
| `verify/evidence/` | raw run artifacts of this task: `dump-config-mmtest.txt`, `dump-config-mmcollab.txt`, `smoke2-json.stdout.txt`, `smoke-json.stderr.txt` (the `MISSING_CREDENTIAL` run), `form-a2.stderr.txt`, `form-b2.stderr.txt`, `import-probe2.*`, `installed-bundle.*`, `plugin-add.stdout.txt`, `root-patch-dump.txt`, `lead-plugin-preflight.txt`, `run-smoke.log.txt`, `smoke-mmtest-<stamp>.json`, `credprobe*.{stdout,stderr}.txt`, profile snapshots (`mmtest-*.before`) |
| `verify/evidence/e2e-json*.stdout.txt` | the Lead's four real-plugin runs on profile `mmcollab` (parallel 2-model, partial failure, primary_secondary, all-bogus) — cited as `[RUN by Lead]` |
| `verify/evidence/asar-entries.txt` | the asar entry listing (moved here from the workspace root; it is a 2.8 MB artifact, not a source file) |
