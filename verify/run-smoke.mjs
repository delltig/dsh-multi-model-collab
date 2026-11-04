// Reusable end-to-end smoke runner (PowerShell .ps1 is blocked in this
// environment, so the runner is a Node script).
//
// What it does: boots a real dsh profile in headless mode with a real model
// turn, passes one or more --patch overlays, and asserts from the --json event
// stream that a named tool was actually CALLED by the agent and its result came
// back completed.
//
// Usage (cwd = workspace root):
//   node verify/run-smoke.mjs                       # hello_probe baseline
//   node verify/run-smoke.mjs --tool multi_model_run \
//        --patch ../cordis.patch.yml --task "..."   # Lead's real plugin
//
// Flags:
//   --profile <name>   dsh profile to boot                (default mmtest)
//   --tool <name>      tool name expected in tool_call     (default hello_probe)
//   --expect <text>    substring expected in tool_result    (default hello sentinel)
//   --patch <path>     extra --patch overlay (repeatable, applied last)
//   --task <text>      prompt sent to the agent
//   --keep             keep the spawned process output on stdout (always shown anyway)
//
// Exit code: 0 only when the profile booted, the tool was called, the result
// was `completed`, and the run exited 0.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const workspace = resolve(here, '..')

// The globally installed CLI; override with DSH_BIN if the installation moves.
const bin = process.env.DSH_BIN
  ?? 'C:\\Users\\admin\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js'

function parseArgs(argv) {
  const out = { patches: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--profile') out.profile = argv[++i]
    else if (a === '--tool') out.tool = argv[++i]
    else if (a === '--expect') out.expect = argv[++i]
    else if (a === '--patch') out.patches.push(argv[++i])
    else if (a === '--task') out.task = argv[++i]
    else if (a === '--keep') out.keep = true
    else throw new Error(`unknown argument ${JSON.stringify(a)}`)
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const profile = args.profile ?? 'mmtest'
const tool = args.tool ?? 'hello_probe'
const expect = args.expect ?? 'HELLO_FROM_PATCH_BUNDLE_9f3c2'
const task = args.task
  ?? `Call the ${tool} tool with note="ping-123" and then print the tool's exact output as your final answer.`

// The headless template leaves dsh-base's `credentials` row disabled, so a real
// model turn fails with MISSING_CREDENTIAL unless we re-enable it.
const patches = [
  resolve(here, 'patch-forms', 'enable-credentials.yml'),
  ...(args.keep ? [] : []),
  ...args.patches.map((p) => resolve(workspace, p)),
]

const argv = ['--profile', profile]
for (const p of patches) argv.push('--patch', p)
argv.push('--json', task)

if (!existsSync(bin)) {
  console.error(`resolved dsh bin.js not found: ${bin}\nset DSH_BIN to the installation's lib/bin.js`)
  process.exit(2)
}

console.log('== dsh smoke run ==')
console.log('profile: ' + profile)
console.log('patches:')
for (const p of patches) console.log('  ' + p)
console.log('prompt : ' + task)
console.log('')

const started = Date.now()
const run = spawnSync(process.execPath, [bin, ...argv], {
  cwd: workspace,
  encoding: 'utf8',
  env: { ...process.env, DSH_HOME: process.env.DSH_HOME ?? 'C:\\Users\\admin\\.dsh' },
  maxBuffer: 64 * 1024 * 1024,
})
const seconds = ((Date.now() - started) / 1000).toFixed(1)

const stdout = run.stdout ?? ''
const stderr = run.stderr ?? ''
const events = []
for (const line of stdout.split(/\r?\n/)) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) continue
  try { events.push(JSON.parse(trimmed)) } catch { /* non-JSON stray line */ }
}

const calls = events.filter((e) => e.type === 'tool_call' && e.tool === tool)
const results = events.filter((e) => e.type === 'tool_result' && calls.some((c) => c.callId === e.callId))
const completed = results.filter((r) => r.status === 'completed')
const final = events.find((e) => e.type === 'final')
const missingCredential = /MISSING_CREDENTIAL/.test(stderr)

const verdict = {
  profile,
  seconds: Number(seconds),
  exitCode: run.status,
  tool,
  toolCalls: calls.length,
  toolResults: results.length,
  completedResults: completed.length,
  resultText: completed[0]?.result ?? null,
  expectFound: completed.some((r) => String(r.result ?? '').includes(expect)),
  finalText: final?.text ?? null,
  missingCredential,
}

console.log('== tool events ==')
for (const c of calls) console.log('tool_call  ' + JSON.stringify({ callId: c.callId, tool: c.tool, input: c.input }))
for (const r of results) console.log('tool_result ' + JSON.stringify({ callId: r.callId, status: r.status, result: r.result }))
console.log('== final ==')
console.log(final?.text ?? '(no final event)')
console.log('== verdict ==')
console.log(JSON.stringify(verdict, null, 2))

if (stderr.trim() !== '') {
  console.log('== stderr (trimmed to the model-diagnostic lines) ==')
  for (const line of stderr.split(/\r?\n/)) {
    if (/^dsh: /.test(line) || /failed to import|did not activate|MISSING_CREDENTIAL/.test(line)) console.log(line)
  }
}

const ok = run.status === 0 && calls.length > 0 && completed.length > 0 && verdict.expectFound && !missingCredential
// Keep a machine-readable artifact next to the other evidence.
if (existsSync(resolve(here, 'evidence'))) {
  const { writeFileSync } = await import('node:fs')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const out = resolve(here, 'evidence', `smoke-${profile}-${stamp}.json`)
  writeFileSync(out, JSON.stringify({ argv, patches, task, events, verdict, ok }, null, 2) + '\n')
  console.log('evidence written: ' + out)
}
console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL')
process.exit(ok ? 0 : 1)
