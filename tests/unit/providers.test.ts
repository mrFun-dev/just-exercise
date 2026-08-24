import { describe, expect, it } from "vitest";
import { ClaudeOcrProvider } from "../../src/ocr/claude.js";
import { createOcrProvider } from "../../src/ocr/create-provider.js";
import {
  MOCK_DEFAULT_OBSERVATION,
  MockOcrProvider,
} from "../../src/ocr/providers.js";
import { MINIMAL_JPEG, MINIMAL_PNG } from "../helpers.js";

describe("MockOcrProvider", () => {
  it("reports a fixed observation, not a finished response", async () => {
    const provider = new MockOcrProvider();
    const jpeg = { bytes: MINIMAL_JPEG, mediaType: "image/jpeg" as const };
    const png = { bytes: MINIMAL_PNG, mediaType: "image/png" as const };
    const result = await provider.extractReading(jpeg);

    expect(result).toEqual({ ok: true, ...MOCK_DEFAULT_OBSERVATION });
    expect(await provider.extractReading(png)).toEqual(result);
    // Providers must not pre-apply policy: no `unit`, no `confidence`.
    expect(Object.keys(result).sort()).toEqual([
      "certainty",
      "ok",
      "reading",
      "unitShown",
    ]);
  });
});

describe("createOcrProvider", () => {
  it("resolves known names and rejects an unknown name", () => {
    expect(createOcrProvider("mock")).toBeInstanceOf(MockOcrProvider);
    expect(createOcrProvider("claude")).toBeInstanceOf(ClaudeOcrProvider);
    // Never silently fall back — a typo in OCR_PROVIDER must not ship
    // mock readings to production.
    expect(() => createOcrProvider("tesseract")).toThrow(/Unknown OCR_PROVIDER/);
  });
});
