import type { ExceptionRequest } from "./types";
import { getConfig } from "./config";
import { scrub, normalizeStackTrace } from "./scrubber";
import { dispatch } from "./dispatcher";

/**
 * Builds a scrubbed ExceptionRequest from a caught error and a resolved endpoint string.
 * Shared by both the Express middleware and the Next.js HOF.
 */
function buildPayload(reason: unknown, endpoint: string): ExceptionRequest {
  const timestamp = new Date().toISOString();
  const { githubRepo } = getConfig();

  if (reason instanceof Error) {
    return {
      exceptionType: reason.constructor.name || "Error",
      errorMessage:  scrub(reason.message),
      stackTrace:    normalizeStackTrace(scrub(reason.stack ?? reason.message)),
      endpoint,
      timestamp,
      githubRepo,
      language:      "typescript",
    };
  }

  const raw = scrub(String(reason));
  return {
    exceptionType: "UnknownError",
    errorMessage:  raw,
    stackTrace:    raw,
    endpoint,
    timestamp,
    githubRepo,
    language:      "typescript",
  };
}

// ─── Express ──────────────────────────────────────────────────────────────────

/**
 * Minimal structural type for the Express request fields Sentinel needs.
 * Avoids importing from 'express' so the compiled .d.ts files carry no
 * hard dependency on @types/express. Express's actual Request is structurally
 * compatible with this interface.
 */
interface ExpressRequest {
  /** Matched route path (e.g. "/api/orders/:id"), not the raw URL. */
  path: string;
}

/**
 * Express four-argument error-handler middleware.
 *
 * Register AFTER all routes, BEFORE any other error handlers:
 *   app.use(sentinelMiddleware);
 *
 * Behaviour:
 *   1. Extracts and scrubs the error.
 *   2. Dispatches to the gateway asynchronously (fire-and-forget).
 *   3. Calls next(err) — Sentinel NEVER swallows the error.
 *      All downstream error handlers and the default Express 500 response
 *      continue to run exactly as if Sentinel were not present.
 *
 * req.path is used (not req.url) to avoid including query strings, which
 * may contain user-supplied data or session tokens.
 */
export function sentinelMiddleware(
  err: unknown,
  req: ExpressRequest,
  _res: unknown,
  next: (err: unknown) => void
): void {
  const payload = buildPayload(err, req.path);
  // void: fire-and-forget — never block the response pipeline.
  void dispatch(payload);
  next(err);
}

// ─── Next.js App Router ───────────────────────────────────────────────────────

/**
 * Minimal structural type for the Next.js request fields Sentinel needs.
 * Compatible with NextRequest without importing from 'next/server'.
 */
interface NextRequestLike {
  url: string;
}

/**
 * Higher-order function that wraps a Next.js App Router route handler with
 * Sentinel exception capture.
 *
 * Works with any HTTP method handler (GET, POST, PUT, DELETE, etc.) and
 * supports both Request and NextRequest as the first argument.
 *
 * Usage:
 *   // app/api/orders/[id]/route.ts
 *   import { withSentinel } from "strictloop-node-sdk";
 *
 *   export const GET = withSentinel(async (req) => {
 *     const order = await fetchOrder(req);
 *     return Response.json(order);
 *   });
 *
 * Behaviour:
 *   1. Awaits the wrapped handler.
 *   2. On exception: scrubs → dispatches (fire-and-forget) → re-throws.
 *   3. Next.js's own error boundary (error.tsx, global-error.tsx) and
 *      any route segment error handling run unchanged. The client response
 *      is identical to a world without Sentinel.
 *
 * The endpoint is derived from the pathname of req.url. If URL parsing fails
 * (e.g. relative URL), it falls back to "<unknown>".
 */
export function withSentinel<TRequest extends Partial<NextRequestLike>, TResponse>(
  handler: (req: TRequest, ...args: unknown[]) => Promise<TResponse>
): (req: TRequest, ...args: unknown[]) => Promise<TResponse> {
  return async (req: TRequest, ...args: unknown[]): Promise<TResponse> => {
    try {
      return await handler(req, ...args);
    } catch (err) {
      // Derive a clean pathname from the full request URL.
      // NextRequest.url is always an absolute URL (e.g. "http://localhost:3000/api/orders/123").
      // We extract only the pathname to avoid capturing query strings or origins.
      let endpoint = "<unknown>";
      if (typeof req?.url === "string") {
        try {
          endpoint = new URL(req.url).pathname;
        } catch {
          // Malformed URL — leave as "<unknown>". Never throw from error path.
        }
      }

      const payload = buildPayload(err, endpoint);

      // Fire-and-forget: dispatch begins immediately. We do NOT await so that
      // the re-throw happens on the same event loop tick and Next.js error
      // handling is not delayed by network I/O.
      void dispatch(payload);

      // Re-throw unconditionally — Sentinel never swallows exceptions.
      throw err;
    }
  };
}
