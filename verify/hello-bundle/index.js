// Throwaway probe plugin: registers one tool that returns a fixed sentinel.
// Deliberately has ZERO imports so it can be mounted from a file URL by
// `dsh --patch` without the workspace having a node_modules tree.
// The tool definition below is the hand-rolled shape ctx.tools.register()
// accepts (see @deepseek-ai/dsh-tools register(): output.schema must be a
// supported raw JSON Schema and output.render must be a function).

export const name = 'dsh-hello-bundle'
export const inject = ['tools']

import { writeFileSync } from 'node:fs'

const SENTINEL = 'HELLO_FROM_PATCH_BUNDLE_9f3c2'

export function apply(ctx) {
  const definition = {
    name: 'hello_probe',
    description:
      'Return a fixed sentinel string plus the note you passed. ' +
      'Use it to prove that the dsh-hello-bundle plugin is mounted and its tool is callable.',
    parameters: {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'Any short string; echoed back verbatim.' },
      },
      required: ['note'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          sentinel: { type: 'string' },
          note: { type: 'string' },
          pid: { type: 'number' },
          plugin: { type: 'string' },
        },
        required: ['sentinel', 'note', 'pid', 'plugin'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      return { sentinel: SENTINEL, note: String(args?.note ?? ''), pid: process.pid, plugin: name }
    },
  }

  ctx.tools.register(definition)

  // Mount beacon: written at apply() time, i.e. without any agent turn.
  // Path is fixed so the smoke-test scripts can assert on it.
  try {
    writeFileSync(
      new URL('./apply-beacon.json', import.meta.url),
      JSON.stringify({
        at: new Date().toISOString(),
        plugin: name,
        tool: 'hello_probe',
        sentinel: SENTINEL,
        pid: process.pid,
        cwd: process.cwd(),
      }, null, 2) + '\n',
    )
  } catch {}
}
