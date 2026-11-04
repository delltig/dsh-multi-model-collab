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
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
export declare const name = "multi-model-collab";
/** Hard dependencies: the tool registry and the provider-neutral model-call service. */
export declare const inject: string[];
/** Execution modes exposed by configuration and by the tool's `mode` argument. */
export type CollabMode = 'parallel' | 'primary_secondary';
/** Aggregation strategies exposed by configuration and by the `aggregate` argument. */
export type AggregateStrategy = 'all' | 'vote' | 'longest';
/** Loader-facing configuration; every field can be set from `cordis.yml` without touching code. */
export declare const Config: Schema<Schemastery.ObjectS<NoInfer<{
    models: Schema<string[], string[], "defined">;
    mode: Schema<"parallel" | "primary_secondary", "parallel" | "primary_secondary", "defined">;
    aggregate: Schema<"all" | "vote" | "longest", "all" | "vote" | "longest", "defined">;
    defaultProvider: Schema<string, string, "defined">;
    system: Schema<string, string, "defined">;
    temperature: Schema<number, number, "defined">;
    maxTokens: Schema<number, number, "defined">;
    perModelTimeoutMs: Schema<number, number, "defined">;
    toolTimeoutMs: Schema<number, number, "defined">;
    maxConcurrency: Schema<number, number, "defined">;
    clipChars: Schema<number, number, "defined">;
    includeUsage: Schema<boolean, boolean, "defined">;
    secondaryInstruction: Schema<string, string, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    models: Schema<string[], string[], "defined">;
    mode: Schema<"parallel" | "primary_secondary", "parallel" | "primary_secondary", "defined">;
    aggregate: Schema<"all" | "vote" | "longest", "all" | "vote" | "longest", "defined">;
    defaultProvider: Schema<string, string, "defined">;
    system: Schema<string, string, "defined">;
    temperature: Schema<number, number, "defined">;
    maxTokens: Schema<number, number, "defined">;
    perModelTimeoutMs: Schema<number, number, "defined">;
    toolTimeoutMs: Schema<number, number, "defined">;
    maxConcurrency: Schema<number, number, "defined">;
    clipChars: Schema<number, number, "defined">;
    includeUsage: Schema<boolean, boolean, "defined">;
    secondaryInstruction: Schema<string, string, "defined">;
}>>, "plain">;
/** Resolved plugin configuration after defaults are applied. */
export type CollabConfig = {
    models: string[];
    mode: CollabMode;
    aggregate: AggregateStrategy;
    defaultProvider: string;
    system: string;
    temperature: number;
    maxTokens: number;
    perModelTimeoutMs: number;
    toolTimeoutMs: number;
    maxConcurrency: number;
    clipChars: number;
    includeUsage: boolean;
    secondaryInstruction: string;
};
/**
 * Turn the loader-supplied configuration into a fully populated value.
 * @param raw - configuration resolved by the Loader, or a partial object in tests.
 * @returns Config with every field present and models de-duplicated.
 */
export declare function normalizeConfig(raw: unknown): CollabConfig;
/**
 * Register `multi_model_run` for the lifetime of this plugin.
 * @param ctx - plugin context; `tools` and `llm` are injected before this runs.
 * @param config - Loader-resolved configuration.
 */
export declare function apply(ctx: Context, config: CollabConfig): void;
