/**
 * Shared TypeScript interfaces for the Sentinel Node SDK.
 * No imports from other SDK modules — this file is the dependency root.
 */

/**
 * The exact JSON body POSTed to POST /api/v1/exceptions.
 * Field names and values must match the gateway's ExceptionRequest model precisely.
 */
export interface ExceptionRequest {
  /** e.g. "TypeError", "RangeError", "PaymentError" */
  exceptionType: string;
  /** PII-scrubbed error.message */
  errorMessage:  string;
  /** PII-scrubbed error.stack — full depth, never truncated */
  stackTrace:    string;
  /** HTTP route path or a configurable process label */
  endpoint:      string;
  /** ISO 8601 UTC, e.g. "2026-04-10T12:00:00.000Z" */
  timestamp:     string;
  /** GitHub repository in "owner/repo" format */
  githubRepo:    string;
  /**
   * Hard-coded to "typescript". Routes the Kafka message to the TypeScript-aware
   * AI workflow (V8 frame parser, Jest test generation). Never overridable by callers.
   */
  language:      "typescript";
}

/**
 * SDK configuration. All fields have defaults except apiKey and githubRepo,
 * which are required at configure() time.
 */
export interface SentinelConfig {
  /** Plaintext Bearer token from the Sentinel portal. Never logged. */
  apiKey:           string;
  /** GitHub repository in "owner/repo" format — must match the gateway allowlist. */
  githubRepo:       string;
  /** Override for staging or self-hosted deployments. Default: "https://nexuspartner.dev" */
  gatewayUrl:       string;
  /** Per-attempt HTTP timeout in milliseconds. Default: 5000 */
  timeoutMs:        number;
  /** Maximum send attempts before giving up. 4xx responses are not retried. Default: 3 */
  maxRetries:       number;
  /**
   * Exponential backoff base in milliseconds.
   * Actual delay = random(0, base × 2^attempt) — full jitter.
   * Default: 500
   */
  retryBackoffBase: number;
  /**
   * Default endpoint label for hook-captured exceptions (process.on handlers).
   * Express and Next.js integrations override this automatically with the route path.
   * Default: "<unknown>"
   */
  endpointLabel:    string;
  /**
   * Set false (or SENTINEL_ENABLED=false env var) to suppress all network I/O.
   * Useful in test environments and CI. Default: true
   */
  enabled:          boolean;
  /**
   * Optional callback invoked after the gateway accepts an exception (HTTP 2xx).
   * Receives the exception_id returned by the gateway — use it to correlate
   * Sentinel records with your own observability or to store the ID for
   * Portal-mediated fix approval workflows.
   * Called asynchronously; errors thrown inside are caught and logged.
   */
  onAccepted?:      (exceptionId: string) => void;
}
