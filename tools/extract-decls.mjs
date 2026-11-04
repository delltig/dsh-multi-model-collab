// Dump TypeScript declarations embedded in a package's Typert host registry
// (lib/typert.host.js), which carries the authoritative declarations for the
// live Host API even though only compiled JS ships.
//
// Usage:
//   node tools/extract-decls.mjs <typert.host.js>            # list names
//   node tools/extract-decls.mjs <typert.host.js> <Name>...  # print declarations
import { readFileSync } from 'node:fs'

const [file, ...names] = process.argv.slice(2)
if (!file) {
  console.error('usage: node tools/extract-decls.mjs <typert.host.js> [Name...]')
  process.exit(2)
}
const text = readFileSync(file, 'utf8')
// The registry stores declarations as JSON strings inside a JS object literal.
const re = /"declaration":\s*("(?:[^"\\]|\\.)*")/g
const decls = new Map()
for (;;) {
  const m = re.exec(text)
  if (m === null) break
  let decl
  try {
    decl = JSON.parse(m[1])
  } catch {
    continue
  }
  const name = /(?:interface|type|class|const|function)\s+([A-Za-z_$][\w$]*)/.exec(decl)?.[1]
  if (name !== undefined && !decls.has(name)) decls.set(name, decl)
}
if (names.length === 0) {
  console.log([...decls.keys()].sort().join('\n'))
  console.error(`total declarations: ${decls.size}`)
} else {
  for (const n of names) {
    const d = decls.get(n)
    console.log(`///// ${n} /////`)
    console.log(d ?? `(no declaration named ${n})`)
    console.log('')
  }
}
