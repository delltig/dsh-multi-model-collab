#!/usr/bin/env node
/**
 * Upload this working tree through the GitHub **REST API** instead of `git push`.
 *
 * Why this exists: `github.com:443` (the host `git push` talks to) can be
 * unreachable on some networks while `api.github.com` stays reachable. This
 * script builds the exact same tree through the Git Data API — blobs, one tree,
 * one commit, one ref update — so the repository still gets published.
 *
 *   $env:GITHUB_TOKEN = "..."          # Contents: read/write (+ Workflows for CI files)
 *   node scripts/upload-via-api.mjs
 *   node scripts/upload-via-api.mjs --dry-run
 *
 * The uploaded content is byte-identical to the committed index, so once
 * `github.com` is reachable again `git fetch origin && git reset --hard
 * origin/main` aligns the local history with the remote one without losing
 * anything. The commit this creates is a new commit object (different SHA from
 * the local one), which is why that one-time alignment is needed.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const API = 'https://api.github.com'
const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
let token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? ''

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const REMOTE_OWNER = 'delltig'
const REMOTE_REPO = 'dsh-multi-model-collab'
const MESSAGE = 'dsh-multi-model-collab 0.1.0: multi-model fan-out tool for DeepSeek Harness'
const AUTHOR = { name: 'applestore', email: 'applestore@126.com' }

/** Run git and return trimmed stdout. */
function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
}

