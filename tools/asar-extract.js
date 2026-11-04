// Minimal ASAR reader: lists entries and extracts selected paths.
// Usage:
//   node asar-extract.js list <asar> [prefix]
//   node asar-extract.js extract <asar> <outDir> <prefix...>
const fs = require('fs')
const path = require('path')

function readHeader(asarPath) {
  const fd = fs.openSync(asarPath, 'r')
  const sizeBuf = Buffer.alloc(16)
  fs.readSync(fd, sizeBuf, 0, 16, 0)
  const headerSize = sizeBuf.readUInt32LE(4) // payload size of header pickle
  const jsonSize = sizeBuf.readUInt32LE(12)
  const jsonBuf = Buffer.alloc(jsonSize)
  fs.readSync(fd, jsonBuf, 0, jsonSize, 16)
  fs.closeSync(fd)
  const dataOffset = 8 + headerSize
  return { header: JSON.parse(jsonBuf.toString('utf8')), dataOffset }
}

function walk(node, prefix, out) {
  for (const [name, child] of Object.entries(node.files || {})) {
    const p = prefix ? prefix + '/' + name : name
    if (child.files) walk(child, p, out)
    else out.push({ path: p, size: child.size, offset: child.offset, unpacked: !!child.unpacked })
  }
}

function main() {
  const [cmd, asarPath, ...rest] = process.argv.slice(2)
  const { header, dataOffset } = readHeader(asarPath)
  const entries = []
  walk(header, '', entries)
  if (cmd === 'list') {
    const pre = rest[0]
    let list = entries
    if (pre) list = entries.filter((e) => e.path.startsWith(pre))
    for (const e of list) console.log(e.path + '\t' + e.size)
    console.error('total entries: ' + entries.length + ', matched: ' + list.length)
    return
  }
  if (cmd === 'extract') {
    const outDir = rest[0]
    const prefixes = rest.slice(1)
    const fd = fs.openSync(asarPath, 'r')
    let n = 0
    for (const e of entries) {
      if (!prefixes.some((p) => e.path === p || e.path.startsWith(p + '/'))) continue
      const dest = path.join(outDir, e.path)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      if (e.unpacked) continue
      const buf = Buffer.alloc(e.size)
      fs.readSync(fd, buf, 0, e.size, dataOffset + Number(e.offset))
      fs.writeFileSync(dest, buf)
      n++
    }
    fs.closeSync(fd)
    console.log('extracted ' + n + ' files to ' + outDir)
    return
  }
  console.error('unknown command')
  process.exit(2)
}
main()
