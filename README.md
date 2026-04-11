# sentinel-node-sdk

A Node.js/TypeScript SDK for capturing, PII-scrubbing, and reporting runtime exceptions to the Sentinel AI gateway for automated analysis.

## Requirements

- Node.js ≥ 18.3.0 (uses native `fetch` — no HTTP library dependency)
- TypeScript ≥ 5.4 (if using TypeScript)

## Installation

```bash
npm install sentinel-node-sdk
```

Framework integrations are optional — install only what you use:

```bash
# Express
npm install express

# Next.js
npm install next
```

## Quick Start

Call `configure()` once at application startup, before any other SDK function:

```typescript
import { configure, installHook, sentinelMiddleware, withSentinel } from "sentinel-node-sdk";

configure({
  apiKey:     process.env.SENTINEL_API_KEY!,
  githubRepo: "acme/payment-service",   // must be registered in the Sentinel portal
});
```

Then choose one or more integrations depending on your stack.

---

## Integrations

### Global process hook

Catches `uncaughtException` and `unhandledRejection` at the process level.
Call this once, after `configure()`.

```typescript
installHook();
```

**Caveat**: Because Node.js may exit the process immediately after an `uncaughtException` listener returns, delivery is best-effort. The dispatch is fire-and-forget and begins executing before process exit, but a very fast shutdown can prevent the network request from completing.

### Express

Register `sentinelMiddleware` as an error-handling middleware — after all routes, before any other error handlers:

```typescript
import express from "express";

const app = express();

app.get("/orders/:id", handler);

// Register Sentinel last
app.use(sentinelMiddleware);

// Your own error handler still runs — Sentinel calls next(err)
app.use((err, req, res, next) => { res.status(500).json({ error: "Internal error" }); });
```

Sentinel **never swallows errors**. It calls `next(err)` unconditionally, so all downstream handlers run unchanged.

### Next.js (App Router)

Wrap individual route handlers with `withSentinel`:

```typescript
// app/api/orders/[id]/route.ts
import { withSentinel } from "sentinel-node-sdk";

export const GET = withSentinel(async (req) => {
  const order = await fetchOrder(req);
  return Response.json(order);
});

export const POST = withSentinel(async (req) => {
  // ...
});
```

`withSentinel` captures any exception, dispatches it to the gateway, then **re-throws** — Next.js's own `error.tsx` / `global-error.tsx` boundaries run normally.

---

## Configuration

```typescript
configure({
  // Required
  apiKey:           "your-api-key",          // Bearer token from the Sentinel portal
  githubRepo:       "owner/repo",            // Must match the gateway allowlist

  // Optional
  gatewayUrl:       "https://nexuspartner.dev",  // Override for staging / self-hosted
  timeoutMs:        5000,                    // Per-attempt HTTP timeout (ms)
  maxRetries:       3,                       // Max send attempts (4xx errors are not retried)
  retryBackoffBase: 500,                     // Exponential backoff base (ms), full jitter
  endpointLabel:    "<unknown>",             // Fallback label for hook-captured exceptions
  enabled:          true,                    // Set false to silence all network I/O
});
```

### Disabling via environment variable

```bash
SENTINEL_ENABLED=false node server.js
```

Accepted values: `false`, `0`, `no`, `off` (case-insensitive). Useful in test environments and CI without changing application code.

---

## PII Scrubbing

Before any data leaves the process, `errorMessage` and `stackTrace` are scrubbed for:

| Category | Example input | Redacted output |
|---|---|---|
| Email addresses | `user@example.com` | `[EMAIL]` |
| Credit card numbers | `4111 1111 1111 1111` | `[CREDIT_CARD]` |
| IPv4 addresses | `192.168.1.1` | `[IP_ADDRESS]` |
| Bearer tokens | `Bearer eyJhbGc...` | `Bearer [REDACTED_TOKEN]` |
| Vendor API keys | `sk-abc123`, `ghp_xyz` | `sk-[REDACTED_TOKEN]` |
| Key=value secrets | `password=hunter2` | `password=[REDACTED_SECRET]` |

Structural fields (`exceptionType`, `endpoint`, `githubRepo`, `timestamp`) are never scrubbed — they cannot contain free-text PII by design.

**Known limitations of the scrubber:**
- IPv6 addresses are not detected (future work).
- Credit card detection uses a digit-group pattern without Luhn validation — false positives are possible for numeric strings that resemble card numbers.

---

## Gateway payload

Each captured exception is sent as a `POST /api/v1/exceptions` request with this JSON body:

```typescript
interface ExceptionRequest {
  exceptionType: string;      // e.g. "TypeError", "PaymentError"
  errorMessage:  string;      // PII-scrubbed error.message
  stackTrace:    string;      // PII-scrubbed error.stack, full depth
  endpoint:      string;      // Route path or endpointLabel
  timestamp:     string;      // ISO 8601 UTC
  githubRepo:    string;      // "owner/repo"
  language:      "typescript";
}
```

The `language` field is hard-coded to `"typescript"` and cannot be overridden. If you are running plain JavaScript, the gateway still processes the event but uses the TypeScript-oriented AI workflow (V8 frame parser, Jest test generation).

---

## Retry behaviour

Failed dispatches are retried up to `maxRetries` times using full-jitter exponential backoff:

```
delay = random(0, retryBackoffBase × 2^attempt)
```

- **4xx responses** (auth failure, quota exceeded, unregistered repo) are **not retried** — they are terminal.
- **5xx responses** and network/timeout errors are retried.
- All errors are reported via `console.warn`; they never propagate to the application.

---

## Development

```bash
# Type-check without emitting
npm run typecheck

# Compile all output formats (CJS + ESM + type declarations)
npm run build
```

There is currently no test suite. The `npm test` step in CI is a placeholder.

### Output formats

The build produces three output directories under `dist/`:

| Directory | Format | Use case |
|---|---|---|
| `dist/cjs/` | CommonJS | `require()` in Node.js |
| `dist/esm/` | ES modules | `import` in Node.js / bundlers |
| `dist/types/` | Type declarations | TypeScript IDE support |

### Publishing

Releases are published automatically by GitHub Actions when a `v*` tag is pushed. The workflow verifies that `package.json`'s `version` field matches the git tag and attaches Sigstore provenance to the published tarball.

---

## Known limitations

- **No test suite.** The project ships without automated tests. Any contribution that adds behaviour should include tests.
- **`language` is always `"typescript"`.** Plain JavaScript consumers get the TypeScript AI workflow, which may produce less accurate results.
- **`installHook()` delivery is not guaranteed** on process crash. The fire-and-forget Promise starts executing, but a very short-lived process may exit before the HTTP request completes.
- **`configure()` is silently replaceable.** Calling it a second time replaces the active config with no warning. In an application that initialises multiple times (e.g. hot reload in development), this can produce unexpected behaviour.
- **`githubRepo` must be on the gateway allowlist.** The gateway will reject payloads for unregistered repositories with a 4xx response; there is no local validation at `configure()` time.
- **IPv6 addresses are not scrubbed.** Only dotted-quad IPv4 addresses are detected.
