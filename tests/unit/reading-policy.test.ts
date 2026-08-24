import { describe, expect, it } from "vitest";
import type { Confidence, OcrSuccess, UnitShown } from "../../src/ocr/types.js";
import {
  MAX_PLAUSIBLE_READING,
  applyReadingPolicy,
} from "../../src/odometer/reading-policy.js";

function observed(
  reading: number,
  unitShown: UnitShown = "miles",
  certainty: Confidence = "high",
): OcrSuccess {
  return { ok: true, reading, unitShown, certainty };
}

describe("applyReadingPolicy", () => {
  it("floors a fractional reading and never rounds up", () => {
    expect(applyReadingPolicy(observed(48253)).reading).toBe(48253);
    expect(applyReadingPolicy(observed(48253.1)).reading).toBe(48253);
    expect(applyReadingPolicy(observed(48253.9)).reading).toBe(48253);
  });

  it("reports miles whatever the display showed, and never converts", () => {
    for (const unitShown of ["miles", "km", "unknown"] as const) {
      expect(applyReadingPolicy(observed(12345, unitShown)).unit).toBe("miles");
    }
    expect(applyReadingPolicy(observed(100, "km")).reading).toBe(100);
  });

  it("trusts only an explicitly miles-labelled display", () => {
    // One rule, three inputs: a km label contradicts the miles we assert,
    // and an unlabelled display is not evidence for it, merely the absence.
    const confidence = (unit: UnitShown) =>
      applyReadingPolicy(observed(12345, unit, "high")).confidence;

    expect(confidence("miles")).toBe("high");
    expect(confidence("km")).toBe("low");
    expect(confidence("unknown")).toBe("low");
  });

  it("preserves the provider's certainty and never raises it", () => {
    for (const certainty of ["high", "medium", "low"] as const) {
      expect(
        applyReadingPolicy(observed(48253, "miles", certainty)).confidence,
      ).toBe(certainty);
    }
  });

  it("flags an implausible reading as low confidence but still returns it", () => {
    // All-identical digits: glare or a dead segment, not a real total.
    expect(applyReadingPolicy(observed(111111)).confidence).toBe("low");
    // Zero is checked separately — "000000" is just 0 by the time it is a number.
    expect(applyReadingPolicy(observed(0)).confidence).toBe("low");
    // Six digits is the mechanical ceiling; the boundary itself stays trusted.
    expect(applyReadingPolicy(observed(MAX_PLAUSIBLE_READING)).confidence).toBe(
      "high",
    );
    expect(
      applyReadingPolicy(observed(MAX_PLAUSIBLE_READING + 1)).confidence,
    ).toBe("low");
    // The number is never withheld — downstream decides what to do with it.
    expect(applyReadingPolicy(observed(9999999)).reading).toBe(9999999);
  });
});
