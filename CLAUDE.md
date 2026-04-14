# CLAUDE.md — sentinel-node-sdk

## What this project is

A zero-dependency Node.js/TypeScript SDK that captures runtime exceptions, scrubs PII from the message and stack trace, and dispatches the payload to the Sentinel AI gateway (`POST /api/v1/exceptions`). It supports three integration modes: Express error middleware, Next.js App Router HOF wrapper, and a global process-level hook.

## Build commands

```bash
npm run typecheck        # Type-check without emitting (use this first)
npm run build            # Emit CJS + ESM + type declarations to dist/
npm run build:cjs        # CommonJS only → dist/cjs/
npm run build:esm        # ES modules only → dist/esm/
npm run build:types      # Declaration files only → dist/types/
```

There is no test suite yet. `npm test` is a CI placeholder and will exit 0.

## Source layout

```
src/
  index.ts       — Public API re-exports only. No logic.
  types.ts       — SentinelConfig and ExceptionRequest interfaces. Dependency root — imports nothing.
  config.ts      — configure() / getConfig(). Frozen singleton. Reads SENTINEL_ENABLED env var.
  scrubber.ts    — scrub(). Pure PII redaction. RegExps compiled once at module load.
  dispatcher.ts  — dispatch(). Native fetch, full-jitter exponential backoff, fire-and-forget.
  hooks.ts       — installHook(). Registers uncaughtException + unhandledRejection handlers. Idempotent.
  middleware.ts  — sentinelMiddleware (Express) and withSentinel (Next.js). Both re-throw / call next(err).
```

Dependency direction: `types` → `config` / `scrubber` → `dispatcher` → `hooks` / `middleware` → `index`. There are no circular imports.

## TypeScript configuration

- Strict mode is on. Also `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Target: ES2022, Lib: ES2022 only (no DOM — this is a server-side SDK).
- Module resolution: NodeNext.
- `tsconfig.build.json` extends the base but disables source maps and excludes `*.test.ts`, `*.spec.ts`, `**/__tests__/**`.

Do not relax strict mode or add `@ts-ignore` suppressions. If a type error seems unfixable without suppression, reconsider the design.

## Coding conventions

- **Zero production dependencies.** Use only Node.js built-ins. The `fetch` API (Node 18.3+) replaces any HTTP client.
- **Fire-and-forget dispatch.** `dispatch()` must never be awaited by callers. Mark call sites with `void`.
- **Never swallow exceptions.** `sentinelMiddleware` must call `next(err)`. `withSentinel` must re-throw. Sentinel is a passive observer.
- **Idempotent hook installation.** The `_installed` flag in `hooks.ts` guards against duplicate `process.on` registrations.
- **Scrub before dispatch.** `errorMessage` and `stackTrace` must pass through `scrub()` before being placed in an `ExceptionRequest`. Structural fields must not be scrubbed.
- **`configure()` is process-global.** One call per process startup. The frozen config object is intentional — modules that call `getConfig()` repeatedly rely on referential stability.

## What is intentionally not exported

`scrubber.ts` and `dispatcher.ts` are internal. Do not add them to `src/index.ts`. If consumers need custom scrubbing or dispatch, that is a feature request, not a refactor.

## Known gaps and honest limitations

- **No test suite.** The project needs unit tests for `scrub()`, `dispatch()` retry logic, `configure()` / `getConfig()` lifecycle, `installHook()` idempotency, and both middleware integrations. Any new behaviour added without tests is untested behaviour.
- **`language` is hard-coded to `"typescript"`.** This is intentional per the gateway's Kafka routing, but it means plain JavaScript consumers are misclassified. There is no plan to fix this without a gateway protocol change.
- **`installHook()` delivery on process crash is best-effort.** Node.js terminates after synchronous `uncaughtException` listeners return. The `void dispatch()` Promise begins executing but may not complete before exit. This is a known, accepted trade-off.
- **`configure()` can be called more than once silently.** The second call replaces the active config. There is no guard or warning. This can surprise callers in hot-reload environments.
- **Credit card detection has no Luhn validation.** Luhn validation was added to the Python SDK and Java starter in Sprint 26; the Node SDK still accepts any digit group matching the card pattern. False positives are possible but accepted to avoid false negatives. This is the remaining gap across the three SDKs.
- **`githubRepo` is not validated locally.** The gateway enforces an allowlist and returns 4xx for unregistered repos. A configure-time validation warning would improve the developer experience.

## CI / Publishing

- GitHub Actions workflow: `.github/workflows/publish-node-sdk.yml`
- Triggers on `v*` tags. Verifies `package.json` version === git tag before publishing.
- Publishes with `--provenance --access public` (Sigstore attestation via OIDC).
- `npm test` is a placeholder step; it will pass with no test runner installed.
