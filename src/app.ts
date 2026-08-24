import path from "node:path";
import express from "express";
import { errorHandler } from "./error-handler.js";
import { createOcrProvider } from "./ocr/create-provider.js";
import type { OcrProvider } from "./ocr/types.js";
import { odometerRouter } from "./odometer/reading.js";

export type AppOptions = {
  ocrProvider?: OcrProvider;
};

export function createApp(options: AppOptions = {}) {
  const app = express();
  // Resolved once at boot, not per request. Tests inject directly.
  const ocrProvider = options.ocrProvider ?? createOcrProvider();

  app.use(express.static(path.join(process.cwd(), "public")));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Body parsing and size limits live in the gate, not here, so every check
  // that guards the reading endpoint sits in one file.
  app.use("/odometer", odometerRouter(ocrProvider));
  app.use(errorHandler);

  return app;
}
