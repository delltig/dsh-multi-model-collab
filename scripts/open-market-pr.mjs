#!/usr/bin/env node
/**
 * One-command market submission: fork the curated list, add the single YAML
 * entry it wants, and open the pull request — from the same GITHUB_TOKEN used
 * by scripts/publish-to-github.mjs. The token is never printed.
 *
 *   npm run publish:market                 # do it
 *   npm run publish:market -- --dry-run    # print the entry and the plan only
 *   npm run publish:market -- --prompt     # ask for the token on a hidden prompt
 *
 * The list is https://github.com/awesome-dsh-plugin/awesome-dsh-plugin — the
 * market app (dshmarket) and the official Discover index both read it, so this
 * one PR is the whole submission. See docs/market-submission.md.
 *
 * Options:
 *   --category <id>   taxonomy id (default: model). Valid ids:
 *                     agi ui usage theme model identity session memory tools wsl
 *                     browser vision voice docs skill workflow git notify dev
 *                     security remote market fun
 *   --dry-run         print the entry; no API call, no push
 *   --prompt          ask for the token on a hidden prompt instead of reading
 *                     GITHUB_TOKEN
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const API = 'https://api.github.com'
const UPSTREAM = 'awesome-dsh-plugin/awesome-dsh-plugin'
const argv = process.argv.slice(2)
const has = flag => argv.includes(`--${flag}`)
const value = (flag, fallback) => {
  const index = argv.indexOf(`--${flag}`)
  return index === -1 ? fallback : argv[index + 1]
}

const CATEGORIES = ['agi', 'ui', 'usage', 'theme', 'model', 'identity', 'session', 'memory', 'tools', 'wsl',
  'browser', 'vision', 'voice', 'docs', 'skill', 'workflow', 'git', 'notify', 'dev', 'security', 'remote',
  'market', 'fun']

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const category = value('category', 'model')
const dryRun = has('dry-run')
let token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? ''

const EN = 'Runs one task through several configured models at once — in parallel or as a primary/secondary '
  + 'review — and returns each model\'s answer plus an aggregated digest.'
const ZH = '把一个任务同时交给多个已配置模型（并行，或主模型起草 + 副模型复核），返回各模型答案与聚合摘要。'

function step(message) {
  console.log(`\n▸ ${message}`)
}

async function api(method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let parsed
  try {
    parsed = text === '' ? {} : JSON.parse(text)
  } catch {
    parsed = { raw: text }
  }
  return { status: response.status, ok: response.ok, body: parsed }
}

/**
 * Build the entry file exactly as the list's schema requires.
 * @param login - GitHub account opening the PR.
 * @returns relative path and file contents.
 */
function entry(login) {
  const { owner, repo } = resolveRepo(login)
  const repoPath = `${owner}/${repo}`
  const url = `https://github.com/${repoPath}`
  const yaml = [
    `url: ${url}`,
    `name: ${repoPath}`,
    `category: ${category}`,
    'description:',
    `  en: ${EN}`,
    `  zh: ${ZH}`,
    `icon: https://raw.githubusercontent.com/${repoPath}/main/assets/icon.png`,
    '',
  ].join('\n')
  return { path: `data/plugins/${owner}__${repo}.yml`, yaml, url, repoPath }
}

/**
 * Work out the canonical owner/repo. `publish:github` writes it into
 * package.json, so honour that; fall back to the authenticated account and the
 * package name when the metadata is not set yet.
 * @param login - authenticated GitHub account.
 * @returns owner and repository name.
 */
function resolveRepo(login) {
  const raw = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
  if (typeof raw === 'string') {
    const match = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(raw)
    if (match !== null) return { owner: match[1], repo: match[2] }
  }
  return { owner: login, repo: pkg.name }
}

/** Reject the two mistakes the list's CI fails on before spending an API call. */
function validate(entryValue) {
  const problems = []
  if (!CATEGORIES.includes(category)) problems.push(`category "${category}" is not one of the known ids`)
  if (!EN.endsWith('.')) problems.push('description.en must end with a period')
  if (/(^|[^\\]): /.test(EN)) problems.push('description.en contains ": " and must be quoted')
  if (!entryValue.url.startsWith('https://github.com/')) problems.push('url must be a github.com repository URL')
  return problems
}

const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms) })

