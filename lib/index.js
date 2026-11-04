/**
 * dsh-multi-model-collab — one task, several models, one answer.
 *
 * Registers the `multi_model_run` tool. The tool re-uses the Harness `llm`
 * service (the only supported path into provider adapters, see
 * `@deepseek-ai/dsh-llm`) to fan one task out to several already-configured
 * models, then aggregates what came back:
 *
 * - `parallel`            every model answers the task independently, at once.
 * - `primary_secondary`   the first model answers; the rest critique and
 *                         complete that draft against the original task.
 *
 * Aggregation is `all` (verbatim results), `vote` (normalized majority), or
 * `longest` (largest surviving answer).
 *
 * Nothing here is provider-specific: models are addressed as
 * `"<provider>/<model>"` using the routes `ctx.llm.listProviders()` reports,
 * so no API key, endpoint, or model catalogue is hard-coded. One model failing
 * never fails the call; the failure is reported per model. The call fails only
 * when every model fails.
 *
 * @module dsh-multi-model-collab
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import Schema from '@deepseek-ai/schemastery';
export const name = 'multi-model-collab';
/** Hard dependencies: the tool registry and the provider-neutral model-call service. */
export const inject = ['tools', 'llm'];
/** Loader-facing configuration; every field can be set from `cordis.yml` without touching code. */
export const Config = Schema.object({
    models: Schema.array(Schema.string())
        .description('Default model list, each entry "<provider>/<model>" as reported by ctx.llm.listProviders(). '
        + 'The first entry is the primary model in primary_secondary mode.')
        .default(['deepseek-official/deepseek-flash', 'deepseek-official/deepseek-v4-pro']),
    mode: Schema.union(['parallel', 'primary_secondary'])
        .description('parallel: every model answers the task independently. primary_secondary: the first model drafts, the rest critique and complete it.')
        .default('parallel'),
    aggregate: Schema.union(['all', 'vote', 'longest'])
        .description('all: return every result verbatim. vote: normalized majority answer. longest: the longest surviving answer.')
        .default('all'),
    defaultProvider: Schema.string()
        .description('Provider route used for a model id written without a "<provider>/" prefix. Empty means "look the id up in every provider catalogue".')
        .default(''),
    system: Schema.string()
        .description('Optional system prompt sent to every model.')
        .default(''),
    temperature: Schema.number()
        .description('Sampling temperature sent to every model; a negative value sends no temperature at all.')
        .default(-1),
    maxTokens: Schema.number()
        .description('Output-token cap per model call; 0 sends no cap and lets the adapter default apply.')
        .default(0),
    perModelTimeoutMs: Schema.number()
        .description('Cancellation budget for one model call.')
        .default(180000),
    toolTimeoutMs: Schema.number()
        .description('Cooperative budget for the whole tool call; 0 leaves the registry default in place.')
        .default(900000),
    maxConcurrency: Schema.number()
        .description('How many model calls may be in flight at once.')
        .default(4),
    clipChars: Schema.number()
        .description('Clip each returned answer to this many characters; 0 returns answers in full.')
        .default(12000),
    includeUsage: Schema.boolean()
        .description('Include per-model token usage in the returned result when the adapter reports it.')
        .default(true),
    secondaryInstruction: Schema.string()
        .description('In primary_secondary mode, what the secondary models are asked to do with the primary draft.')
        .default('审阅上面这份草稿：指出其中事实性错误、遗漏或推理跳跃，然后给出你修正后的完整最终答案。'
        + '如果草稿已经完全正确，请明确说明"同意"，并补充任何它遗漏的关键信息。'
        + ' Review the draft above for factual errors, omissions, or weak reasoning, then give your corrected complete final answer.'),
});
const DEFAULT_TOOL_TIMEOUT_MS = 900000;
/**
 * Turn the loader-supplied configuration into a fully populated value.
 * @param raw - configuration resolved by the Loader, or a partial object in tests.
 * @returns Config with every field present and models de-duplicated.
 */
