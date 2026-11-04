# Changelog

All notable changes to this plugin are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-10-25

First release. Verified against DeepSeek Harness `0.2.1` (CLI `0.2.1-rc.2`,
desktop runtime `0.2.1-rc.3`).

### Added

- `multi_model_run` tool: one task is fanned out to several already-configured
  models through the Harness `llm` service, then aggregated.
  - `parallel` mode — every model answers the task independently, concurrently.
  - `primary_secondary` mode — the first model drafts; the others receive the
    draft plus the original task and are asked to review and correct it. A
    failed primary degrades to independent peer answers instead of failing.
  - `all` / `vote` / `longest` aggregation; `vote` normalizes text, takes a
    strict majority, and falls back to the longest answer on a tie while
    reporting the real tally.
- Loader configuration (`Config`): default model set, mode, aggregation,
  default provider, system prompt, temperature, output cap, per-model and whole
  call timeouts, concurrency, per-answer clipping, usage inclusion, and the
  secondary-review instruction. Every field is settable from `cordis.yml`
  without touching code.
- Per-model failure isolation: a model that errors, throws, times out, or never
  emits a terminal `finish` chunk is reported as `failed` with its provider code
  and message; the call itself only fails when every model fails.
- Caller cancellation: `exec.signal` is fused with a per-model deadline and
  forwarded to every in-flight model call.
- Model references resolved against the live provider registry
  (`<provider>/<model>`, `defaultProvider` for bare ids, catalogue lookup
  otherwise); an unresolvable reference reports every configured route.
- Bundle packaging: `dsh.bundle.patch` → `cordis.patch.yml`, installable with
  `dsh plugin add`, and usable directly as a `dsh web --patch` overlay.

### Verified

- 21 offline behaviour tests (`npm test`), no network.
- Four real end-to-end scenarios against live models (`npm run e2e`):
  parallel success, partial failure isolation, primary/secondary review, and
  all-models-fail surfacing as an `isError` tool result.
- Installed as a profile bundle and called with no patch row.
- Two runs through the real `dsh web` UI, driven headlessly.
