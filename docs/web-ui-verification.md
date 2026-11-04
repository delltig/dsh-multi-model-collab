# Web-UI verification: `multi_model_run` through the real `dsh web` browser UI

Status: **worked** — the plugin was mounted into a live `dsh web` server, driven through the real
Harness Web UI in a headless Chrome, and both models returned inside the UI.

Verdict tags used below:

- `[OBS]` — observed in the running Web UI; the screenshot / capture file is named.
- `[CMD]` — command that was run, with its observed exit status or output.
- `NOT OBSERVED:` — could not be captured here; says exactly what is missing and why.

Verified on 2026-10-25 between 20:36 and 20:45 local (Asia/Shanghai), against the harness
installed at `C:\Users\admin\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh` (dsh 0.2.1).

Nothing in the plugin was modified for this verification. This document and the files under
`verify/web-ui/` are the only artifacts this session wrote, plus one scratch profile (`mmweb`).

---

## 1. Scratch profile

A throwaway profile was created from the shipped `web` template so the user's `web` / `desktop` /
`dsh-tui` / `mmtest` / `mmcollab` profiles were never selected or modified:

```
node "C:\Users\admin\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\lib\bin.js" \
  --profile mmweb --from-default-profile web --dump-config
```

`[CMD]` exit 0. The profile is `C:\Users\admin\.dsh\profiles\mmweb` with bundles
`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` and an empty `cordis.patch.yml`.

`[OBS]` The `web` template keeps the `credentials` row enabled, exactly as the team noted — no
`verify/patch-forms/enable-credentials.yml` overlay was needed, and no `MISSING_CREDENTIAL` error
appeared in the UI or on boot.

---

## 2. Boot command and the URL

```
cd "D:\deepseek harness\任务13_多模型插件"
node "C:\Users\admin\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\lib\bin.js" \
  --profile mmweb --patch ".\cordis.patch.yml" --no-open --port 0
```

`[CMD]` The only line printed on boot was:

```
dsh web: http://127.0.0.1:56600/?token=<redacted>
```

- URL used: `http://127.0.0.1:56600/?token=<redacted>` (port 56600, OS-assigned by `--port 0`).
- The `?token=` value is a live session credential and is redacted here and in every file kept
  under `verify/web-ui/`.
- `[OBS]` The user's own GUI at `http://127.0.0.1:58170` was never opened, contacted, or touched;
  a separate server on a separate port was used and stopped afterwards.

### Launcher-argument gotcha (worth knowing for the next person)

`--patch` is a **launcher** flag and the app name must not be repeated once `--profile` selects a
profile whose bundles already define the app:

| Attempt | Result |
| --- | --- |
| `dsh web --profile mmweb ...` | `error: option '--profile <name>' argument 'mmweb' is invalid. select a profile only once` |
| `dsh --profile mmweb web --no-open --port 0 --patch ...` | `error: unknown option '--patch'` |
| `dsh --profile mmweb --patch ... web --no-open --port 0` | `error: too many arguments. Expected 0 arguments but got 1: web` |
| `dsh --profile mmweb --patch ... --no-open --port 0` | boots; prints the URL above |

### Patch-layer activation

`[CMD]` `node $bin --profile mmweb --patch ".\cordis.patch.yml" --dump-config` (exit 0) printed the
composed tree containing the inserted row, which is the plugin being mounted:

```yaml
# == D:\deepseek harness\任务13_多模型插件\cordis.patch.yml
- id: multi-model-collab
  name: >-
    file:///D:/deepseek%20harness/%E4%BB%BB%E5%8A%A113_%E5%A4%9A%E6%A8%A1%E5%9E%8B%E6%8F%92%E4%BB%B6/lib/index.js
  config:
    models:
      ...
```

`[OBS]` Activation is also proven end-to-end: the tool **executed** inside a UI session and
returned real model output (§5). Without the mounted plugin the tool name would not exist at all.

---

## 3. Browser automation

- Browser: `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe` (Chrome 155), headless,
  driven by `playwright-core` from `C:\Users\admin\.dsh\profiles\desktop\node_modules`.