export function normalizeConfig(raw) {
    const input = (raw ?? {});
    const config = {
        models: dedupe([...(input.models ?? [])].map(entry => entry.trim()).filter(entry => entry !== '')),
        mode: input.mode === 'primary_secondary' ? 'primary_secondary' : 'parallel',
        aggregate: input.aggregate === 'vote' || input.aggregate === 'longest' ? input.aggregate : 'all',
        defaultProvider: (input.defaultProvider ?? '').trim(),
        system: input.system ?? '',
        temperature: finiteOr(input.temperature, -1),
        maxTokens: finiteOr(input.maxTokens, 0),
        perModelTimeoutMs: positiveOr(input.perModelTimeoutMs, 180000),
        toolTimeoutMs: finiteOr(input.toolTimeoutMs, DEFAULT_TOOL_TIMEOUT_MS),
        maxConcurrency: Math.max(1, Math.floor(positiveOr(input.maxConcurrency, 4))),
        clipChars: Math.max(0, Math.floor(finiteOr(input.clipChars, 12000))),
        includeUsage: input.includeUsage !== false,
        secondaryInstruction: typeof input.secondaryInstruction === 'string' && input.secondaryInstruction.trim() !== ''
            ? input.secondaryInstruction
            : '',
    };
    if (config.models.length === 0) {
        config.models = ['deepseek-official/deepseek-flash', 'deepseek-official/deepseek-v4-pro'];
    }
    return config;
}
/**
 * Register `multi_model_run` for the lifetime of this plugin.
 * @param ctx - plugin context; `tools` and `llm` are injected before this runs.
 * @param config - Loader-resolved configuration.
 */
export function apply(ctx, config) {
    const resolved = normalizeConfig(config);
    const timeoutMs = resolved.toolTimeoutMs > 0 ? resolved.toolTimeoutMs : undefined;
    const tool = defineTool({
        name: 'multi_model_run',
        description: 'Run ONE task through several large models at the same time and return each model\'s independent answer plus an aggregated digest. '
            + 'Use it when a second opinion, cross-provider agreement, or a primary/secondary review materially improves the answer: '
            + 'high-stakes decisions, ambiguous requirements, design or architecture choices, code review, fact-checking, and anything where '
            + 'models are likely to disagree. For routine single-step work a normal answer is cheaper and faster. '
            + 'Models are addressed as "<provider>/<model>" from the configured providers; omit `models` to use the profile default set. '
            + 'A failing model is reported as failed without failing the call; the call fails only when every model fails.',
        parameters: {
            task: {
                type: 'string',
                required: true,
                description: 'The complete task or question each model must answer. Include all context the models need; they do not see this conversation.',
            },
            models: {
                type: 'array',
                items: { type: 'string' },
                description: 'Model routes to use, e.g. ["deepseek-official/deepseek-flash", "deepseek-official/deepseek-v4-pro"]. Omit to use the configured default set. The first entry is the primary model in primary_secondary mode.',
            },
            mode: {
                type: 'string',
                enum: ['parallel', 'primary_secondary'],
                description: 'Override the configured execution mode for this call.',
            },
            aggregate: {
                type: 'string',
                enum: ['all', 'vote', 'longest'],
                description: 'Override the configured aggregation strategy for this call.',
            },
            system: {
                type: 'string',
                description: 'Override the configured system prompt for this call.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    task: { type: 'string', required: true },
                    mode: { type: 'string', enum: ['parallel', 'primary_secondary'], required: true },
                    aggregate: { type: 'string', enum: ['all', 'vote', 'longest'], required: true },
                    models: { type: 'array', items: { type: 'string' }, required: true },
                    succeeded: { type: 'integer', required: true },
                    failed: { type: 'integer', required: true },
                    results: {
                        type: 'array',
                        required: true,
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                provider: { type: 'string', required: true },
                                model: { type: 'string', required: true },
                                id: { type: 'string', required: true },
                                role: { type: 'string', enum: ['primary', 'secondary', 'peer'], required: true },
                                status: { type: 'string', enum: ['ok', 'failed'], required: true },
                                text: { type: 'string', required: true },
                                clipped: { type: 'boolean', required: true },
                                chars: { type: 'integer', required: true },
                                durationMs: { type: 'integer', required: true },
                                error: {
                                    required: true,
                                    oneOf: [
                                        {
                                            type: 'object',
                                            additionalProperties: false,
                                            properties: {
                                                code: { type: 'string', required: true },
                                                message: { type: 'string', required: true },
                                            },
                                        },
                                        { type: 'null' },
                                    ],
                                },
                                usage: {
                                    required: true,
                                    oneOf: [
                                        {
                                            type: 'object',
                                            additionalProperties: false,
                                            properties: {
                                                inputTokens: { type: 'integer', required: true },
                                                outputTokens: { type: 'integer', required: true },
                                                totalTokens: { type: 'integer', required: true },
                                                cacheReadTokens: { type: 'integer' },
                                                cacheWriteTokens: { type: 'integer' },
                                                reasoningTokens: { type: 'integer' },
                                            },
                                        },
                                        { type: 'null' },
                                    ],
                                },
                            },
                        },
                    },
                    answer: { type: 'string', required: true },
                    summary: { type: 'string', required: true },
                },
            },
            render: (_args, value) => renderResult(value),
        },
        isConcurrencySafe: () => true,
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
        async execute(args, exec) {
            return runCollab(ctx, resolved, args, exec);
        },
    });
    ctx.tools.register(tool);
}
/**
 * Execute one multi-model run.
 * @param ctx - plugin context providing `llm`.
 * @param config - resolved configuration.
 * @param args - validated tool arguments.
 * @param exec - execution identity and caller cancellation.
 * @returns the canonical tool value.
 */
