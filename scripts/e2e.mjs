#!/usr/bin/env node
/**
 * End-to-end acceptance run for dsh-multi-model-collab.
 *
 * Boots a REAL DeepSeek Harness profile (a scratch one, by default `mmcollab`)
 * with this package mounted through `--patch ./cordis.patch.yml`, has a real
 * agent call `multi_model_run`, and asserts the four behaviours that matter:
 *
 *   1. parallel         two configured models both answer
 *   2. partial failure  one bad model degrades to a reported per-model failure
 *   3. primary_secondary the second model reviews the first model's draft
 *   4. all models fail  the tool call itself is an error (dsh isError)
 *
 * It spends real tokens on the configured provider, so it is opt-in (npm script
 * `npm run e2e`), never part of `npm test`.
 *
 * Usage:
 *   node scripts/e2e.mjs [--profile mmcollab] [--bin <path to dsh bin.js>]
 *                        [--only 1,3] [--keep-profile] [--verbose]
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PATCH = join(ROOT, 'cordis.patch.yml')
const CREDENTIALS_PATCH = join(ROOT, 'verify', 'patch-forms', 'enable-credentials.yml')

const argv = process.argv.slice(2)
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  return index === -1 ? fallback : argv[index + 1]
}
const profile = option('profile', 'mmcollab')
const only = option('only', '')
const verbose = argv.includes('--verbose')
const bin = option('bin', process.env.DSH_BIN ?? findDsh())

/**
 * Locate the `dsh` CLI entry point.
 * @returns absolute path to `lib/bin.js`.
 */
function findDsh() {
  const candidates = [
    process.env.APPDATA === undefined ? '' : join(process.env.APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    '/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js',
    '/usr/lib/node_modules/@deepseek-ai/dsh/lib/bin.js',
  ].filter(entry => entry !== '')
  const found = candidates.find(candidate => existsSync(candidate))
  if (found === undefined) {
    console.error('cannot locate the dsh CLI; pass --bin <path to @deepseek-ai/dsh/lib/bin.js>')
    process.exit(2)
  }
  return found
}

/**
 * Run the CLI and capture its decoded output.
 * @param {string[]} args - CLI arguments.
 * @returns promise for exit code, stdout, stderr.
 */
function run(args) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd: ROOT, windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    child.on('close', code => resolvePromise({ code, stdout, stderr }))
  })
}

/**
 * Pick the last transcript events of one type from a `--json` run.
 * @param {string} stdout - captured stdout.
 * @param {string} type - event type.
 * @returns parsed events.
 */
function events(stdout, type) {
  const found = []
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      const event = JSON.parse(trimmed)
      if (event.type === type) found.push(event)
    } catch {
      // non-JSON diagnostic line
    }
  }
  return found
}

