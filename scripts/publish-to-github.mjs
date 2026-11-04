#!/usr/bin/env node
/**
 * One-command publish: create the GitHub repo, push this working tree, tag it
 * with the `dsh-plugin` topic, and link the repository metadata in
 * package.json — all from a Personal Access Token supplied through the
 * environment, never through the command line or this repository.
 *
 *   # GitHub -> Settings -> Developer settings -> Personal access tokens ->
 *   # Fine-grained tokens -> Generate new token
 *   #   Repository access: only the repo you are about to create (or "All repositories"
 *   #                      if the repo does not exist yet, because creation needs it)
 *   #   Permissions: Contents = Read and write, Administration = Read and write
 *   $env:GITHUB_TOKEN = "github_pat_..."       # PowerShell
 *   npm run publish:github
 *
 * Nothing is written with the token: `git push` receives it as a per-command
 * HTTP header, so it stays out of `.git/config`, out of the remote URL and out
 * of shell history. The token is never printed.
 *
 * Options:
 *   --repo <name>     repository name (default: the package name)
 *   --private         create a private repository (default: public — required for
 *                     the plugin market to read it)
 *   --dry-run         print the plan; no API call, no push
 *   --skip-topics     do not touch repository topics
 *   --prompt          ask for the token on a hidden prompt instead of reading
 *                     GITHUB_TOKEN (works in any shell, leaves no history)
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { askToken } from './lib/prompt-token.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const API = 'https://api.github.com'
const argv = process.argv.slice(2)
const has = flag => argv.includes(`--${flag}`)
const value = (flag, fallback) => {
  const index = argv.indexOf(`--${flag}`)
  return index === -1 ? fallback : argv[index + 1]
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const repoName = value('repo', pkg.name)
const privateRepo = has('private')
const dryRun = has('dry-run')
const skipTopics = has('skip-topics')
let token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? ''

const TOPICS = ['dsh-plugin', 'deepseek-harness', 'dsh', 'multi-model', 'llm', 'cordis']

/** Print one step. */
function step(message) {
  console.log(`\n▸ ${message}`)
}

/** Run git without a shell and without any interactive prompt. */
function git(args, extraEnv = {}) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', ...extraEnv },
  }).trim()
}

/** Call the GitHub REST API. @returns parsed JSON body. */
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

/** Basic-auth header value for a token, used only for one `git push`. */
function tokenHeader() {
  return `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`
}

/**
 * Confirm the local repository is worth publishing.
 * @returns the current branch name.
 */
function preflight() {
  step('checking the local repository')
  const status = git(['status', '--porcelain'])
  if (status !== '') throw new Error(`working tree is dirty — commit or stash first:\n${status}`)
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  const head = git(['rev-parse', '--short', 'HEAD'])
  const files = git(['ls-files']).split('\n').filter(Boolean).length
  console.log(`  branch ${branch} · commit ${head} · ${files} tracked files · ${pkg.name}@${pkg.version}`)
  return branch
}