async function runCollab(ctx, config, args, exec) {
    const task = args.task.trim();
    if (task === '')
        throw new Error('multi_model_run: `task` must not be empty');
    const mode = args.mode ?? config.mode;
    const aggregate = args.aggregate ?? config.aggregate;
    const system = args.system ?? config.system;
    const requested = args.models !== undefined && args.models.length > 0 ? [...args.models] : config.models;
    if (requested.length === 0) {
        throw new Error('multi_model_run: no models configured — set `models` on the plugin row or pass `models` to the tool');
    }
    const providers = ctx.llm.listProviders();
    if (providers.length === 0) {
        throw new Error('multi_model_run: no LLM provider is configured in this profile, so no model can be called');
    }
    const routes = await resolveRoutes(ctx, requested, config.defaultProvider);
    const modelIds = routes.map(route => `${route.provider}/${route.model}`);
    const started = Date.now();
    const results = await executeMode(ctx, config, mode, routes, { task, system }, exec.signal);
    const { digest, answer } = summarize(config, mode, aggregate, results, started);
    const succeeded = results.filter(result => result.status === 'ok').length;
    const failed = results.length - succeeded;
    if (exec.signal.aborted && succeeded === 0) {
        const cancelled = new Error('multi_model_run: cancelled by the caller before any model answered');
        cancelled.code = 'ABORTED';
        throw cancelled;
    }
    if (succeeded === 0) {
        const reasons = results.map(result => `${result.id}: ${result.error?.code ?? 'ERROR'} ${result.error?.message ?? ''}`.trim()).join('; ');
        const error = new Error(`multi_model_run: every model failed (${failed}/${results.length}) — ${reasons}`);
        error.code = 'ALL_MODELS_FAILED';
        throw error;
    }
    return {
        task,
        mode,
        aggregate,
        models: modelIds,
        succeeded,
        failed,
        results,
        answer,
        summary: digest,
    };
}
/**
 * Run the selected mode over the resolved routes.
 * @param ctx - plugin context providing `llm`.
 * @param config - resolved configuration.
 * @param mode - execution mode.
 * @param routes - resolved routes, primary first.
 * @param request - task text and system prompt.
 * @param signal - caller cancellation.
 * @returns one result per route, in route order.
 */
