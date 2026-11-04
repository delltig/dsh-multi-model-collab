/**
 * Offline behavioural tests for dsh-multi-model-collab.
 *
 * These exercise the REAL compiled plugin (`lib/index.js`) with a fake
 * `ctx.llm`/`ctx.tools`, so tool registration, schema compilation, aggregation,
 * failure isolation, prompt construction and cancellation are all covered
 * without a network call. End-to-end proof against a live Harness profile lives
 * in verify/ and docs/runtime-install.md.
 *
 * Run: node test/run.mjs
 */
import assert from 'node:assert/strict'

import { apply, Config, normalizeConfig, name as pluginName } from '../lib/index.js'

let passed = 0
const failures = []

/**
 * Register one case.
 * @param {string} label - case name.
 * @param {() => Promise<void>} body - case body.
 */
async function test(label, body) {
  try {
    await body()
    passed += 1
    console.log(`  ok   ${label}`)
  } catch (error) {
    failures.push({ label, error })
    console.log(`  FAIL ${label}\n       ${error instanceof Error ? error.message.split('\n').join('\n       ') : String(error)}`)
  }
}

/**
 * Build a fake `ctx` whose `llm` answers from a per-route script.
 * @param {object} options - providers, catalogues, and route behaviours.
 * @returns fake context plus the captured tool and call log.
 */
function makeCtx({ providers, catalogues = {}, behaviours = {} }) {
  const calls = []
  let registered
  const ctx = {
    tools: {
      register(definition) {
        registered = definition
        return () => { registered = undefined }
      },
    },
    llm: {
      listProviders: () => providers.map(provider => ({ id: provider.id, name: provider.id })),
      listModels: async provider => (catalogues[provider] ?? []).map(id => ({ provider, id, name: id })),
      stream(options) {
        calls.push(options)
        const behaviour = behaviours[`${options.provider}/${options.model}`]
        if (behaviour === undefined) throw new Error(`no scripted behaviour for ${options.provider}/${options.model}`)
        return script(behaviour)
      },
    },
  }
  return { ctx, calls, tool: () => registered }
}

/**
 * Turn one scripted behaviour into an async chunk stream.
 * @param {object} behaviour - { text } | { throw } | { finish } | { delayMs }.
 * @returns AsyncIterable of chunks.
 */
async function* script(behaviour) {
  if (behaviour.delayMs !== undefined) await new Promise(resolve => setTimeout(resolve, behaviour.delayMs))
  if (behaviour.throw !== undefined) throw behaviour.throw
  const text = behaviour.text ?? ''
  if (behaviour.chunks !== undefined) {
    for (const piece of behaviour.chunks) yield { type: 'text-delta', index: 0, text: piece }
  } else if (text !== '') {
    yield { type: 'text-delta', index: 0, text }
  }
  if (behaviour.finish === 'error' || behaviour.finish === 'aborted') {
    yield { type: 'finish', reason: { kind: behaviour.finish, failure: { code: behaviour.code ?? 'PROVIDER_ERROR', message: behaviour.message ?? 'scripted failure' } } }
    return
  }
  yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/** Default resolved configuration straight from the plugin's own Loader schema. */
const defaults = Config({})

/**
 * Register the tool against a fake context and return it.
 * @param {object} fake - result of makeCtx.
 * @param {object} [overrides] - config overrides.
 * @returns the registered tool definition.
 */
function boot(fake, overrides = {}) {
  apply(fake.ctx, { ...defaults, ...overrides })
  const tool = fake.tool()
  assert.ok(tool !== undefined, 'apply() must register a tool')
  return tool
}

/** Minimal execution context accepted by the tool body. */
function exec(signal = new AbortController().signal) {
  return { signal, callId: 'call-1', name: 'multi_model_run', token: 'token-1' }
}

const PROVIDERS = [{ id: 'provider-a', models: ['model-a1', 'model-a2'] }, { id: 'provider-b', models: ['model-b1'] }]

console.log('\nplugin surface')
await test('module exports the Cordis plugin contract', () => {
  assert.equal(pluginName, 'multi-model-collab')
  assert.deepEqual(defaults.models, ['deepseek-official/deepseek-flash', 'deepseek-official/deepseek-v4-pro'])
  assert.equal(defaults.mode, 'parallel')
  assert.equal(defaults.aggregate, 'all')
  assert.ok(defaults.perModelTimeoutMs > 0)
})

await test('registers multi_model_run with a compiled, strict parameter schema', () => {
  const fake = makeCtx({ providers: PROVIDERS })
  const tool = boot(fake)
  assert.equal(tool.name, 'multi_model_run')
  assert.equal(tool.parameters.type, 'object')
  assert.deepEqual(tool.parameters.required, ['task'])
  assert.equal(tool.parameters.properties.task.type, 'string')
  assert.equal(tool.parameters.properties.models.type, 'array')
  assert.deepEqual(tool.parameters.properties.mode.enum, ['parallel', 'primary_secondary'])
  assert.equal(tool.output.schema.type, 'object')
  assert.equal(typeof tool.output.render, 'function')
})

await test('render() returns one readable text block', () => {
  const fake = makeCtx({ providers: PROVIDERS })
  const tool = boot(fake)
  const blocks = tool.output.render({ task: 'x' }, {
    task: 'x', mode: 'parallel', aggregate: 'all', models: ['provider-a/model-a1'], succeeded: 1, failed: 0,
    results: [{ provider: 'provider-a', model: 'model-a1', id: 'provider-a/model-a1', role: 'peer', status: 'ok', text: 'hello', clipped: false, chars: 5, durationMs: 1, error: null, usage: null }],
    answer: '', summary: 'mode=parallel',
  })
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'text')
  assert.match(blocks[0].text, /hello/)
  assert.match(blocks[0].text, /multi_model_run/)
})