- Driver scripts (kept as evidence, re-runnable):
  - `verify/web-ui/webui-e2e.cjs` — first full run (composer → send → capture).
  - `verify/web-ui/webui-e2e-v2.cjs` — canonical run; adds the `轨迹` (trace) tab capture.
  - `verify/web-ui/webui-trace-detail.cjs`, `webui-trace-wide.cjs` — reopen the finished session
    and re-shoot the trace view (no extra model call).
  - `verify/web-ui/webui-initial-state.cjs` — clean initial-state screenshot.
- Run with the URL in the environment, e.g.
  `$env:DSH_WEB_URL="http://127.0.0.1:56600/?token=<redacted>"; node verify\web-ui\webui-e2e-v2.cjs`.

### The UI flow that was driven

1. Open the URL; dismiss the `预览版说明` preview dialog with the `继续` button.
2. Click the composer `div[role="textbox"]` (aria-label
   `描述你想要构建的内容, / 调用指令, @ 文件或对话`).
3. Type the prompt (below) with real key events.
4. Click `button[aria-label="发送消息"]` (the send arrow).
5. Poll the conversation pane until both model ids appear; then read `轨迹` (trace) for the tool call.

The workspace selector was already on `任务13_多模型插件` and the access mode on `工作区内修改`;
neither had to be changed.

---

## 4. Prompt sent (verbatim)

```
Call the multi_model_run tool exactly once with task='Reply with exactly the single word PONG and nothing else.' and print the tool result verbatim.
```

`[OBS]` The composer accepted all 148 characters
(`verify/web-ui/ui-02-composer-filled.png`).

---

## 5. What the UI showed

### 5.1 Tool name

`[OBS]` `multi_model_run` appears three times, in three independent places:

1. In the assistant's prose: `The multi_model_run tool was called exactly once and returned:` /
   `Tool result, verbatim:`
2. As the **tool-call row** in the `轨迹` (trace) tab, with its arguments:
   `multi_model_run{"task": "Reply with exactly the single word PONG and nothing else."}`
   (`verify/web-ui/trace.txt`, `verify/web-ui/ui-04-trace-toolcard-wide.png`).
3. As the rendered result heading: `## multi_model_run — parallel / all`.

### 5.2 Both model results

`[OBS]` Exact text captured from the conversation
(`verify/web-ui/conversation.txt`; shown in `verify/web-ui/ui-05-final-answer.png`):

```
## multi_model_run — parallel / all

**task**: Reply with exactly the single word PONG and nothing else.

**models**: deepseek-official/deepseek-flash, deepseek-official/deepseek-v4-pro — 2 succeeded, 0 failed

### deepseek-official/deepseek-flash — ok (708ms, 4 chars)

PONG

### deepseek-official/deepseek-v4-pro — ok (1506ms, 4 chars)

PONG

## aggregate

mode=parallel aggregate=all models=2 ok=2 failed=0 elapsed=1507ms
- OK   deepseek-official/deepseek-flash [peer] 4 chars, 708ms, tokens 42→10
- OK   deepseek-official/deepseek-v4-pro [peer] 4 chars, 1506ms, tokens 95→19
- pick: none — aggregate=all returns every answer verbatim
```

Both requested ids are present as literal text in the UI:
`deepseek-official/deepseek-flash` and `deepseek-official/deepseek-v4-pro`.
The turn header read `已完成，用时 21秒`, and the agent's closing line was
`Both configured models returned exactly `PONG`.`

### 5.3 Two runs, both successful

`[OBS]` The flow was run twice end-to-end in the UI (two separate browser sessions):

| Run | Turn time | flash | v4-pro | Result |
| --- | --- | --- | --- | --- |
| A (`webui-e2e.cjs`) | 29 s | ok, 746 ms, 4 chars | ok, 1227 ms, 4 chars | both `PONG` |
| B (`webui-e2e-v2.cjs`, screenshots below) | 21 s | ok, 708 ms, 4 chars | ok, 1506 ms, 4 chars | both `PONG` |

### 5.4 Screenshots (all under `verify/web-ui/`)