async function executeMode(ctx, config, mode, routes, request, signal) {
    const [primary, ...rest] = routes;
    if (primary === undefined)
        return [];
    if (mode === 'primary_secondary' && rest.length > 0) {
        const primaryResult = await callModel(ctx, config, primary, request.task, request.system, 'primary', signal);
        if (primaryResult.status !== 'ok') {
            // Without a draft there is nothing to review; fall back to independent
            // answers so one broken model does not silently degrade the call.
            const peers = await mapLimit(rest, config.maxConcurrency, route => callModel(ctx, config, route, request.task, request.system, 'peer', signal));
            return [primaryResult, ...peers];
        }
        const reviewPrompt = buildReviewPrompt(request.task, primaryResult.text, config.secondaryInstruction);
        const reviewers = await mapLimit(rest, config.maxConcurrency, route => callModel(ctx, config, route, reviewPrompt, request.system, 'secondary', signal));
        return [primaryResult, ...reviewers];
    }
    const settled = await mapLimit(routes, config.maxConcurrency, route => callModel(ctx, config, route, request.task, request.system, mode === 'primary_secondary' ? 'primary' : 'peer', signal));
    return settled;
}
/**
 * Call one model and normalize its outcome; never throws for a model failure.
 * @param ctx - plugin context providing `llm`.
 * @param config - resolved configuration.
 * @param route - provider and model to call.
 * @param prompt - user prompt for this call.
 * @param system - system prompt, or '' for none.
 * @param role - role this call plays in the current mode.
 * @param signal - caller cancellation.
 * @returns a success or failure result.
 */
async function callModel(ctx, config, route, prompt, system, role, signal) {
    const id = `${route.provider}/${route.model}`;
    const started = Date.now();
    const base = { provider: route.provider, model: route.model, id, role };
    if (signal.aborted) {
        return {
            ...base,
            status: 'failed',
            text: '',
            clipped: false,
            chars: 0,
            durationMs: 0,
            error: { code: 'ABORTED', message: 'the tool call was cancelled before this model was dispatched' },
            usage: null,
        };
    }
    const budget = createBudget(signal, config.perModelTimeoutMs);
    try {
        const options = {
            provider: route.provider,
            model: route.model,
            messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
            signal: budget.signal,
            ...(system === '' ? {} : { system }),
            ...(config.temperature < 0 ? {} : { temperature: config.temperature }),
            ...(config.maxTokens > 0 ? { maxTokens: config.maxTokens } : {}),
        };
        const collected = await collectStream(ctx.llm.stream(options), budget.signal);
        const { text, clipped } = clip(collected.text, config.clipChars);
        return {
            ...base,
            status: 'ok',
            text,
            clipped,
            chars: Array.from(collected.text).length,
            durationMs: Date.now() - started,
            error: null,
            usage: config.includeUsage ? collected.usage : null,
        };
    }
    catch (error) {
        const failure = describeFailure(error, budget);
        return {
            ...base,
            status: 'failed',
            text: '',
            clipped: false,
            chars: 0,
            durationMs: Date.now() - started,
            error: failure,
            usage: null,
        };
    }
    finally {
        budget.dispose();
    }
}
/**
 * Drain one chunk stream into text plus the last reported usage.
 * @param chunks - the chunk iterable returned by `ctx.llm.stream`.
 * @param signal - combined cancellation signal.
 * @returns accumulated text, usage, and the terminal reason.
 */