console.log('\nparallel mode')
await test('runs every model and returns each answer verbatim', async () => {
  const fake = makeCtx({
    providers: PROVIDERS,
    behaviours: { 'provider-a/model-a1': { text: 'alpha' }, 'provider-b/model-b1': { text: 'beta' } },
  })
  const tool = boot(fake)
  const value = await tool.execute({ task: 'say hi', models: ['provider-a/model-a1', 'provider-b/model-b1'] }, exec())
  assert.equal(value.succeeded, 2)
  assert.equal(value.failed, 0)
  assert.deepEqual(value.results.map(result => result.text), ['alpha', 'beta'])
  assert.deepEqual(value.results.map(result => result.status), ['ok', 'ok'])
  assert.equal(value.answer, '')
  assert.match(value.summary, /ok=2 failed=0/)
  // every call carried the task and the caller signal
  assert.equal(fake.calls.length, 2)
  for (const call of fake.calls) {
    assert.deepEqual(call.messages, [{ role: 'user', content: [{ type: 'text', text: 'say hi' }] }])
    assert.ok(call.signal instanceof AbortSignal)
  }
})

await test('one failing model does not fail the call', async () => {
  const fake = makeCtx({
    providers: PROVIDERS,
    behaviours: {
      'provider-a/model-a1': { finish: 'error', code: 'AUTH', message: 'bad key' },
      'provider-b/model-b1': { text: 'beta' },
    },
  })
  const tool = boot(fake)
  const value = await tool.execute({ task: 'go', models: ['provider-a/model-a1', 'provider-b/model-b1'] }, exec())
  assert.equal(value.succeeded, 1)
  assert.equal(value.failed, 1)
  const failed = value.results.find(result => result.status === 'failed')
  assert.equal(failed.error.code, 'AUTH')
  assert.equal(failed.error.message, 'bad key')
  assert.equal(value.results.find(result => result.status === 'ok').text, 'beta')
})

await test('a thrown stream error is captured per model', async () => {
  const fake = makeCtx({
    providers: PROVIDERS,
    behaviours: {
      'provider-a/model-a1': { throw: Object.assign(new Error('socket closed'), { code: 'CONNECTION' }) },
      'provider-b/model-b1': { text: 'beta' },
    },
  })
  const tool = boot(fake)
  const value = await tool.execute({ task: 'go', models: ['provider-a/model-a1', 'provider-b/model-b1'] }, exec())
  assert.equal(value.results[0].status, 'failed')
  assert.equal(value.results[0].error.code, 'CONNECTION')
})

await test('every model failing rejects the tool call', async () => {
  const fake = makeCtx({
    providers: PROVIDERS,
    behaviours: {
      'provider-a/model-a1': { finish: 'error', code: 'RATE_LIMIT', message: 'slow down' },
      'provider-b/model-b1': { throw: new Error('boom') },
    },
  })
  const tool = boot(fake)
  await assert.rejects(
    () => tool.execute({ task: 'go', models: ['provider-a/model-a1', 'provider-b/model-b1'] }, exec()),
    error => {
      assert.equal(error.code, 'ALL_MODELS_FAILED')
      assert.match(error.message, /RATE_LIMIT/)
      assert.match(error.message, /boom/)
      return true
    },
  )
})