| File | What it shows |
| --- | --- |
| `ui-01-initial.png` | The real Harness Web UI served from profile `mmweb` at `127.0.0.1:56600`, clean `新会话` state, workspace `任务13_多模型插件`, composer empty. |
| `ui-02-composer-filled.png` | The 148-character prompt typed into the composer, send arrow enabled. |
| `ui-03-trace-toolcard.png` | `轨迹` tab: the `工具` row `multi_model_run {"task": "Reply with exactly the sing…"}` plus the assistant's verbatim printout row. |
| `ui-04-trace-toolcard-wide.png` | Same trace view, 1920×1080 with the UI zoomed to 80 % so the whole tool-call row is legible in one frame: tool name + arguments → result preview listing **both** model ids and both `PONG` values. |
| `ui-05-final-answer.png` | `对话` tab, final answer: the full tool result block (both model sections, both `PONG`, the aggregate block with token counts) and the closing line. |

Supporting text captures: `conversation.txt` (conversation pane `innerText`), `trace.txt`
(trace pane `innerText`), `trace-wide.txt` (wide trace pane), `ui-result.json` (automation
summary: booleans for tool name / both model ids, step list, console log), `e2e-v2.log`
(driver stdout).

---

## 6. Observed vs. not observed

`[OBS]` Real, from the running Web UI:

- The web app served the `mmweb` profile with the `./cordis.patch.yml` overlay applied.
- The composer, send button and trace tab were driven by a headless browser, not by a human.
- `multi_model_run` was invoked by the in-UI agent and returned `deepseek-official/deepseek-flash`
  and `deepseek-official/deepseek-v4-pro` results, twice (two independent sessions).
- Both models answered `PONG`; aggregate line reported `models=2 ok=2 failed=0`.
- Token usage was reported per model (`42→10`, `95→19`), so the calls were real model calls, not a
  mocked path.

`NOT OBSERVED` / limitations, stated plainly:

- **No expandable tool card.** In the Web UI the tool call renders as a single one-line row inside
  the `轨迹` tab (`工具  multi_model_run{"task": …}  →  summary…`). Clicking it does not open a
  detail drawer (the row's computed `cursor` is `default`), and the app itself truncates the
  summary with `…`. The full, untruncated result is therefore only legible in the `对话` tab —
  hence the conversation screenshot is the primary evidence, and `ui-04` is a wide/zoomed
  rendering of the same trace row rather than a true card expansion.
- **The `插件` (plugins) panel does not list the patch row.** It was opened and inspected
  (`plugins-panel.txt` was checked and then discarded): it only matched the sidebar session titles,
  not `multi-model-collab`. That panel appears to list installed bundles rather than `--patch`
  overlay rows, so plugin activation is evidenced by the successful tool call, not by that panel.
- **No approval prompt** was shown for `multi_model_run` (the browser session ran with file policy
  `workspace-write` and approval policy `ask`; the call needed no approval). This is expected for a
  non-destructive tool, and is reported here only so nobody assumes an approval step was validated.
- Rendering fidelity of the markdown code block (the tool result is shown inside a `代码块` block)
  was observed but its styling was not audited — out of scope.

### Side effects to be aware of

Two ordinary chat sessions were created by the verification in workspace `任务13_多模型插件`,
inheriting the prompt as their titles:

- `Call multi_model_run with PONG task` (run B)
- `Call multi_model_run for PONG test` (run A)

They are visible in the sidebar in the screenshots. They live in the shared `~/.dsh` data directory
and were **not** deleted, because deleting user session data is outside this session's write scope.

---

## 7. Manual click-path (reproduce by hand)

1. `node "C:\Users\admin\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\lib\bin.js" --profile mmweb --patch ".\cordis.patch.yml" --no-open --port 0`
   from the repo root; copy the printed `http://127.0.0.1:<port>/?token=…` URL into a browser.
2. Dismiss `预览版说明` with `继续`.
3. Ensure the workspace chips read `任务13_多模型插件` and `标准模式`.
4. Paste the prompt from §4 into the composer and press the ↑ send button.
5. When the turn reaches `已完成`, read the reply: `**models**` must list both
   `deepseek-official/deepseek-flash` and `deepseek-official/deepseek-v4-pro`, each under
   `### … — ok`, each answering `PONG`.
6. Optional: open the `轨迹` tab to see the `工具 multi_model_run{…}` row.

## 8. Cleanup

`[CMD]` After the captures, the background `dsh web` job was stopped and the headless browser
closed; no background job and no browser process from this session was left running. The user's
GUI on `127.0.0.1:58170` was never started, contacted, or stopped by this verification.
