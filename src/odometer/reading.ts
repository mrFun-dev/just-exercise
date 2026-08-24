import type { Request, Response } from "express";
import { Router } from "express";
import { unreadableImage } from "../errors.js";
import type { OcrDiagnostics, OcrProvider } from "../ocr/types.js";
import { extractValidImage, imageGate } from "./gate.js";
import { applyReadingPolicy } from "./reading-policy.js";

export function odometerRouter(ocrProvider: OcrProvider): Router {
  const router = Router();

  // gate (400/413/415) -> provider (422/500) -> policy -> log -> response
  router.post(
    "/reading",
    ...imageGate,
    async (req: Request, res: Response) => {
      const image = extractValidImage(req);
      const observation = await ocrProvider.extractReading(image);

      // Translated into the standard error here rather than written by the
      // provider, so all seven responses render through one path.
      if (!observation.ok) {
        logOcr({ ok: false }, observation.diagnostics);
        throw unreadableImage();
      }

      const body = applyReadingPolicy(observation);
      logOcr(body, observation.diagnostics);
      res.status(200).json(body);
    },
  );

  return router;
}

function logOcr(
  fields: Record<string, unknown>,
  diagnostics: OcrDiagnostics | undefined,
): void {
  const line =
    diagnostics === undefined
      ? fields
      : {
          ...fields,
          samples: diagnostics.samples,
          agreed: diagnostics.agreed,
        };
  console.log(JSON.stringify(line));
}
