# Research tooling

The installed Harness on this machine ships as an Electron **asar archive**, not a source
tree, and it contains **no `.d.ts` files**. `docs/api-contracts.md` and
`docs/runtime-install.md` were therefore produced by reading the shipped JS out of the archive
and by asking the live Harness for its own contracts. These two scripts are what did it; they are
research aids, not part of the plugin.

## `asar-extract.js` — read files out of `app.asar`

```bash
# list every archived path (optionally under a prefix)
node tools/asar-extract.js list "<...>/resources/app.asar" dsh/node_modules/@deepseek-ai

# extract one or more package subtrees into <outDir>
node tools/asar-extract.js extract "<...>/resources/app.asar" tools/ref \
  "dsh/node_modules/@deepseek-ai/dsh-tools" \
  "dsh/node_modules/@deepseek-ai/dsh-llm" \
  "dsh/node_modules/@deepseek-ai/dsh-agent-preset"
```

`tools/ref/` in this repo is a small, checked-in subset (the packages `docs/api-contracts.md`
cites verbatim, including the plugin-development skill references that ship inside
`@deepseek-ai/dsh-agent-preset`). Extract more on demand — do not commit a full extraction
(it is ~95 MB across 6190 files).

Typical archive root on this machine:
`D:\Program Files (x86)\deepseek harness\resources\app.asar`

## `extract-decls.mjs` — recover the TypeScript declarations the build strips

Each package's `lib/typert.host.js` holds its public API declarations as JSON strings. This is the
only place the exact types exist on a shipped install.

```bash
# list every declaration a package publishes
node tools/extract-decls.mjs tools/ref/dsh/node_modules/@deepseek-ai/dsh-llm/lib/typert.host.js

# print chosen declarations verbatim
node tools/extract-decls.mjs tools/ref/dsh/node_modules/@deepseek-ai/dsh-llm/lib/typert.host.js \
  GenerateOptions StreamChunk FinishReason TokenUsage
```

For day-to-day plugin work you do not need this: `npm install` pulls the published packages
(`@deepseek-ai/dsh-tools@0.2.1-rc.3`, `@deepseek-ai/dsh-llm`, `@deepseek-ai/cordis`,
`@deepseek-ai/schemastery`) which **do** ship `.d.ts`, and `tsc` typechecks against them.

## The live Harness is the final authority

Behaviour that is not in any type — which services exist, what a plugin row may contain, how a
tool schema is compiled — is answered by the running Harness itself:

```text
cordis_inspect_list()
cordis_inspect_query(platform="host", provider="Service", method="listService", input={service:"llm"})
cordis_inspect_query(platform="host", provider="Service", method="listService", input={service:"tools"})
cordis_inspect_query(platform="host", provider="Event",   method="listEvents", input={event:"llm/stream"})
cordis_inspect_query(platform="host", provider="Tool",    method="listTools")
```
