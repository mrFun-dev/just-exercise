import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Pinned so a developer's local .env can never point the suite at a
    // real OCR engine or a different model. Tests that need another
    // provider inject it directly. Model is pinned to the default; tests
    // assert DEFAULT_CLAUDE_MODEL rather than repeating the id.
    env: {
      OCR_PROVIDER: "mock",
      ANTHROPIC_MODEL: "claude-sonnet-5",
      MAX_PAYLOAD_BYTES: "10485760",
      CLAUDE_SAMPLES: "1",
    },
  },
});
