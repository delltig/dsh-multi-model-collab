// Verification probe: enumerate what the live tools registry projects to the
// model, WITHOUT running an agent turn. Writes names/metadata only.
import { writeFileSync } from 'node:fs'

export const name = 'dsh-tool-list-probe'
export const inject = ['tools']

const OUT = new URL('./tool-list.json', import.meta.url)

export function apply(ctx) {
  // Delay so every other inserted row has had a chance to register.
  setTimeout(async () => {
    const out = { at: new Date().toISOString() }
    try {
      out.schemas = ctx.tools.schemas().map((s) => ({
        name: s.name,
        descriptionLength: (s.description ?? '').length,
        parameterKeys: Object.keys(s.parameters?.properties ?? {}),
      }))
      out.hasHelloProbe = out.schemas.some((s) => s.name === 'hello_probe')
      const llm = ctx.get('llm')
      out.llmService = llm !== undefined
      if (llm !== undefined) {
        try { out.providers = await llm.listProviders() } catch (error) { out.providersError = String(error) }
      }
    } catch (error) {
      out.error = String(error)
    }
    try { writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n') } catch {}
  }, 400)
}
