import { describe, expect, it } from "vitest";
import { reconcile } from "../../src/ocr/reconcile.js";
import type { OcrSample } from "../../src/ocr/types.js";

function sample(overrides: Partial<OcrSample> = {}): OcrSample {
  return {
    readable: true,
    reading: 48253.7,
    unitShown: "miles",
    certainty: "medium",
    reason: "main odometer digits",
    ...overrides,
  };
}

describe("reconcile", () => {
  it("passes a single sample through without bumping or dropping", () => {
    const only = sample({ certainty: "low" });
    expect(reconcile([only])).toEqual({
      ok: true,
      reading: 48253.7,
      unitShown: "miles",
      certainty: "low",
      diagnostics: { samples: [only], agreed: true },
    });
  });

  it("returns ok: false when every sample is unreadable", () => {
    const samples = [
      sample({ readable: false, reading: null, reason: "glare" }),
      sample({ readable: false, reading: null, reason: "blur" }),
    ];
    expect(reconcile(samples)).toEqual({
      ok: false,
      diagnostics: { samples, agreed: true },
    });
  });

  it("drops certainty to low when samples mix readable and unreadable", () => {
    const samples = [
      sample({ certainty: "high" }),
      sample({ readable: false, reading: null, reason: "cropped" }),
    ];
    expect(reconcile(samples)).toMatchObject({
      ok: true,
      reading: 48253.7,
      certainty: "low",
      diagnostics: { agreed: false },
    });
  });

  it("treats tenths as the same reading, bumping one step and capping at high", () => {
    expect(
      reconcile([
        sample({ reading: 48253.7, certainty: "low" }),
        sample({ reading: 48253.2, certainty: "medium" }),
      ]),
    ).toMatchObject({
      ok: true,
      // Lowest reading is the rule everywhere, not just on disagreement, so
      // no result depends on Promise.all ordering. Here both tenths floor to
      // 48253, so the billed value is the same either way.
      reading: 48253.2,
      certainty: "medium",
      diagnostics: { agreed: true },
    });

    // Already at the ceiling — agreement cannot push past it.
    expect(
      reconcile([
        sample({ certainty: "high" }),
        sample({ reading: 48253.1, certainty: "high" }),
      ]),
    ).toMatchObject({ ok: true, certainty: "high" });
  });

  it("takes the lowest reading, not the first, when samples disagree", () => {
    // The higher reading is deliberately index 0: sample order is a
    // Promise.all artefact, so a test where the lower value happens to be
    // first would pass under either rule and pin nothing.
    const samples = [
      sample({ reading: 154510, certainty: "high" }),
      sample({ reading: 1545, certainty: "high" }),
    ];
    expect(reconcile(samples)).toMatchObject({
      ok: true,
      reading: 1545,
      certainty: "low",
      diagnostics: { agreed: false },
    });
  });
});
