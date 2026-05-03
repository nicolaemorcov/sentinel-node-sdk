/**
 * strictloop-node-sdk — Public API surface.
 *
 * This file re-exports only. No logic lives here.
 * Internal modules (scrubber, dispatcher) are intentionally not exported.
 *
 * Quick-start:
 *
 *   import { configure, installHook, sentinelMiddleware, withSentinel } from "strictloop-node-sdk";
 *
 *   // 1. Configure once at startup (required before any other call)
 *   configure({
 *     apiKey:     process.env.SENTINEL_API_KEY!,
 *     githubRepo: "acme/payment-service",
 *   });
 *
 *   // 2a. Global hook — catches process-level uncaughtException + unhandledRejection
 *   installHook();
 *
 *   // 2b. Express — register after all routes
 *   app.use(sentinelMiddleware);
 *
 *   // 2c. Next.js App Router — wrap individual route handlers
 *   export const GET = withSentinel(async (req) => { ... });
 */

export { configure, getConfig }                     from "./config";
export { installHook }                              from "./hooks";
export { sentinelMiddleware, withSentinel }         from "./middleware";
export { dispatch }                                 from "./dispatcher";
export type { SentinelConfig, ExceptionRequest }   from "./types";