console.log('\naggregation')
await test('longest picks the largest surviving answer', async () => {
  const fake = makeCtx({
    providers: PROVIDERS,
    behaviours: { 'provider-a/model-a1': { text: 'short' }, 'provider-b/model-b1': { text: 'a considerably longer answer' } },
  })
  const tool = boot(fake)
  const value = await tool.execute({ task: 'go', models: ['provider-a/model-a1', 'provider-b/model-b1'], aggregate: 'longest' }, exec())
  assert.equal(value.answer, 'a considerably longer answer')
  assert.match(value.summary, /pick: longest answer from provider-b\/model-b1/)
})

await test('vote returns an outright normalized majority', async () => {
  const fake = makeCtx({
    providers: PROVIDERS,
    behaviours: {
      'provider-a/model-a1': { text: 'The answer is 42.' },
      'provider-b/model-b1': { text: 'the answer is 42' },
      'provider-a/model-a2': { text: 'Something else entirely' },
    },
  })
  const tool = boot(fake)
  const value = await tool.execute({
    task: 'go',
    models: ['provider-a/model-a1', 'provider-b/model-b1', 'provider-a/model-a2'],
    aggregate: 'vote',
  }, exec())
  assert.match(value.summary, /outright majority 2\/3/)
  assert.match(value.answer, /42/)
})

await test('vote falls back to the longest answer without a majority', async () => {
  const fake = makeCtx({
    providers: PROVIDERS,
    behaviours: { 'provider-a/model-a1': { text: 'one answer' }, 'provider-b/model-b1': { text: 'a different and longer answer' } },
  })
  const tool = boot(fake)
  const value = await tool.execute({ task: 'go', models: ['provider-a/model-a1', 'provider-b/model-b1'], aggregate: 'vote' }, exec())
  assert.match(value.summary, /no outright majority/)
  assert.equal(value.answer, 'a different and longer answer')
})

console.log('\nprimary/secondary mode')
await test('secondaries receive the primary draft and are labelled secondary', async () => {
  const fake = makeCtx({
    providers: PROVIDERS,
    behaviours: { 'provider-a/model-a1': { text: 'DRAFT-ANSWER' }, 'provider-b/model-b1': { text: 'reviewed' } },
  })
  const tool = boot(fake)
  const value = await tool.execute({ task: 'design a cache', models: ['provider-a/model-a1', 'provider-b/model-b1'], mode: 'primary_secondary' }, exec())
  assert.equal(value.results[0].role, 'primary')
  assert.equal(value.results[1].role, 'secondary')
  const reviewPrompt = fake.calls[1].messages[0].content[0].text
  assert.match(reviewPrompt, /design a cache/)
  assert.match(reviewPrompt, /Primary draft/)
  assert.match(reviewPrompt, /DRAFT-ANSWER/)
  assert.match(value.summary, /the first model drafted the answer/)
})

await test('a failed primary degrades to independent peer answers', async () => {
  const fake = makeCtx({
    providers: PROVIDERS,
    behaviours: {
      'provider-a/model-a1': { finish: 'error', code: 'NO_ADAPTER', message: 'nope' },
      'provider-b/model-b1': { text: 'independent' },
      'provider-a/model-a2': { text: 'also independent' },
    },
  })
  const tool = boot(fake)
  const value = await tool.execute({
    task: 'the task',
    models: ['provider-a/model-a1', 'provider-b/model-b1', 'provider-a/model-a2'],
    mode: 'primary_secondary',
  }, exec())
  assert.equal(value.results[0].status, 'failed')
  assert.deepEqual(value.results.slice(1).map(result => result.role), ['peer', 'peer'])
  for (const call of fake.calls.slice(1)) {
    assert.equal(call.messages[0].content[0].text, 'the task')
  }
})

console.log('\nmodel resolution')
await test('resolves a bare model id through the provider catalogue', async () => {
  const fake = makeCtx({
    providers: PROVIDERS,
    catalogues: { 'provider-a': ['model-a1', 'model-a2'], 'provider-b': ['model-b1'] },
    behaviours: { 'provider-a/model-a2': { text: 'ok' } },
  })
  const tool = boot(fake)
  const value = await tool.execute({ task: 'go', models: ['model-a2'] }, exec())
  assert.deepEqual(value.models, ['provider-a/model-a2'])
})

