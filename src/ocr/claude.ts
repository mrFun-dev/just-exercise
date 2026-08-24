import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import {
  ANTHROPIC_MAX_RETRIES,
  ANTHROPIC_TIMEOUT_MS,
  CLAUDE_MODEL,
  CLAUDE_SAMPLES,
} from "../config.js";
import { reconcile } from "./reconcile.js";
import type {
  Confidence,
  OcrProvider,
  OcrReturn,
  OcrSample,
  UnitShown,
  ValidatedImage,
} from "./types.js";

export { CLAUDE_MODEL } from "../config.js";

/**
 * What the model is asked to emit. Flat on purpose: not `OcrReturn`, so the
 * wire contract can stay stable if the internal type changes, and `reading`
 * is a number so tenths survive until `applyReadingPolicy` floors them.
 */
export type ClaudeObservation = {
  readable: boolean;
  reading: number | null;
  unit_shown: UnitShown;
  certainty: Confidence;
  reason: string;
};

const CLAUDE_OBSERVATION_SCHEMA = {
  type: "object",
  properties: {
    readable: { type: "boolean" },
    reading: { type: ["number", "null"] },
    unit_shown: {
      type: "string",
      enum: ["miles", "km", "unknown"],
    },
    certainty: {
      type: "string",
      enum: ["high", "medium", "low"],
    },
    reason: { type: "string" },
  },
  required: ["readable", "reading", "unit_shown", "certainty", "reason"],
  additionalProperties: false,
} as const;

const PROMPT = `Read the odometer in this photo.

Report what you see. Do not floor the number, convert units, or decide
whether the reading is plausible.

- Read the main odometer (lifetime total), not the trip meter. The trip
  meter is the smaller display, often labelled TRIP / A / B, and usually
  shows a tenth.
- If the main odometer itself shows a tenth, include it (e.g. 48253.7).
  Do not round.
- Report the unit label as displayed: "miles", "km", or "unknown" if
  there is no label. Never convert kilometres to miles.
- If glare, blur, a cropped digit, or anything else means you cannot
  read the main total, set readable to false and reading to null rather
  than guessing.
- Include a brief reason: what you read and why, or why it was
  unreadable. This is for engineers, not customers.`;

export type ClaudeClient = {
  messages: {
    parse(params: unknown): Promise<{
      parsed_output: ClaudeObservation | null;
      stop_reason: string | null;
    }>;
  };
};

export class ClaudeOcrProvider implements OcrProvider {
  constructor(
    private readonly client: ClaudeClient = new Anthropic({
      timeout: ANTHROPIC_TIMEOUT_MS,
      maxRetries: ANTHROPIC_MAX_RETRIES,
    }),
    private readonly samples: number = CLAUDE_SAMPLES,
  ) {}

  async extractReading(image: ValidatedImage): Promise<OcrReturn> {
    const observations = await Promise.all(
      Array.from({ length: this.samples }, () => this.parseOne(image)),
    );
    return reconcile(observations.map(toSample));
  }

  private async parseOne(image: ValidatedImage): Promise<ClaudeObservation> {
    const message = await this.client.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: image.mediaType,
                data: image.bytes.toString("base64"),
              },
            },
            { type: "text", text: PROMPT },
          ],
        },
      ],
      output_config: {
        format: jsonSchemaOutputFormat(CLAUDE_OBSERVATION_SCHEMA),
      },
    });

    if (
      message.stop_reason === "max_tokens" ||
      message.stop_reason === "refusal"
    ) {
      throw new Error(`Claude stopped: ${message.stop_reason}`);
    }

    if (message.parsed_output === null) {
      throw new Error("Claude returned no structured output");
    }

    return message.parsed_output;
  }
}

export function toSample(observation: ClaudeObservation): OcrSample {
  return {
    readable: observation.readable,
    reading: observation.reading,
    unitShown: observation.unit_shown,
    certainty: observation.certainty,
    reason: observation.reason,
  };
}

export function toOcrReturn(observation: ClaudeObservation): OcrReturn {
  if (!observation.readable || observation.reading === null) {
    return { ok: false };
  }

  return {
    ok: true,
    reading: observation.reading,
    unitShown: observation.unit_shown,
    certainty: observation.certainty,
  };
}
