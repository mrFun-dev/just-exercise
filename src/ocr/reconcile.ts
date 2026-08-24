import type {
  Confidence,
  OcrDiagnostics,
  OcrReturn,
  OcrSample,
} from "./types.js";

const CERTAINTY_RANK: Record<Confidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

/**
 * Combines independent OCR samples into one observation.
 *
 * Readings are compared after `Math.floor`. The value returned to policy is
 * not floored — that stays `applyReadingPolicy`'s job.
 */
export function reconcile(samples: OcrSample[]): OcrReturn {
  if (samples.length === 0) {
    throw new Error("reconcile requires at least one sample");
  }

  const diagnostics: OcrDiagnostics = {
    samples,
    agreed: samplesAgree(samples),
  };
  const first = samples[0];
  if (first === undefined) {
    throw new Error("reconcile requires at least one sample");
  }

  if (samples.length === 1) {
    return attach(toObservation(first), diagnostics);
  }

  const readable = samples.filter(isReadable);
  if (readable.length === 0) {
    return { ok: false, diagnostics };
  }

  // Always the lowest reading, never whichever call happened to resolve
  // first. When samples disagree we cannot tell which is right, and on a
  // pay-per-mile policy the defensible direction is the one that cannot
  // overcharge. Confidence is forced to `low` below, so a badly split pair
  // (154510 vs 1545) is flagged for review rather than silently billed.
  const chosen = lowestReading(readable);

  if (readable.length < samples.length) {
    return attach(
      {
        ok: true,
        reading: chosen.reading,
        unitShown: chosen.unitShown,
        certainty: "low",
      },
      diagnostics,
    );
  }

  const floor = Math.floor(chosen.reading);
  const sameFloor = readable.every(
    (sample) => sample.reading !== null && Math.floor(sample.reading) === floor,
  );

  return attach(
    {
      ok: true,
      reading: chosen.reading,
      unitShown: chosen.unitShown,
      certainty: sameFloor
        ? bumpCertainty(lowestCertainty(readable))
        : "low",
    },
    diagnostics,
  );
}

export function samplesAgree(samples: OcrSample[]): boolean {
  if (samples.length <= 1) {
    return true;
  }

  const readable = samples.filter(isReadable);
  if (readable.length === 0) {
    return true;
  }
  if (readable.length < samples.length) {
    return false;
  }

  const first = readable[0];
  if (first === undefined || first.reading === null) {
    return true;
  }
  const floor = Math.floor(first.reading);
  return readable.every(
    (sample) => sample.reading !== null && Math.floor(sample.reading) === floor,
  );
}

function isReadable(
  sample: OcrSample,
): sample is OcrSample & { reading: number } {
  return sample.readable && sample.reading !== null;
}

function toObservation(sample: OcrSample): OcrReturn {
  if (!isReadable(sample)) {
    return { ok: false };
  }
  return {
    ok: true,
    reading: sample.reading,
    unitShown: sample.unitShown,
    certainty: sample.certainty,
  };
}

function attach(result: OcrReturn, diagnostics: OcrDiagnostics): OcrReturn {
  return { ...result, diagnostics };
}

function lowestReading(
  samples: Array<OcrSample & { reading: number }>,
): OcrSample & { reading: number } {
  return samples.reduce((lowest, sample) =>
    sample.reading < lowest.reading ? sample : lowest,
  );
}

function lowestCertainty(samples: OcrSample[]): Confidence {
  return samples.reduce<Confidence>((lowest, sample) => {
    return CERTAINTY_RANK[sample.certainty] < CERTAINTY_RANK[lowest]
      ? sample.certainty
      : lowest;
  }, "high");
}

function bumpCertainty(certainty: Confidence): Confidence {
  if (certainty === "low") {
    return "medium";
  }
  if (certainty === "medium") {
    return "high";
  }
  return "high";
}
