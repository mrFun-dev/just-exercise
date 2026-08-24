import { ClaudeOcrProvider } from "./claude.js";
import { OCR_PROVIDER } from "../config.js";
import { MockOcrProvider } from "./providers.js";
import type { OcrProvider } from "./types.js";

export type OcrProviderName = "mock" | "claude";

export function createOcrProvider(
  name = OCR_PROVIDER,
): OcrProvider {
  switch (name) {
    case "mock":
      return new MockOcrProvider();
    case "claude":
      return new ClaudeOcrProvider();
    default:
      // Fail at boot rather than falling back. A typo in OCR_PROVIDER must
      // never leave the service quietly serving mock readings.
      throw new Error(
        `Unknown OCR_PROVIDER "${name}". Supported values: mock, claude.`,
      );
  }
}
