// Diagnostic probe (no secrets written): reports what the live credentials
// service can see for the DEEPSEEK_API_KEY ref. Writes only configuration
// metadata (configured/source/record keys), never a credential value.
import { writeFileSync } from 'node:fs'

export const name = 'dsh-cred-probe'
export const inject = ['credentials']

export function apply(ctx) {
  const out = { at: new Date().toISOString(), ref: 'DEEPSEEK_API_KEY' }
  const report = (extra) => {
    try {
      writeFileSync(new URL('./cred-probe.json', import.meta.url), JSON.stringify({ ...out, ...extra }, null, 2) + '\n')
    } catch (error) {
      out.writeError = String(error)
    }
  }
  Promise.resolve()
    .then(async () => {
      const svc = ctx.get('credentials')
      out.hasService = svc !== undefined
      out.methods = svc ? Object.getOwnPropertyNames(Object.getPrototypeOf(svc)).filter((k) => k !== 'constructor') : []
      out.describe = svc?.describe ? await svc.describe('DEEPSEEK_API_KEY') : null
      const hit = svc?.resolve ? await svc.resolve('DEEPSEEK_API_KEY') : undefined
      // Report only the shape of the resolved value, never its content.
      out.resolve = hit === undefined ? null : { source: hit.source, valueType: typeof hit.value, valueLength: String(hit.value ?? '').length }
      out.records = svc?.listRecords ? (await svc.listRecords()).map((r) => ({ key: String(r.key), kind: r.kind })) : null
    })
    .catch((error) => { out.error = String(error) })
    .finally(() => report({}))
}