await test('uses defaultProvider for a bare model id', async () => {
  const fake = makeCtx({
    providers: PROVIDERS,
    behaviours: { 'provider-b/model-b1': { text: 'ok' } },
  })
  const tool = boot(fake, { defaultProvider: 'provider-b' })
  const value = await tool.execute({ task: 'go', models: ['model-b1'] }, exec())
  assert.deepEqual(value.models, ['provider-b/model-b1'])
})

await test('unknown model reference rejects with the configured route list', async () => {
  const fake = makeCtx({ providers: PROVIDERS, catalogues: { 'provider-a': ['model-a1'], 'provider-b': ['model-b1'] } })
  const tool = boot(fake)
  await assert.rejects(
    () => tool.execute({ task: 'go', models: ['nowhere'] }, exec()),
    error => {
      assert.match(error.message, /cannot resolve model reference/)
      assert.match(error.message, /provider-a\/model-a1/)
      return true
    },
  )
})

console.log('\nrobustness')
await test('clips long answers but reports the untruncated length', async () => {
  const long = 'x'.repeat(500)
  const fake = makeCtx({ providers: PROVIDERS, behaviours: { 'provider-a/model-a1': { text: long } } })
  const tool = boot(fake, { clipChars: 100 })
  const value = await tool.execute({ task: 'go', models: ['provider-a/model-a1'] }, exec())
  assert.equal(value.results[0].clipped, true)
  assert.equal(value.results[0].chars, 500)
  assert.ok(value.results[0].text.length < 500)
})

await test('rejects before dispatch when the caller already cancelled', async () => {
  const fake = makeCtx({ providers: PROVIDERS, behaviours: { 'provider-a/model-a1': { text: 'never' } } })
  const tool = boot(fake)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    () => tool.execute({ task: 'go', models: ['provider-a/model-a1'] }, exec(controller.signal)),
    error => {
      assert.equal(error.code, 'ABORTED')
      return true
    },
  )
  assert.equal(fake.calls.length, 0)
})

await test('an in-flight abort settles as a reported failure, then cancels the call', async () => {
  const controller = new AbortController()
  const fake = makeCtx({
    providers: PROVIDERS,
    behaviours: { 'provider-a/model-a1': { text: 'slow', delayMs: 50 }, 'provider-b/model-b1': { text: 'quick' } },
  })
  const tool = boot(fake)
  setTimeout(() => controller.abort(), 10)
  await assert.rejects(
    () => tool.execute({ task: 'go', models: ['provider-a/model-a1'] }, exec(controller.signal)),
    error => {
      assert.equal(error.code, 'ABORTED')
      return true
    },
  )
})

await test('a model that never sends a finish chunk is reported as a failure', async () => {
  const fake = makeCtx({
    providers: PROVIDERS,
    behaviours: { 'provider-a/model-a1': { text: 'has finish' }, 'provider-b/model-b1': { text: 'never finishes' } },
  })
  // Second route stops after text and emits no terminal finish chunk.
  const inner = fake.ctx.llm.stream
  fake.ctx.llm.stream = options => (options.provider === 'provider-b'
    ? (async function* () { yield { type: 'text-delta', index: 0, text: 'partial' } })()
    : inner(options))
  const tool = boot(fake)
  const value = await tool.execute({ task: 'go', models: ['provider-a/model-a1', 'provider-b/model-b1'] }, exec())
  assert.equal(value.succeeded, 1)
  assert.equal(value.results[1].status, 'failed')
  assert.equal(value.results[1].error.code, 'NO_FINISH')
})

await test('empty task is rejected clearly', async () => {
  const fake = makeCtx({ providers: PROVIDERS })
  const tool = boot(fake)
  await assert.rejects(() => tool.execute({ task: '   ', models: ['provider-a/model-a1'] }, exec()), /must not be empty/)
})

await test('normalizeConfig restores defaults from a partial row config', () => {
  const config = normalizeConfig({ mode: 'primary_secondary', aggregate: 'vote', models: [] })
  assert.equal(config.mode, 'primary_secondary')
  assert.equal(config.aggregate, 'vote')
  assert.equal(config.models.length, 2)
  assert.equal(config.maxConcurrency, 4)
})

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  for (const failure of failures) console.error(`\n${failure.label}\n${failure.error instanceof Error ? failure.error.stack : String(failure.error)}`)
  process.exit(1)
}
