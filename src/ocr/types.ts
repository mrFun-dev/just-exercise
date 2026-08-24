export type Confidence = "high" | "medium" | "low";

/** What the odometer display appeared to be labelled with, if anything. */
export type UnitShown = "miles" | "km" | "unknown";

/**
 * A reading a provider believes it extracted.
 *
 * This is an observation, not an answer: it records what the provider saw,
 * with no business rules applied. `reading` may carry a fractional part and
 * `unitShown` may contradict the miles-only contract. Both are resolved by
 * `applyReadingPolicy`.
 */
export type OcrSuccess = {
  ok: true;
  reading: number;
  unitShown: UnitShown;
  /** How sure the provider is about the digits themselves. */
  certainty: Confidence;
  /**
   * Engineering-only. Never copied into the HTTP body; the route logs it.
   */
  diagnostics?: OcrDiagnostics;
};

/**
 * No reading could be extracted.
 *
 * Carries no code or message: the caller-facing 422 is built by
 * `unreadableImage()` in `errors.ts`, so an OCR engine never authors
 * customer-facing copy.
 */
export type OcrFailure = {
  ok: false;
  diagnostics?: OcrDiagnostics;
};

export type OcrReturn = OcrSuccess | OcrFailure;

/**
 * One model sample. `reason` is for engineers, not customers.
 */
export type OcrSample = {
  readable: boolean;
  reading: number | null;
  unitShown: UnitShown;
  certainty: Confidence;
  reason: string;
};

/**
 * Self-consistency trace. `reasons` are not stored here — derive them at
 * the log line from `samples` so the two cannot drift.
 */
export type OcrDiagnostics = {
  samples: OcrSample[];
  agreed: boolean;
};

export type ImageMediaType = "image/jpeg" | "image/png";

/**
 * A JPEG or PNG that has already passed the gate.
 *
 * Carries `mediaType` because vision APIs need it on the wire and magic-byte
 * detection already paid for it. Providers must not re-sniff the bytes.
 */
export type ValidatedImage = {
  bytes: Buffer;
  mediaType: ImageMediaType;
};

/**
 * An OCR engine.
 *
 * Implementations report observations only — they must not floor readings,
 * convert units, or second-guess their own confidence. Returning
 * `{ ok: false }` means "no number was extractable"; throwing means the
 * engine itself failed and the caller should surface a 500.
 *
 * `diagnostics` is optional and for engineering logs only. It must never
 * appear in the customer-facing response.
 */
export interface OcrProvider {
  extractReading(image: ValidatedImage): Promise<OcrReturn>;
}
