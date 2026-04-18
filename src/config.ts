import type { SentinelConfig } from "./types";

const DISABLED_ENV_VALUES = new Set(["false", "0", "no", "off"]);

/**
 * Resolves the `enabled` flag from the explicit option or SENTINEL_ENABLED env var.
 * Any of false | 0 | no | off (case-insensitive) disables dispatch.
 */
function resolveEnabled(override?: boolean): boolean {
  if (override !== undefined) return override;
  const env = process.env["SENTINEL_ENABLED"];
  if (env !== undefined) return !DISABLED_ENV_VALUES.has(env.toLowerCase().trim());
  return true;
}

let _config: Readonly<SentinelConfig> | null = null;

/**
 * Configures the Sentinel SDK. Must be called once at application startup,
 * before installHook(), sentinelMiddleware, or withSentinel() are used.
 *
 * Configuration is process-global — one call covers the entire application.
 * Calling configure() a second time replaces the active configuration.
 *
 * @example
 * configure({
 *   apiKey:     process.env.SENTINEL_API_KEY!,
 *   githubRepo: "acme/payment-service",
 * });
 */
export function configure(
  options: Partial<SentinelConfig> & Pick<SentinelConfig, "apiKey" | "githubRepo">
): void {
  const built: SentinelConfig = {
    apiKey:           options.apiKey,
    githubRepo:       options.githubRepo,
    gatewayUrl:       options.gatewayUrl       ?? "https://nexuspartner.dev",
    timeoutMs:        options.timeoutMs         ?? 5000,
    maxRetries:       options.maxRetries        ?? 3,
    retryBackoffBase: options.retryBackoffBase  ?? 500,
    endpointLabel:    options.endpointLabel     ?? "<unknown>",
    enabled:          resolveEnabled(options.enabled),
    ...(options.onAccepted !== undefined && { onAccepted: options.onAccepted }),
  };
  _config = Object.freeze(built);

  console.info(
    `[Sentinel] SDK initialised. ` +
    `repo=${built.githubRepo} gateway=${built.gatewayUrl} enabled=${built.enabled}`
  );
}

/**
 * Returns the active frozen configuration object.
 * Throws if configure() has not yet been called.
 */
export function getConfig(): Readonly<SentinelConfig> {
  if (_config === null) {
    throw new Error(
      "Sentinel SDK: configure() must be called before use. " +
      "Call configure({ apiKey, githubRepo }) at application startup, " +
      "before installHook(), sentinelMiddleware, or withSentinel()."
    );
  }
  return _config;
}
