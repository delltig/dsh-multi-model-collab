/**
 * Read a secret from a terminal without echoing it.
 *
 * The publish scripts can take their GitHub token from `GITHUB_TOKEN`, but a
 * hidden prompt is friendlier: it works the same in PowerShell 5.1, PowerShell
 * 7 and bash, and the value never lands in shell history or in the process
 * argument list.
 *
 * @param label - prompt text.
 * @returns the trimmed secret.
 */
export async function askToken(label = 'GitHub token (input hidden)') {
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    throw new Error('no interactive terminal — set GITHUB_TOKEN in the environment instead of --prompt')
  }
  process.stdout.write(`${label}: `)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding('utf8')

  return new Promise((resolve, reject) => {
    let value = ''
    const finish = (error) => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener('data', onData)
      process.stdout.write('\n')
      if (error === undefined) resolve(value.trim())
      else reject(error)
    }
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\r' || character === '\n') return finish(undefined)
        if (character === '\u0003') return finish(new Error('cancelled'))
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1)
          continue
        }
        value += character
      }
    }
    process.stdin.on('data', onData)
  })
}
