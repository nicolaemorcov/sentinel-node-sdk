import type { ExceptionRequest } from "./types";
import { getConfig } from "./config";

/**
 * Returns a random delay in milliseconds using full-jitter exponential backoff.
 * delay = random(0, base × 2^attempt)
 */
function backoffMs(base: number, attempt: number): number {
  const ceiling = base * Math.pow(2, attempt);
  return Math.floor(Math.random() * ceiling);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Asynchronously dispatches an exception payload to the Sentinel gateway.
 *
 * Uses native Node.js 18+ fetch — zero external dependencies.
 * Callers in hooks.ts and middleware.ts MUST NOT await this function.
 * All errors are caught internally and reported via console.warn; they
 * never propagate to the caller or the application.
 *
 * Retry policy:
 *   - Retries on 5xx responses and network/timeout errors.
 *   - 4xx responses are terminal — auth, quota, and repo-auth errors are
 *     not transient and must not be retried.
 *   - Each retry is preceded by a full-jitter exponential backoff delay.
 */
export async function dispatch(payload: ExceptionRequest): Promise<string | null> {
  const config = getConfig();

  if (!config.enabled) return null;

  // Runtime guard for Node 18.0–18.2 where fetch requires --experimental-fetch.
  if (typeof fetch === "undefined") {
    console.error(
      "[Sentinel] fetch is not available in this environment. " +
        "Node.js 18.3+ is required, or run Node 18.0–18.2 with the " +
        "--experimental-fetch flag. Exception not delivered."
    );
    return null;
  }

  const url = `${config.gatewayUrl}/api/v1/exceptions`;
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${config.apiKey}`,
  };

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        try {
          const data = await response.json() as Record<string, unknown>;
          const id = data["exception_id"];
          const exceptionId = typeof id === "string" ? id : null;
          if (exceptionId && config.onAccepted) {
            try { config.onAccepted(exceptionId); } catch { /* never propagate */ }
          }
          return exceptionId;
        } catch {
          return null;
        }
      }

      if (response.status >= 400 && response.status < 500) {
        // 4xx — terminal; do not retry.
        console.warn(
          `[Sentinel] Gateway rejected payload (HTTP ${response.status}). ` +
            "Check your apiKey, githubRepo, and account quota. No retry will be attempted."
        );
        return null;
      }

      // 5xx — retryable server error.
      console.warn(
        `[Sentinel] Gateway returned HTTP ${response.status}. ` +
          `Attempt ${attempt + 1} of ${config.maxRetries + 1}.`
      );
    } catch (err) {
      clearTimeout(timeoutId);

      const isAbort = err instanceof Error && err.name === "AbortError";
      const reason = isAbort
        ? `timeout after ${config.timeoutMs}ms`
        : String(err);

      console.warn(
        `[Sentinel] Dispatch error (${reason}). ` +
          `Attempt ${attempt + 1} of ${config.maxRetries + 1}.`
      );
    }

    // Wait before the next attempt (no delay after the final attempt).
    if (attempt < config.maxRetries) {
      await sleep(backoffMs(config.retryBackoffBase, attempt));
    }
  }

  console.warn(
    "[Sentinel] All retry attempts exhausted. Exception event not delivered to the gateway."
  );
  return null;
}