async function collectStream(chunks, signal) {
    const parts = [];
    let usage = null;
    let terminal = null;
    for await (const chunk of chunks) {
        if (signal.aborted)
            break;
        switch (chunk.type) {
            case 'text-delta':
                if (typeof chunk.text === 'string')
                    parts.push(chunk.text);
                break;
            case 'usage': {
                const raw = chunk.usage;
                if (raw !== undefined) {
                    usage = {
                        inputTokens: raw.inputTokens ?? 0,
                        outputTokens: raw.outputTokens ?? 0,
                        totalTokens: raw.totalTokens ?? (raw.inputTokens ?? 0) + (raw.outputTokens ?? 0),
                        ...(raw.cacheReadTokens === undefined ? {} : { cacheReadTokens: raw.cacheReadTokens }),
                        ...(raw.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: raw.cacheWriteTokens }),
                        ...(raw.reasoningTokens === undefined ? {} : { reasoningTokens: raw.reasoningTokens }),
                    };
                }
                break;
            }
            case 'finish': {
                const reason = chunk.reason;
                terminal = reason ?? null;
                break;
            }
            default:
                break;
        }
    }
    if (terminal !== null && (terminal.kind === 'error' || terminal.kind === 'aborted')) {
        const failure = terminal.failure;
        const error = new Error(failure?.message ?? `the model call ended with "${terminal.kind}"`);
        error.code = failure?.code ?? terminal.kind.toUpperCase();
        throw error;
    }
    if (signal.aborted) {
        const error = new Error('the model call was cancelled');
        error.code = 'ABORTED';
        throw error;
    }
    if (terminal === null) {
        const error = new Error('the model call ended without a terminal finish chunk');
        error.code = 'NO_FINISH';
        throw error;
    }
    return { text: parts.join(''), usage };
}
/**
 * Build the cancellation state for one model call: the caller signal fused
 * with a per-model deadline, plus the timeout's own signal for classification.
 * @param parent - caller cancellation.
 * @param timeoutMs - per-model budget; a non-positive value disables the deadline.
 * @returns the fused signal and a disposer that clears the timer.
 */
function createBudget(parent, timeoutMs) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            controller.abort(new Error(`model call exceeded ${timeoutMs} ms`));
        }, timeoutMs)
        : undefined;
    if (timer !== undefined && typeof timer.unref === 'function')
        timer.unref();
    const signal = typeof AbortSignal.any === 'function'
        ? AbortSignal.any([parent, controller.signal])
        : controller.signal;
    return {
        signal,
        timedOut: () => timedOut,
        dispose: () => {
            if (timer !== undefined)
                clearTimeout(timer);
        },
    };
}
/**
 * Normalize one thrown model failure into the reported error pair.
 * @param error - whatever the stream or adapter threw.
 * @param budget - the call's cancellation budget, for classification.
 * @returns a stable code and message.
 */
function describeFailure(error, budget) {
    if (budget.timedOut())
        return { code: 'TIMEOUT', message: error instanceof Error ? error.message : String(error) };
    if (budget.signal.aborted)
        return { code: 'ABORTED', message: error instanceof Error ? error.message : 'the call was cancelled' };
    const code = typeof error.code === 'string' ? error.code : 'MODEL_ERROR';
    const message = error instanceof Error ? error.message : String(error);
    return { code, message };
}
/**
 * Resolve user-configured model references against the live provider registry.
 * @param ctx - plugin context providing `llm`.
 * @param specs - model references, with or without a provider prefix.
 * @param defaultProvider - provider used for an unprefixed reference.
 * @returns resolved routes, in the caller's order, de-duplicated.
 */
async function resolveRoutes(ctx, specs, defaultProvider) {
    const routes = [];
    const seen = new Set();
    const unresolved = [];
    let catalog;
    for (const raw of specs) {
        const spec = raw.trim();
        if (spec === '')
            continue;
        const slash = spec.indexOf('/');
        let route;
        if (slash > 0 && slash < spec.length - 1) {
            route = { provider: spec.slice(0, slash), model: spec.slice(slash + 1) };
        }
        else if (defaultProvider !== '') {
            route = { provider: defaultProvider, model: spec };
        }
        else {
            catalog ??= await readCatalog(ctx);
            const matches = catalog.filter(entry => entry.models.some(model => model.id === spec));
            if (matches.length > 0)
                route = { provider: matches[0].provider, model: spec };
        }
        if (route === undefined) {
            unresolved.push(spec);
            continue;
        }
        const key = `${route.provider}/${route.model}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        routes.push(route);
    }
    if (unresolved.length > 0) {
        catalog ??= await readCatalog(ctx);
        const available = catalog
            .map(entry => (entry.models.length === 0 ? `${entry.provider}/(catalogue unavailable)` : entry.models.map(model => `${entry.provider}/${model.id}`).join(', ')))
            .join('; ');
        throw new Error(`multi_model_run: cannot resolve model reference(s) ${unresolved.map(entry => JSON.stringify(entry)).join(', ')} — `
            + `write "<provider>/<model>" or set \`defaultProvider\`. Configured routes: ${available}`);
    }
    if (routes.length === 0) {
        throw new Error('multi_model_run: no usable model reference was supplied');
    }
    return routes;
}
/**
 * Read every provider's advertised model catalogue, tolerating a provider that
 * cannot answer (its catalogue stays empty but the provider is still listed).
 * @param ctx - plugin context providing `llm`.
 * @returns provider id plus advertised models, in registration order.
 */