async function api(method, path, body) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(`${API}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(60000),
      })
      const text = await response.text()
      let parsed
      try {
        parsed = text === '' ? {} : JSON.parse(text)
      } catch {
        parsed = { raw: text }
      }
      return { status: response.status, ok: response.ok, body: parsed }
    } catch (error) {
      if (attempt === 4) throw error
      await new Promise(resolve => { setTimeout(resolve, 1500 * attempt) })
    }
  }
  throw new Error('unreachable')
}

/** Enumerate exactly what the index holds: path, mode, bytes. */
function indexEntries() {
  const rows = git(['ls-files', '-s', '-z']).split('\0').filter(Boolean)
  return rows.map((row) => {
    // "<mode> <sha> <stage>\t<path>"
    const tab = row.indexOf('\t')
    const meta = row.slice(0, tab).split(' ')
    const path = row.slice(tab + 1)
    return { mode: meta[0], path, bytes: readFileSync(join(ROOT, path)) }
  })
}

/** Upload one file as a blob and return its SHA. */
async function createBlob(entry) {
  const created = await api('POST', `/repos/${REMOTE_OWNER}/${REMOTE_REPO}/git/blobs`, {
    content: entry.bytes.toString('base64'),
    encoding: 'base64',
  })
  if (!created.ok) throw new Error(`blob ${entry.path} failed (${created.status}): ${JSON.stringify(created.body)}`)
  return created.body.sha
}

async function main() {
  if (token === '' && !dryRun) {
    console.error('GITHUB_TOKEN (or GH_TOKEN) is required — Contents: read and write, plus Workflows for .github/workflows/*.')
    process.exit(2)
  }
  if (dryRun && token === '') token = 'dry-run'

  const entries = indexEntries()
  console.log(`▸ ${entries.length} files in the index (${(entries.reduce((sum, entry) => sum + entry.bytes.length, 0) / 1024).toFixed(0)} KB)`)

  console.log('▸ resolving the repository and branch')
  let branch = 'main'
  let parentSha
  if (!dryRun) {
    const repo = await api('GET', `/repos/${REMOTE_OWNER}/${REMOTE_REPO}`)
    if (!repo.ok) throw new Error(`cannot read the repository (${repo.status}): ${JSON.stringify(repo.body)}`)
    branch = repo.body.default_branch ?? 'main'
    const ref = await api('GET', `/repos/${REMOTE_OWNER}/${REMOTE_REPO}/git/ref/heads/${branch}`)
    if (ref.ok) {
      parentSha = ref.body.object.sha
      console.log(`  ${REMOTE_OWNER}/${REMOTE_REPO}@${branch} exists, parent ${parentSha.slice(0, 7)}`)
    } else {
      // The Git Data API refuses blobs on a repository with no commits
      // ("Git Repository is empty", 409), so seed one file through the
      // contents API — that endpoint does initialize an empty repository.
      console.log(`  ${REMOTE_OWNER}/${REMOTE_REPO}@${branch} is empty — seeding the initial commit`)
      const seed = entries.find(entry => entry.path === 'README.md')
      const seeded = await api('PUT', `/repos/${REMOTE_OWNER}/${REMOTE_REPO}/contents/README.md`, {
        message: 'Initialize repository',
        content: (seed?.bytes ?? Buffer.from(`# ${REMOTE_REPO}\n`)).toString('base64'),
        branch,
      })
      if (!seeded.ok) throw new Error(`seeding the repository failed (${seeded.status}): ${JSON.stringify(seeded.body)}`)
      const afterSeed = await api('GET', `/repos/${REMOTE_OWNER}/${REMOTE_REPO}/git/ref/heads/${branch}`)
      if (!afterSeed.ok) throw new Error(`cannot read the seeded branch (${afterSeed.status})`)
      parentSha = afterSeed.body.object.sha
      console.log(`  seeded, parent ${parentSha.slice(0, 7)}`)
    }
  } else {
    console.log('  dry run — skipping API calls')
  }

  console.log('▸ uploading blobs (8 at a time)')
  const shas = new Array(entries.length)
  if (dryRun) {
    console.log(`  would upload ${entries.length} blobs`)
  } else {
    let cursor = 0
    let done = 0
    const worker = async () => {
      for (;;) {
        const index = cursor
        cursor += 1
        if (index >= entries.length) return
        shas[index] = await createBlob(entries[index])
        done += 1
        if (done % 20 === 0 || done === entries.length) process.stdout.write(`  ${done}/${entries.length}\r`)
      }
    }
    await Promise.all(Array.from({ length: 8 }, worker))
    process.stdout.write(`  ${entries.length}/${entries.length} blobs\n`)
  }

  console.log('▸ creating the tree')
  const tree = entries.map((entry, index) => ({
    path: entry.path,
    mode: entry.mode === '100755' ? '100755' : '100644',
    type: 'blob',
    sha: dryRun ? '0'.repeat(40) : shas[index],
  }))
  let treeSha
  if (dryRun) {
    console.log(`  would create a tree with ${tree.length} entries`)
  } else {
    const created = await api('POST', `/repos/${REMOTE_OWNER}/${REMOTE_REPO}/git/trees`, { tree })
    if (!created.ok) throw new Error(`tree failed (${created.status}): ${JSON.stringify(created.body)}`)
    treeSha = created.body.sha
    console.log(`  tree ${treeSha.slice(0, 7)}`)
  }

  console.log('▸ creating the commit')
  let commitSha
  if (dryRun) {
    console.log(`  would commit "${MESSAGE}"${parentSha === undefined ? ' (no parent)' : ''}`)
  } else {
    const now = Math.floor(Date.now() / 1000)
    const created = await api('POST', `/repos/${REMOTE_OWNER}/${REMOTE_REPO}/git/commits`, {
      message: MESSAGE,
      tree: treeSha,
      parents: parentSha === undefined ? [] : [parentSha],
      author: { ...AUTHOR, date: new Date(now * 1000).toISOString() },
      committer: { ...AUTHOR, date: new Date(now * 1000).toISOString() },
    })
    if (!created.ok) throw new Error(`commit failed (${created.status}): ${JSON.stringify(created.body)}`)
    commitSha = created.body.sha
    console.log(`  commit ${commitSha.slice(0, 7)}`)
  }

  console.log(`▸ pointing ${branch} at the commit`)
  if (dryRun) {
    console.log(parentSha === undefined ? '  would create the ref' : '  would update the ref')
  } else if (parentSha === undefined) {
    const created = await api('POST', `/repos/${REMOTE_OWNER}/${REMOTE_REPO}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: commitSha,
    })
    if (!created.ok) throw new Error(`creating the ref failed (${created.status}): ${JSON.stringify(created.body)}`)
    console.log('  branch created')
  } else {
    const updated = await api('PATCH', `/repos/${REMOTE_OWNER}/${REMOTE_REPO}/git/refs/heads/${branch}`, {
      sha: commitSha,
      force: true,
    })
    if (!updated.ok) throw new Error(`updating the ref failed (${updated.status}): ${JSON.stringify(updated.body)}`)
    console.log('  branch updated')
  }

  console.log('▸ setting repository topics')
  const topics = ['dsh-plugin', 'deepseek-harness', 'dsh', 'multi-model', 'llm', 'cordis']
  if (dryRun) {
    console.log(`  would set ${topics.join(', ')}`)
  } else {
    const set = await api('PUT', `/repos/${REMOTE_OWNER}/${REMOTE_REPO}/topics`, { names: topics })
    console.log(set.ok ? `  ${topics.join(', ')}` : `  topics not set (${set.status})`)
  }

  console.log(`
done — https://github.com/${REMOTE_OWNER}/${REMOTE_REPO}

Once \`github.com:443\` is reachable again, align the local history with the
remote one (the content is identical; only the commit object differs):

  git fetch origin
  git reset --hard origin/main
`)
}

await main().catch((error) => {
  console.error(`\nfailed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
