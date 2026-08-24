/**
 * Environment-backed settings.
 *
 * Every value the environment can change is read here, once, at import time.
 * Anything invalid throws immediately, so a bad deploy fails at boot with a
 * named variable rather than surfacing as a strange 500 on the first real
 * request — the same fail-fast stance `createOcrProvider` takes on an
 * unrecognised provider name.
 *
 * Defaults are deliberately not exported: they are the fallbacks behind the
 * exported values, not a second public surface. Tests pin what they care
 * about in `vitest.config.ts` so a developer's local `.env` cannot leak in.
 */

const DEFAULT_PORT = 3000;
const DEFAULT_OCR_PROVIDER = "mock";
const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5";
const DEFAULT_MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;
const DEFAULT_ANTHROPIC_TIMEOUT_MS = 600_000;
const DEFAULT_ANTHROPIC_MAX_RETRIES = 2;
const DEFAULT_CLAUDE_SAMPLES = 2;

export const PORT = readInt("PORT", DEFAULT_PORT, 1);

export const OCR_PROVIDER =
  process.env["OCR_PROVIDER"]?.trim() || DEFAULT_OCR_PROVIDER;

export const CLAUDE_MODEL =
  process.env["ANTHROPIC_MODEL"]?.trim() || DEFAULT_CLAUDE_MODEL;

export const ANTHROPIC_TIMEOUT_MS = readInt(
  "ANTHROPIC_TIMEOUT_MS",
  DEFAULT_ANTHROPIC_TIMEOUT_MS,
);

export const ANTHROPIC_MAX_RETRIES = readInt(
  "ANTHROPIC_MAX_RETRIES",
  DEFAULT_ANTHROPIC_MAX_RETRIES,
);

export const MAX_PAYLOAD_BYTES = readInt(
  "MAX_PAYLOAD_BYTES",
  DEFAULT_MAX_PAYLOAD_BYTES,
  1,
);

export const CLAUDE_SAMPLES = readInt(
  "CLAUDE_SAMPLES",
  DEFAULT_CLAUDE_SAMPLES,
  1,
);

function readInt(name: string, fallback: number, min = 0): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(
      `${name} must be a whole number >= ${min}, got "${raw}"`,
    );
  }

  return value;
}
