import { describe, expect, it } from "vitest";
import {
  ClaudeOcrProvider,
  toOcrReturn,
  type ClaudeClient,
  type ClaudeObservation,
} from "../../src/ocr/claude.js";
import { MINIMAL_JPEG } from "../helpers.js";

const IMAGE = { bytes: MINIMAL_JPEG, mediaType: "image/jpeg" as const };

const READABLE: ClaudeObservation = {
  readable: true,
  reading: 48253.7,
  unit_shown: "miles",
  certainty: "high",
  reason: "six digits on the main drum",
};

const UNREADABLE: ClaudeObservation = {
  readable: false,
  reading: null,
  unit_shown: "unknown",
  certainty: "low",
  reason: "glare on the last digit",
};

describe("ClaudeOcrProvider", () => {
  it("returns a fractional observation from structured output", async () => {
    const provider = new ClaudeOcrProvider(fakeClient([READABLE]));

    expect(await provider.extractReading(IMAGE)).toMatchObject({
      ok: true,
      reading: 48253.7,
      unitShown: "miles",
      certainty: "high",
    });
  });

  it("returns ok: false when the model cannot read the image", async () => {
    const provider = new ClaudeOcrProvider(fakeClient([UNREADABLE]));

    expect(await provider.extractReading(IMAGE)).toMatchObject({ ok: false });
  });

  it("throws on max_tokens or refusal", async () => {
    await expect(
      new ClaudeOcrProvider(fakeClient([null], "max_tokens")).extractReading(
        IMAGE,
      ),
    ).rejects.toThrow(/max_tokens/);

    await expect(
      new ClaudeOcrProvider(fakeClient([null], "refusal")).extractReading(
        IMAGE,
      ),
    ).rejects.toThrow(/refusal/);
  });

  it("reconciles two samples that agree on the floored reading", async () => {
    const provider = new ClaudeOcrProvider(
      fakeClient([
        { ...READABLE, certainty: "low", reading: 48253.7 },
        { ...READABLE, certainty: "medium", reading: 48253.2 },
      ]),
      2,
    );

    expect(await provider.extractReading(IMAGE)).toMatchObject({
      ok: true,
      // The lower of the two tenths; both floor to 48253.
      reading: 48253.2,
      certainty: "medium",
      diagnostics: { agreed: true },
    });
  });
});

function fakeClient(
  outputs: Array<ClaudeObservation | null>,
  stop_reason: string | null = "end_turn",
): ClaudeClient {
  let index = 0;
  return {
    messages: {
      parse: async () => {
        const parsed_output = outputs[index] ?? null;
        index += 1;
        return { parsed_output, stop_reason };
      },
    },
  };
}
