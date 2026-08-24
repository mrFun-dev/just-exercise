import type { OcrProvider, OcrReturn, ValidatedImage } from "./types.js";

/**
 * The single reading the mock always reports. Matches the worked example in
 * the exercise brief so a reviewer can compare against it directly.
 */
export const MOCK_DEFAULT_OBSERVATION = {
  reading: 48253,
  unitShown: "miles",
  certainty: "high",
} as const;

/**
 * Deterministic stand-in for a real OCR engine, so the service can be run
 * and evaluated without credentials. It does not look at the image.
 */
export class MockOcrProvider implements OcrProvider {
  async extractReading(_image: ValidatedImage): Promise<OcrReturn> {
    return { ok: true, ...MOCK_DEFAULT_OBSERVATION };
  }
}
