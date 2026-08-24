import { createServer } from "node:http";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp, type AppOptions } from "../src/app.js";
import type {
  OcrFailure,
  OcrProvider,
  OcrReturn,
  ValidatedImage,
} from "../src/ocr/types.js";

export async function startApp(options: AppOptions = {}) {
  const server = createServer(createApp(options));
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        // fetch leaves keep-alive sockets open, and `close` waits for them.
        // Without this each API test file stalls for the idle timeout.
        server.closeAllConnections();
      }),
  };
}

/**
 * Returns a fixed result, so an API test can drive any OCR outcome through
 * the real HTTP stack. Test doubles live here rather than in `src/` — the
 * shipped service only knows about providers it would really use.
 */
export class StubOcrProvider implements OcrProvider {
  constructor(private readonly result: OcrReturn) {}

  async extractReading(_image: ValidatedImage): Promise<OcrReturn> {
    return this.result;
  }
}

/**
 * Throws instead of returning. Distinct from a stub returning
 * `{ ok: false }`: an unreadable photo is an expected outcome (422), an
 * engine that fell over is a fault (500).
 */
export class FailingOcrProvider implements OcrProvider {
  async extractReading(_image: ValidatedImage): Promise<OcrReturn> {
    throw new Error("OCR provider failed");
  }
}

export const UNREADABLE_RESULT: OcrFailure = { ok: false };

export async function postJson(
  baseUrl: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}/odometer/reading`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function postImage(
  baseUrl: string,
  image: Buffer,
  filename: string,
  type: string,
): Promise<Response> {
  const body = new FormData();
  body.append("image", new Blob([new Uint8Array(image)], { type }), filename);
  return fetch(`${baseUrl}/odometer/reading`, { method: "POST", body });
}

/**
 * Sends a body with a hand-written Content-Length, which `fetch` will not
 * allow. Needed to reach the pre-read size guard without allocating 10MB.
 */
export function postWithContentLength(
  baseUrl: string,
  contentLength: number,
  body: string,
): Promise<{ status: number; body: unknown }> {
  const url = new URL(`${baseUrl}/odometer/reading`);

  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": contentLength,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
          });
        });
      },
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export const MINIMAL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export const MINIMAL_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

export const MINIMAL_GIF = Buffer.from("R0lGODlhAQABAAAAACw=", "base64");
