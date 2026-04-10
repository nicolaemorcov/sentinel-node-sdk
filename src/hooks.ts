import type { ExceptionRequest } from "./types";
import { getConfig } from "./config";
import { scrub } from "./scrubber";
import { dispatch } from "./dispatcher";

// Idempotency guard — prevents duplicate listener registration.
let _installed = false;

/**
 * Builds a scrubbed ExceptionRequest from any thrown value.
 * Handles both Error instances and non-Error rejection reasons
 * (strings, numbers, plain objects) that arrive via unhandledRejection.
 */
function buildPayload(reason: unknown, endpointLabel: string): ExceptionRequest {
  const timestamp = new Date().toISOString();
  const { githubRepo } = getConfig();

  if (reason instanceof Error) {
    return {
      exceptionType: reason.constructor.name || "Error",
      errorMessage:  scrub(reason.message),
      // error.stack includes the message line; send the full depth for RAG context scoring.
      stackTrace:    scrub(reason.stack ?? reason.message),
      endpoint:      endpointLabel,
      timestamp,
      githubRepo,
      language:      "typescript",
    };
  }

  // Non-Error rejection value (string thrown, rejected with a number, etc.)
  const raw = scrub(String(reason));
  return {
    exceptionType: "UnhandledRejection",
    errorMessage:  raw,
    stackTrace:    raw,
    endpoint:      endpointLabel,
    timestamp,
    githubRepo,
    language:      "typescript",
  };
}

/**
 * Installs Sentinel as the global last-resort exception catcher for the process.
 * Registers handlers for both uncaughtException and unhandledRejection.
 *
 * Idempotent — calling installHook() more than once has no effect.
 * configure() must be called before installHook().
 *
 * IMPORTANT — fire-and-forget by design:
 * dispatch() returns a Promise that is intentionally not awaited. Node.js
 * terminates the process after all synchronous uncaughtException listeners
 * return; awaiting dispatch() would defer beyond that point. The
 * fire-and-forget Promise begins executing before process exit and will
 * deliver the event on a best-effort basis.
 *
 * @example
 * configure({ apiKey: process.env.SENTINEL_API_KEY!, githubRepo: "acme/svc" });
 * installHook();
 */
export function installHook(): void {
  if (_installed) return;
  _installed = true;

  // Eagerly validate that configure() was called. Throws immediately with a
  // clear message if not, rather than silently failing at exception time.
  const { endpointLabel } = getConfig();

  process.on("uncaughtException", (error: Error) => {
    // Build the payload synchronously so scrubbing and field extraction complete
    // before Node.js initiates process exit after this listener returns.
    const payload = buildPayload(error, endpointLabel);

    // void: intentionally not awaited — fire-and-forget before process exit.
    void dispatch(payload);
  });

  process.on("unhandledRejection", (reason: unknown) => {
    const payload = buildPayload(reason, endpointLabel);

    // void: intentionally not awaited.
    void dispatch(payload);
  });
}