const scenarios = [
  {
    id: '1',
    title: 'parallel — two configured models both answer',
    prompt: "Call the multi_model_run tool exactly once with task='Reply with exactly the single word PONG and nothing else.' and omit every other argument. Then print the tool result verbatim.",
    check(transcript) {
      const call = events(transcript, 'tool_call').find(event => event.tool === 'multi_model_run')
      if (call === undefined) return 'the agent never called multi_model_run'
      const result = events(transcript, 'tool_result').find(event => event.callId === call.callId)
      if (result === undefined) return 'no tool_result was recorded'
      if (result.status !== 'completed') return `tool_result status was ${String(result.status)}`
      for (const id of ['deepseek-official/deepseek-flash', 'deepseek-official/deepseek-v4-pro']) {
        if (!String(result.result).includes(id)) return `the rendered result does not mention ${id}`
      }
      if (!/2 succeeded, 0 failed/.test(String(result.result))) return 'the run did not report 2 succeeded, 0 failed'
      return undefined
    },
  },
  {
    id: '2',
    title: 'partial failure — one bad model is reported, the call still succeeds',
    prompt: "Call the multi_model_run tool exactly once with these exact arguments: task='Name the capital of France in one word.', models=['deepseek-official/deepseek-flash','deepseek-official/not-a-real-model']. Omit mode, aggregate and system. Then print the tool result verbatim.",
    check(transcript) {
      const result = events(transcript, 'tool_result').find(event => String(event.result).includes('not-a-real-model'))
      if (result === undefined) return 'no tool_result mentioning the bad model'
      if (result.status !== 'completed') return `the call failed instead of isolating the model failure (status ${String(result.status)})`
      if (!/1 succeeded, 1 failed/.test(String(result.result))) return 'the run did not report 1 succeeded, 1 failed'
      if (!/INVALID_REQUEST/.test(String(result.result))) return 'the provider failure code was not surfaced'
      return undefined
    },
  },
  {
    id: '3',
    title: 'primary_secondary — the second model reviews the first draft',
    prompt: "Call the multi_model_run tool exactly once with arguments task='Name the capital of France in one word.' and mode='primary_secondary'. Omit models, aggregate and system. Then print the tool result verbatim.",
    check(transcript) {
      const result = events(transcript, 'tool_result').find(event => String(event.result).includes('primary_secondary'))
      if (result === undefined) return 'no primary_secondary tool_result'
      if (result.status !== 'completed') return `tool_result status was ${String(result.status)}`
      if (!/\[primary\]/.test(String(result.result))) return 'no model was labelled primary'
      if (!/\[secondary\]/.test(String(result.result))) return 'no model was labelled secondary'
      return undefined
    },
  },
  {
    id: '4',
    title: 'all models fail — the tool call itself is an error',
    prompt: "Call the multi_model_run tool exactly once with arguments task='Say hi.' and models=['deepseek-official/no-such-model-a','deepseek-official/no-such-model-b']. Omit mode, aggregate and system. Then print the tool result verbatim.",
    check(transcript) {
      const result = events(transcript, 'tool_result').find(event => String(event.result).includes('no-such-model'))
      if (result === undefined) return 'no tool_result mentioning the bad models'
      if (result.status !== 'error') return `expected status "error", got ${String(result.status)}`
      if (!/every model failed/.test(String(result.result))) return 'the aggregated failure message is missing'
      return undefined
    },
  },
]

async function main() {
  console.log(`dsh bin  : ${bin}`)
  console.log(`profile  : ${profile}`)
  console.log(`repo     : ${ROOT}\n`)

  const profileDir = process.env.DSH_HOME === undefined
    ? join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh', 'profiles', profile)
    : join(process.env.DSH_HOME, 'profiles', profile)
  if (!existsSync(profileDir)) {
    console.log(`creating scratch profile "${profile}" from the headless template ...`)
    const created = await run(['--profile', profile, '--from-default-profile', 'headless', '--dump-config'])
    if (created.code !== 0) {
      console.error('profile creation failed:\n' + created.stderr)
      process.exit(1)
    }
  }

  const selected = only === '' ? scenarios : scenarios.filter(scenario => only.split(',').includes(scenario.id))
  const results = []
  for (const scenario of selected) {
    process.stdout.write(`\n[${scenario.id}] ${scenario.title}\n`)
    const args = [
      '--profile', profile,
      '--patch', CREDENTIALS_PATCH,
      '--patch', PATCH,
      '--json',
      scenario.prompt,
    ]
    const started = Date.now()
    const { code, stdout, stderr } = await run(args)
    if (verbose) {
      console.log('--- stdout ---\n' + stdout)
      console.log('--- stderr ---\n' + stderr)
    }
    if (code !== 0) {
      results.push({ scenario, ok: false, detail: `dsh exited ${code}: ${stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(' | ')}` })
      console.log(`  FAIL dsh exited ${code}`)
      continue
    }
    const problem = scenario.check(stdout)
    results.push({ scenario, ok: problem === undefined, detail: problem ?? `${Math.round((Date.now() - started) / 1000)}s` })
    console.log(problem === undefined ? `  PASS ${Math.round((Date.now() - started) / 1000)}s` : `  FAIL ${problem}`)
  }

  const failed = results.filter(result => !result.ok)
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed`)
  if (failed.length > 0) {
    for (const result of failed) console.error(`- scenario ${result.scenario.id}: ${result.detail}`)
    process.exit(1)
  }
}

await main()