async function readCatalog(ctx) {
    const providers = ctx.llm.listProviders();
    const catalog = [];
    for (const provider of providers) {
        try {
            catalog.push({ provider: provider.id, models: [...await ctx.llm.listModels(provider.id)] });
        }
        catch {
            catalog.push({ provider: provider.id, models: [] });
        }
    }
    return catalog;
}
/**
 * Compose the secondary review prompt from the original task and the draft.
 * @param task - the original task text.
 * @param draft - the primary model's answer.
 * @param instruction - configured review instruction.
 * @returns the prompt sent to every secondary model.
 */
function buildReviewPrompt(task, draft, instruction) {
    return [
        '# 原始任务 Original task',
        task,
        '',
        '# 主模型草稿 Primary draft',
        draft,
        '',
        '# 你的任务 Your task',
        instruction,
    ].join('\n');
}
/**
 * Pick the winning answer and build the human-readable digest.
 * @param config - resolved configuration.
 * @param mode - execution mode that ran.
 * @param aggregate - aggregation strategy to apply.
 * @param results - per-model outcomes, primary first.
 * @param startedAt - wall-clock start of the run.
 * @returns the selected answer ('' for `all`) and the digest text.
 */
function summarize(config, mode, aggregate, results, startedAt) {
    const ok = results.filter(result => result.status === 'ok');
    const failed = results.filter(result => result.status === 'failed');
    const lines = [];
    lines.push(`mode=${mode} aggregate=${aggregate} models=${results.length} ok=${ok.length} failed=${failed.length} elapsed=${Date.now() - startedAt}ms`);
    for (const result of results) {
        if (result.status === 'ok') {
            const tokens = result.usage === null ? '' : `, tokens ${result.usage.inputTokens}→${result.usage.outputTokens}`;
            lines.push(`- OK   ${result.id} [${result.role}] ${result.chars} chars, ${result.durationMs}ms${tokens}${result.clipped ? ', clipped' : ''}`);
        }
        else {
            lines.push(`- FAIL ${result.id} [${result.role}] ${result.error?.code ?? 'ERROR'}: ${result.error?.message ?? ''}`);
        }
    }
    let answer = '';
    if (aggregate === 'longest') {
        const winner = ok.reduce((best, current) => (best === undefined || current.chars > best.chars ? current : best), undefined);
        if (winner !== undefined) {
            answer = winner.text;
            lines.push(`- pick: longest answer from ${winner.id}`);
        }
    }
    else if (aggregate === 'vote') {
        const groups = new Map();
        for (const result of ok) {
            const key = normalizeForVote(result.text);
            const group = groups.get(key);
            if (group === undefined)
                groups.set(key, { text: result.text, members: [result.id] });
            else
                group.members.push(result.id);
        }
        const ranked = [...groups.values()].sort((left, right) => right.members.length - left.members.length);
        const top = ranked[0];
        if (top !== undefined && ok.length > 1 && top.members.length > ok.length / 2) {
            answer = top.text;
            lines.push(`- pick: outright majority ${top.members.length}/${ok.length} — ${top.members.join(', ')}`);
        }
        else if (top !== undefined) {
            const longest = ok.reduce((best, current) => (current.chars > best.chars ? current : best), ok[0]);
            answer = longest.text;
            lines.push(`- pick: no outright majority (largest agreement ${top.members.length}/${ok.length}); fell back to the longest answer from ${longest.id}`);
        }
    }
    else {
        lines.push('- pick: none — aggregate=all returns every answer verbatim');
    }
    if (mode === 'primary_secondary') {
        lines.push('- note: the first model drafted the answer; the others reviewed and completed that draft, and their text is a critique-and-correction rather than an independent answer');
    }
    if (config.clipChars > 0 && results.some(result => result.clipped)) {
        lines.push(`- note: per-model text clipped to ${config.clipChars} characters; the full length is reported in each result's \`chars\` field`);
    }
    return { digest: lines.join('\n'), answer };
}
/**
 * Render the canonical value as the Markdown the calling model actually reads.
 * @param value - validated canonical tool value.
 * @returns one text content block.
 */