async function main() {
  if (token === '' && !dryRun && has('prompt')) {
    token = await askToken('GitHub token (input hidden)')
  }
  if (token === '' && !dryRun) {
    console.error('GITHUB_TOKEN (or GH_TOKEN) is required. Either set it for this shell:\n'
      + '  $env:GITHUB_TOKEN = "github_pat_..."\n'
      + 'or run with --prompt to be asked on a hidden prompt (works in PowerShell 5.1, 7 and bash).\n'
      + 'See the header of scripts/publish-to-github.mjs for the exact token scopes.')
    process.exit(2)
  }

  const branch = preflight()

  step('identifying the account behind the token')
  let login = '<your-login>'
  if (!dryRun) {
    const me = await api('GET', '/user')
    if (!me.ok) throw new Error(`GET /user failed (${me.status}): ${JSON.stringify(me.body)}`)
    login = me.body.login
    console.log(`  authenticated as ${login}`)
  } else {
    console.log('  dry run — skipping the API call, using a placeholder account name')
  }

  const remoteUrl = `https://github.com/${login}/${repoName}.git`
  const repoUrl = `https://github.com/${login}/${repoName}`

  step(`creating ${privateRepo ? 'private' : 'public'} repository ${login}/${repoName}`)
  if (dryRun) {
    console.log(`  would POST ${API}/user/repos {"name":"${repoName}","private":${privateRepo}}`)
  } else {
    const created = await api('POST', '/user/repos', {
      name: repoName,
      description: pkg.description,
      private: privateRepo,
      has_issues: true,
      has_wiki: false,
      auto_init: false,
    })
    if (created.status === 422) console.log('  repository already exists — reusing it')
    else if (!created.ok) throw new Error(`creating the repository failed (${created.status}): ${JSON.stringify(created.body)}`)
    else console.log(`  created ${created.body.html_url}`)
  }

  step('wiring the origin remote (without a token in the URL)')
  if (dryRun) {
    console.log(`  would point origin at ${remoteUrl} (left untouched by --dry-run)`)
  } else {
    const remotes = git(['remote'])
    if (remotes.split('\n').includes('origin')) {
      git(['remote', 'set-url', 'origin', remoteUrl])
      console.log(`  updated origin -> ${remoteUrl}`)
    } else {
      git(['remote', 'add', 'origin', remoteUrl])
      console.log(`  added origin -> ${remoteUrl}`)
    }
  }

  step(`pushing ${branch}`)
  if (dryRun) {
    console.log(`  would run: git -c http.extraheader=<token> push -u origin ${branch}`)
  } else {
    try {
      git(['-c', `http.extraheader=${tokenHeader()}`, 'push', '-u', 'origin', branch])
      console.log('  pushed')
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`push failed:\n${detail}\n\n`
        + 'If the repository was created with a README/license, the remote already has commits:\n'
        + `  git pull --rebase origin ${branch} && git push -u origin ${branch}\n`
        + `or, since this is the first publish and the remote holds nothing of value:\n`
        + `  git push -u origin ${branch} --force`)
    }
  }

  if (!skipTopics) {
    step('adding repository topics')
    if (dryRun) {
      console.log(`  would PUT /repos/${login}/${repoName}/topics ${JSON.stringify(TOPICS)}`)
    } else {
      const topics = await api('PUT', `/repos/${login}/${repoName}/topics`, { names: TOPICS })
      if (!topics.ok) console.log(`  topics not set (${topics.status}) — add \`dsh-plugin\` by hand under About → Topics`)
      else console.log(`  ${TOPICS.join(', ')}`)
    }
  }

  step('linking repository metadata in package.json')
  const next = {
    ...pkg,
    repository: { type: 'git', url: `git+${remoteUrl}` },
    homepage: `${repoUrl}#readme`,
    bugs: { url: `${repoUrl}/issues` },
  }
  const serialized = `${JSON.stringify(next, null, 2)}\n`
  if (serialized === readFileSync(join(ROOT, 'package.json'), 'utf8')) {
    console.log('  already linked')
  } else if (dryRun) {
    console.log(`  would set repository/homepage/bugs -> ${repoUrl}`)
  } else {
    writeFileSync(join(ROOT, 'package.json'), serialized)
    git(['add', 'package.json'])
    git(['commit', '-m', 'chore: link repository metadata'])
    git(['-c', `http.extraheader=${tokenHeader()}`, 'push'])
    console.log('  committed and pushed')
  }

  console.log(`
done.
  repository : ${repoUrl}
  next       : npm login && npm publish --access public
  then       : npm run publish:market      # opens the awesome-dsh-plugin PR

If the token was scoped to this repository only, revoke it now:
  https://github.com/settings/tokens
`)
}

await main().catch((error) => {
  console.error(`\nfailed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
