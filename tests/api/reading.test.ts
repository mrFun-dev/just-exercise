import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { OcrProvider } from "../../src/ocr/types.js";
import { MAX_PAYLOAD_BYTES } from "../../src/odometer/gate.js";
import {
  FailingOcrProvider,
  MINIMAL_GIF,
  MINIMAL_JPEG,
  MINIMAL_PNG,
  StubOcrProvider,
  UNREADABLE_RESULT,
  postImage,
  postJson,
  postWithContentLength,
  startApp,
} from "../helpers.js";

const MOCK_RESPONSE = { reading: 48253, unit: "miles", confidence: "high" };

describe("POST /odometer/reading: accepted input", () => {
  let baseUrl = "";
  let close = async () => {};

  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    ({ baseUrl, close } = await startApp());
  });

  afterAll(async () => {
    await close();
    vi.restoreAllMocks();
  });

  it("accepts both transports and answers identically", async () => {
    const multipart = await postImage(
      baseUrl,
      MINIMAL_JPEG,
      "odometer.jpg",
      "image/jpeg",
    );
    const rawBase64 = await postJson(baseUrl, {
      image: MINIMAL_PNG.toString("base64"),
    });
    const dataUrl = await postJson(baseUrl, {
      image: `data:image/png;base64,${MINIMAL_PNG.toString("base64")}`,
    });

    expect([multipart.status, rawBase64.status, dataUrl.status]).toEqual([
      200, 200, 200,
    ]);
    expect(await multipart.json()).toEqual(MOCK_RESPONSE);
    expect(await rawBase64.json()).toEqual(MOCK_RESPONSE);
    expect(await dataUrl.json()).toEqual(MOCK_RESPONSE);
  });
});

describe("POST /odometer/reading: rejected input", () => {
  let baseUrl = "";
  let close = async () => {};

  beforeAll(async () => {
    ({ baseUrl, close } = await startApp());
  });

  afterAll(async () => {
    await close();
  });

  it("returns 400 with the right code for each bad image field", async () => {
    const absent = await postJson(baseUrl, {});
    const blank = await postJson(baseUrl, { image: "   " });
    const garbage = await postJson(baseUrl, { image: "%%%not-base64%%%" });

    expect([absent.status, blank.status, garbage.status]).toEqual([
      400, 400, 400,
    ]);
    const missing = { error: "MISSING_IMAGE", message: "An image is required" };
    expect(await absent.json()).toEqual(missing);
    expect(await blank.json()).toEqual(missing);
    expect(await garbage.json()).toEqual({
      error: "INVALID_BASE64",
      message: "The image is not valid base64",
    });
  });

  it("returns 400 for a malformed multipart or JSON body", async () => {
    const multipart = await fetch(`${baseUrl}/odometer/reading`, {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=----broken" },
      body: '------broken\r\nContent-Disposition: form-data; name="image"; filename="x.jpg"\r\n\r\nnot-closed',
    });
    const json = await fetch(`${baseUrl}/odometer/reading`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });

    expect(multipart.status).toBe(400);
    expect(await multipart.json()).toEqual({
      error: "INVALID_UPLOAD",
      message: "The uploaded file could not be read",
    });
    expect(json.status).toBe(400);
    expect(await json.json()).toEqual({
      error: "INVALID_JSON",
      message: "Request body is not valid JSON",
    });
  });

  it("returns 415 based on magic bytes, not the declared content type", async () => {
    const body = new FormData();
    body.append(
      "image",
      new Blob([new Uint8Array(MINIMAL_GIF)], { type: "image/jpeg" }),
      "x.jpg",
    );
    const response = await fetch(`${baseUrl}/odometer/reading`, {
      method: "POST",
      body,
    });

    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({
      error: "UNSUPPORTED_FILE_TYPE",
      message: "Only JPEG and PNG images are accepted",
    });
  });

  it("returns 413 before reading an oversized body", async () => {
    const response = await postWithContentLength(
      baseUrl,
      MAX_PAYLOAD_BYTES + 1,
      JSON.stringify({ image: MINIMAL_PNG.toString("base64") }),
    );

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      error: "PAYLOAD_TOO_LARGE",
      message: "Request payload exceeds the 10MB limit",
    });
  });
});

describe("POST /odometer/reading: OCR outcomes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Each case needs its own provider, so the server is per-test rather
  // than shared via beforeAll.
  async function withProvider(
    ocrProvider: OcrProvider,
    assert: (baseUrl: string) => Promise<void>,
  ) {
    const server = await startApp({ ocrProvider });
    try {
      await assert(server.baseUrl);
    } finally {
      await server.close();
    }
  }

  it("applies policy to the observation and keeps diagnostics off the body", async () => {
    const samples = [
      {
        readable: true,
        reading: 48253.9,
        unitShown: "km" as const,
        certainty: "high" as const,
        reason: "main drum, km label to the right",
      },
    ];
    const stub = new StubOcrProvider({
      ok: true,
      reading: 48253.9,
      unitShown: "km",
      certainty: "high",
      diagnostics: { agreed: true, samples },
    });

    await withProvider(stub, async (baseUrl) => {
      const logs = spyLogs();
      const response = await postJson(baseUrl, {
        image: MINIMAL_PNG.toString("base64"),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      // Floored, reported as miles without conversion, downgraded for the km label.
      expect(body).toEqual({
        reading: 48253,
        unit: "miles",
        confidence: "low",
      });
      // The model's reasoning is engineering-only: logged, never returned.
      expect(body).not.toHaveProperty("reason");
      expect(body).not.toHaveProperty("samples");
      expect(loggedJson(logs)).toContainEqual({
        ...body,
        agreed: true,
        samples,
      });
    });
  });

  // An unreadable photo is an expected outcome (422); an engine that fell
  // over is a fault (500). The provider contract keeps them apart.
  it("separates an unreadable image (422) from a provider fault (500)", async () => {
    await withProvider(new StubOcrProvider(UNREADABLE_RESULT), async (baseUrl) => {
      const logs = spyLogs();
      const response = await postJson(baseUrl, {
        image: MINIMAL_PNG.toString("base64"),
      });
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body).toEqual({
        error: "UNREADABLE_IMAGE",
        message: "Could not extract a mileage reading from the provided image",
      });
      expect(body).not.toHaveProperty("reason");
      expect(loggedJson(logs)).toContainEqual({ ok: false });
    });

    await withProvider(new FailingOcrProvider(), async (baseUrl) => {
      const response = await postJson(baseUrl, {
        image: MINIMAL_PNG.toString("base64"),
      });

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: "OCR_PROVIDER_ERROR",
        message: "Failed to extract a reading from the image",
      });
    });
  });
});

function spyLogs() {
  return vi.spyOn(console, "log").mockImplementation(() => {});
}

function loggedJson(spy: ReturnType<typeof spyLogs>): unknown[] {
  return spy.mock.calls.map(([line]) => JSON.parse(String(line)));
}
