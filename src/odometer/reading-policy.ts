import type { Confidence, OcrSuccess } from "../ocr/types.js";

/** The success body returned by `POST /odometer/reading`. */
export type ReadingResponse = {
  reading: number;
  unit: "miles";
  confidence: Confidence;
};

/**
 * Highest reading treated as plausible.
 *
 * Consumer odometers are six digits, so 999999 is both the mechanical
 * ceiling and the value a rolled-over or faulty display tends to show.
 * At or above it, a misread is likelier than a real total.
 */
export const MAX_PLAUSIBLE_READING = 999_998;

const REPEATED_DIGITS = /^(\d)\1+$/;

/**
 * Converts a raw OCR observation into the API response.
 *
 * Every business rule lives here rather than in a provider, so swapping the
 * OCR engine cannot change the contract:
 *   - readings are floored to whole miles
 *   - the unit is always "miles"
 *   - confidence is only ever lowered, never raised
 */
export function applyReadingPolicy(observation: OcrSuccess): ReadingResponse {
  return {
    // Floor, never round. Tenths belong to the trip meter, and on a
    // pay-per-mile policy a rounded-up mile is a mile the customer is
    // billed for but did not drive.
    reading: Math.floor(observation.reading),
    unit: "miles",
    confidence: isSuspect(observation) ? "low" : observation.certainty,
  };
}

function isSuspect(observation: OcrSuccess): boolean {
  // We assert miles, so full confidence requires the display to have
  // actually said miles. A km label contradicts us outright; an unlabelled
  // display is not evidence, just the absence of it. Both drop to low.
  // This is deliberately conservative and costs signal — unlabelled is the
  // common case — but it never claims certainty about a unit nobody saw.
  if (observation.unitShown !== "miles") {
    return true;
  }

  const reading = Math.floor(observation.reading);
  if (reading < 0 || reading > MAX_PLAUSIBLE_READING) {
    return true;
  }

  // All-identical digits are the signature of glare or a dead segment
  // rather than a real total. Zero is checked separately: by the time the
  // reading is a number, "000000" has already collapsed to 0.
  return reading === 0 || REPEATED_DIGITS.test(String(reading));
}