async function main() {
  if (token === '' && !dryRun && has('prompt')) {
    const { askToken } = await import('./lib/prompt-token.mjs')
    token = await askToken('GitHub token for the market PR (input hidden)')
  }
  if (token === '' && !dryRun) {
    console.error('GITHUB_TOKEN (or GH_TOKEN) is required — the same fine-grained token as publish:github,\n'
      + 'with "Public repositories" access so it can fork the list. See docs/market-submission.md.\n'
      + 'Or run with --prompt to be asked for it on a hidden prompt.')
    process.exit(2)
  }

  let login = '<your-login>'
  let branch = 'main'
  if (!dryRun) {
    step('identifying the account behind the token')
    const me = await api('GET', '/user')
    if (!me.ok) throw new Error(`GET /user failed (${me.status}): ${JSON.stringify(me.body)}`)
    login = me.body.login
    console.log(`  ${login}`)
  }

  const file = entry(login)
  const problems = validate(file)
  if (problems.length > 0) throw new Error(`the entry does not satisfy the list's rules:\n  - ${problems.join('\n  - ')}`)

  step('entry to submit')
  console.log(`  file: ${file.path}\n`)
  console.log(file.yaml.split('\n').map(line => `  | ${line}`).join('\n'))

  if (dryRun) {
    console.log('\n▸ plan (dry run)')
    console.log(`  1. POST ${API}/repos/${UPSTREAM}/forks`)
    console.log(`  2. wait for ${login}/${UPSTREAM.split('/')[1]} to appear`)
    console.log(`  3. PUT  /repos/${login}/${UPSTREAM.split('/')[1]}/contents/${file.path}`)
    console.log(`  4. POST /repos/${UPSTREAM}/pulls  head=${login}:<default-branch> base=<default-branch>`)
    return
  }

  step('checking the upstream list')
  const upstream = await api('GET', `/repos/${UPSTREAM}`)
  if (!upstream.ok) throw new Error(`cannot read ${UPSTREAM} (${upstream.status})`)
  branch = upstream.body.default_branch ?? 'main'
  console.log(`  default branch: ${branch}`)

  step('loading the list into your account (fork)')
  const forked = await api('POST', `/repos/${UPSTREAM}/forks`, { default_branch_only: true })
  if (!forked.ok && forked.status !== 422) throw new Error(`fork failed (${forked.status}): ${JSON.stringify(forked.body)}`)
  const forkPath = `${login}/${upstream.body.name}`
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const ready = await api('GET', `/repos/${forkPath}`)
    if (ready.ok) break
    if (attempt === 0) console.log('  waiting for the fork to be created ...')
    await sleep(2000)
  }
  console.log(`  fork ready: https://github.com/${forkPath}`)

  step(`adding ${file.path}`)
  const message = `Add ${file.repoPath}`
  const content = Buffer.from(file.yaml, 'utf8').toString('base64')
  let put = await api('PUT', `/repos/${forkPath}/contents/${file.path}`, { message, content, branch })
  if (put.status === 422) {
    const existing = await api('GET', `/repos/${forkPath}/contents/${file.path}?ref=${branch}`)
    if (!existing.ok) throw new Error(`entry exists but cannot be read (${existing.status})`)
    put = await api('PUT', `/repos/${forkPath}/contents/${file.path}`, {
      message, content, branch, sha: existing.body.sha,
    })
    console.log('  updated the existing entry instead of adding a duplicate')
  }
  if (!put.ok) throw new Error(`writing the entry failed (${put.status}): ${JSON.stringify(put.body)}`)
  console.log('  written')

  step('opening the pull request')
  const body = [
    `Adds \`${pkg.name}\` — a DeepSeek Harness plugin that registers the \`multi_model_run\` tool.`,
    '',
    '**What it does.** One task is fanned out to several already-configured models through the Harness `llm` service,',
    'either in parallel or as a primary/secondary review, then aggregated as `all` / `vote` / `longest`. Each model\'s',
    'answer, latency and token usage are reported; a failing model is reported as failed without failing the call.',
    'Models are addressed as `<provider>/<model>` from `ctx.llm.listProviders()` — nothing about the provider or the',
    'model catalogue is hard-coded.',
    '',
    '**Install.** `dsh plugin add dsh-multi-model-collab` (declares `dsh.bundle.patch` + `cordis.patch.yml`).',
    '',
    '**Verification in this repo.**',
    '- 21 offline behaviour tests (`npm test`, no network)',
    '- 4 real end-to-end scenarios against live models — parallel success, partial-failure isolation,',
    '  primary/secondary review, and all-models-fail surfacing as an `isError` tool result',
    '- installed as a profile bundle and called with no patch row; two runs through the real `dsh web` UI',
    '',
    'Evidence: `docs/acceptance-evidence.md`, `docs/web-ui-verification.md`.',
    '',
    '**Name note — same repository name, different project.** `zanapeng/dsh-multi-model-collab` (August 2026) is an',
    'unrelated project that happens to share this repository name: it hard-wires a fixed four-stage pipeline',
    '(mimo-v2.5 → deepseek-v4-pro → mimo-v2.5-pro → deepseek-v4-flash review). This plugin is a general tool: any',
    'models the profile has configured, `parallel` or `primary_secondary`, three aggregation strategies, per-model',
    'failure isolation and caller-signal cancellation. That project is not on the list today (there is no',
    '`data/plugins/zanapeng__dsh-multi-model-collab.yml`), so this is a new entry rather than a duplicate — but I am',
    'flagging the collision explicitly so it is not mistaken for one.',
  ].join('\n')

  const pr = await api('POST', `/repos/${UPSTREAM}/pulls`, {
    title: `Add ${file.repoPath}`,
    head: `${login}:${branch}`,
    base: branch,
    body,
  })
  if (pr.status === 422) {
    console.log(`  a pull request for ${login}:${branch} already exists — check https://github.com/${UPSTREAM}/pulls`)
    return
  }
  if (!pr.ok) throw new Error(`opening the PR failed (${pr.status}): ${JSON.stringify(pr.body)}`)
  console.log(`\nopened: ${pr.body.html_url}`)
}

await main().catch((error) => {
  console.error(`\nfailed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
