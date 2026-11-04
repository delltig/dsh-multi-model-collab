// NEGATIVE probe: a workspace-mounted plugin that uses the CONVENIENCE import
// `@deepseek-ai/dsh-tools` (defineTool). Used to record the exact failure mode:
// a file-URL mount resolves bare specifiers from the plugin file's own
// directory, and the workspace has no node_modules carrying dsh-tools.
import { defineTool } from '@deepseek-ai/dsh-tools'
import { writeFileSync } from 'node:fs'

export const name = 'dsh-import-probe'
export const inject = ['tools']

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'import_probe',
    description: 'Probe tool built from the convenience import.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute() { return 'ok' },
  }))
  try { writeFileSync(new URL('./import-probe.json', import.meta.url), '{"mounted":true}\n') } catch {}
}
