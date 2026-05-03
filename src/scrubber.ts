/**
 * PiiScrubber — pure, stateless PII redaction.
 *
 * Five RegExp constants are compiled once at module load and reused across all
 * scrub() calls. No class instantiation, no external dependencies, thread-safe.
 *
 * Redaction labels are standardised on the Python SDK:
 *   [EMAIL], [CREDIT_CARD], [IP_ADDRESS], [REDACTED_TOKEN], [REDACTED_SECRET]
 *
 * Scrubbing is applied only to errorMessage and stackTrace. Structural fields
 * (exceptionType, endpoint, githubRepo, timestamp, language) are passed through
 * unmodified — they cannot contain free-text PII by design.
 *
 * normalizeStackTrace() handles path normalization: strips the absolute
 * process.cwd() prefix and converts backslashes to forward slashes so that
 * file paths in stack frames match GitHub's Git tree paths exactly.
 */

// ── Category 1: Email addresses ──────────────────────────────────────────────
// Matches standard RFC 5321 local-part + domain patterns.
const RE_EMAIL = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

// ── Category 2: Credit card numbers ──────────────────────────────────────────
// Matches 4 groups of 4 digits (13–19 total) with optional space or dash
// separators. Candidates are validated with a Luhn checksum before redaction
// to eliminate false positives on order IDs, timestamps, and other long numeric
// strings. This matches the behaviour of the Python SDK and Java starter.
const RE_CREDIT_CARD = /\b(?:\d{4}[\s\-]?){3}\d{1,4}\b/g;

/**
 * Returns true if the digit sequence in `value` passes the Luhn checksum.
 * Non-digit characters (spaces, dashes) are stripped before validation.
 */
function luhnValid(value: string): boolean {
  const digits = value.replace(/\D/g, "").split("").map(Number);
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits[digits.length - 1 - i]!;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

// ── Category 3a: IPv4 addresses ───────────────────────────────────────────────
// Matches dotted-quad notation.
const RE_IP = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

// ── Category 3b: IPv6 addresses ───────────────────────────────────────────────
// Covers full and compressed notation (e.g. 2001:db8::1) and bare loopback (::1).
// First alternative: one leading hex group followed by 2–7 colon-prefixed groups
// (each 0–4 hex digits), allowing "::" zero-compression without false-matching
// short sequences like "80:443" (only one additional colon group).
// Second alternative: bare loopback "::1".
// Lookbehind/lookahead on [.\w] prevent false matches inside version strings.
// Requires Node.js 9.11.2+ (V8 lookbehind support); SDK already requires Node 18.3+.
const RE_IPV6 = /(?<![.\w])(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{0,4}){2,7}|::1)(?![.\w])/gi;

// ── Category 4: Bearer tokens and well-known API key prefixes ────────────────
// Two sub-patterns handled in sequence:
//   4a. "Bearer <value>" — preserves "Bearer " so the header name remains visible
//       e.g. "Authorization: Bearer [REDACTED_TOKEN]"
//   4b. Known vendor prefixes attached to a token value
//       (GitHub: ghp_/gho_/ghs_/ghr_, OpenAI: sk-, Slack: xoxb-/xoxp-/xoxs-/xoxa-)
const RE_BEARER     = /\bBearer\s+\S+/gi;
const RE_API_PREFIX = /\b(ghp_|gho_|ghs_|ghr_|sk-|xox[bpas]-)\S+/g;

// ── Category 5: Generic key=value secrets ────────────────────────────────────
// Matches common secret key names followed by = or : and a non-whitespace value.
// The key name and separator are preserved; only the value is redacted.
// e.g. password=hunter2  →  password=[REDACTED_SECRET]
//      api_key: sk-abc   →  api_key: [REDACTED_SECRET]
const RE_SECRET =
  /\b(password|passwd|secret|api_key|apikey|token|auth|credential|private_key)(\s*[:=]\s*)\S+/gi;

/**
 * Returns a copy of `input` with all PII patterns replaced by their
 * corresponding redaction tokens.
 *
 * Replacements are applied in category order (1 → 5). The function is pure —
 * it does not mutate the input string.
 */
export function scrub(input: string): string {
  return input
    // 1. Emails — must run before the generic secret pattern to avoid partial matches
    .replace(RE_EMAIL, "[EMAIL]")

    // 2. Credit card numbers — Luhn-validated to eliminate false positives
    .replace(RE_CREDIT_CARD, (match) => luhnValid(match) ? "[CREDIT_CARD]" : match)

    // 3a. IPv4 addresses
    .replace(RE_IP, "[IP_ADDRESS]")

    // 3b. IPv6 addresses (full, compressed, and loopback)
    .replace(RE_IPV6, "[IP_ADDRESS]")

    // 4a. Bearer tokens — preserves "Bearer " prefix
    .replace(RE_BEARER, "Bearer [REDACTED_TOKEN]")

    // 4b. Vendor-prefixed API keys — preserves the prefix (e.g. "ghp_[REDACTED_TOKEN]")
    .replace(RE_API_PREFIX, (_, prefix: string) => `${prefix}[REDACTED_TOKEN]`)

    // 5. Generic key=value secrets — preserves the key name and separator
    .replace(RE_SECRET, (_, key: string, sep: string) => `${key}${sep}[REDACTED_SECRET]`);
}

// ── Stack trace path normalization ────────────────────────────────────────────
// Computed once at module load; process.cwd() is stable for the process lifetime.
// Trailing slash is added so only the root prefix is stripped, not partial names.
const _cwdPrefix = (() => {
  const cwd = process.cwd().replace(/\\/g, "/");
  return cwd.endsWith("/") ? cwd : `${cwd}/`;
})();

// Escape regex metacharacters in the prefix (drive letters, colons, dots, etc.).
const _cwdPrefixRe = new RegExp(
  _cwdPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  "gi" // case-insensitive: Windows drive letters vary in case across environments
);

/**
 * Strips the process working-directory prefix from all file paths in a stack
 * trace and converts backslashes to forward slashes, making paths repo-relative
 * and compatible with GitHub's Git tree API.
 *
 * Example (Windows):
 *   Input:  "at Object.<anonymous> (L:\Projects\app\src\index.ts:10:5)"
 *   Output: "at Object.<anonymous> (src/index.ts:10:5)"
 *
 * Applied to stackTrace AFTER scrub() so PII redaction runs first.
 */
export function normalizeStackTrace(input: string): string {
  return input
    .replace(/\\/g, "/")        // backslashes → forward slashes (Windows paths)
    .replace(_cwdPrefixRe, ""); // strip absolute process root prefix
}