function renderResult(value) {
    const lines = [];
    lines.push(`## multi_model_run — ${value.mode} / ${value.aggregate}`);
    lines.push('');
    lines.push(`**task**: ${firstLine(value.task)}`);
    lines.push('');
    lines.push(`**models**: ${value.models.join(', ')} — ${value.succeeded} succeeded, ${value.failed} failed`);
    lines.push('');
    for (const result of value.results) {
        if (result.status === 'ok') {
            lines.push(`### ${result.id} — ok (${result.durationMs}ms, ${result.chars} chars${result.clipped ? ', clipped' : ''})`);
            lines.push('');
            lines.push(result.text);
            lines.push('');
        }
        else {
            lines.push(`### ${result.id} — FAILED (${result.durationMs}ms)`);
            lines.push('');
            lines.push('```text');
            lines.push(`${result.error?.code ?? 'ERROR'}: ${result.error?.message ?? ''}`);
            lines.push('```');
            lines.push('');
        }
    }
    lines.push('## aggregate');
    lines.push('');
    lines.push('```text');
    lines.push(value.summary);
    lines.push('```');
    if (value.answer !== '') {
        lines.push('');
        lines.push('## selected answer');
        lines.push('');
        lines.push(value.answer);
    }
    return [{ type: 'text', text: lines.join('\n') }];
}
/**
 * Run `worker` over `items` with a bounded number of concurrent calls.
 * @param items - inputs to process.
 * @param limit - maximum concurrent workers.
 * @param worker - async worker.
 * @returns results in input order.
 */
async function mapLimit(items, limit, worker) {
    const results = new Array(items.length);
    let cursor = 0;
    const width = Math.max(1, Math.min(limit, items.length));
    const runners = [];
    for (let index = 0; index < width; index += 1) {
        runners.push((async () => {
            for (;;) {
                const current = cursor;
                cursor += 1;
                if (current >= items.length)
                    return;
                results[current] = await worker(items[current]);
            }
        })());
    }
    await Promise.all(runners);
    return results;
}
/**
 * Clip one answer to a character budget without splitting a surrogate pair.
 * @param text - full answer.
 * @param limit - maximum characters; a non-positive value keeps everything.
 * @returns the possibly-clipped text and whether clipping happened.
 */
function clip(text, limit) {
    if (limit <= 0)
        return { text, clipped: false };
    const points = Array.from(text);
    if (points.length <= limit)
        return { text, clipped: false };
    return { text: `${points.slice(0, limit).join('')}\n\n…[clipped ${points.length - limit} characters]`, clipped: true };
}
/**
 * Normalize an answer so that cosmetic differences do not defeat a vote.
 * @param text - model answer.
 * @returns a comparison key.
 */
function normalizeForVote(text) {
    return text
        .toLowerCase()
        .replace(/[\s\u3000]+/g, ' ')
        .replace(/[`*_#>|~-]+/g, ' ')
        .replace(/[\p{P}\p{S}]/gu, '')
        .trim();
}
/**
 * First non-empty line of a block of text, clipped for one-line display.
 * @param text - source text.
 * @returns a short single line.
 */
function firstLine(text) {
    const line = text.split(/\r?\n/).find(entry => entry.trim() !== '') ?? text;
    return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}
/** De-duplicate strings while preserving first-seen order. */
function dedupe(values) {
    return [...new Set(values)];
}
/** Coerce to a finite number, or fall back. */
function finiteOr(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
/** Coerce to a strictly positive finite number, or fall back. */
function positiveOr(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}
