import { MAX_PAYLOAD_BYTES } from "../config.js";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import express from "express";
import multer, { MulterError } from "multer";
import {
  invalidBase64,
  invalidUpload,
  missingImage,
  payloadTooLarge,
  unsupportedFileType,
} from "../errors.js";
import type { ValidatedImage } from "../ocr/types.js";

/**
 * The first pass.
 *
 * Everything here runs before the OCR provider is called, and answers only
 * one question: is this a well-formed image we could hand to an OCR engine?
 * It never asks whether the picture contains an odometer — that is the
 * provider's job, and the only reason a provider gets called at all.
 *
 * Rejections here are 400, 413 and 415. Rejections after here are 422 and
 * 500. Keeping the two sets in separate files keeps them from drifting: this
 * is the only code in the service that knows what a PNG header looks like.
 */

export { MAX_PAYLOAD_BYTES } from "../config.js";

export type ImageType = "jpeg" | "png";

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PAYLOAD_BYTES, files: 1 },
});

/**
 * Middleware that must run before the route handler, in this order.
 *
 * Three size guards rather than one, because each catches a request the
 * others cannot: `rejectOversizedPayload` stops an oversized Content-Length
 * before a single byte of body is read, while the two body parsers catch a
 * stream that lies about its length or omits it entirely.
 */
export const imageGate: RequestHandler[] = [
  rejectOversizedPayload,
  express.json({ limit: MAX_PAYLOAD_BYTES }),
  acceptMultipartImage,
];

/**
 * Produces a typed image, or throws an `ApiError` describing why it could
 * not. Guarantees the caller receives a non-empty JPEG or PNG, including
 * the media type vision APIs need on the wire.
 */
export function extractValidImage(req: Request): ValidatedImage {
  const bytes = getImageBytes(req);
  const type = detectImageType(bytes);
  return {
    bytes,
    mediaType: type === "jpeg" ? "image/jpeg" : "image/png",
  };
}

function rejectOversizedPayload(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const header = req.headers["content-length"];
  if (header === undefined) {
    next();
    return;
  }

  const length = Number(header);
  next(
    Number.isFinite(length) && length > MAX_PAYLOAD_BYTES
      ? payloadTooLarge()
      : undefined,
  );
}

/**
 * Parses a multipart body into `req.file`, passing non-multipart requests
 * through untouched so the JSON branch can handle them.
 */
function acceptMultipartImage(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isMultipart(req)) {
    next();
    return;
  }

  upload.single("image")(req, res, (err: unknown) => {
    next(err ? mapUploadError(err) : undefined);
  });
}

function isMultipart(req: Request): boolean {
  const contentType = req.headers["content-type"];
  return (
    typeof contentType === "string" &&
    contentType.toLowerCase().includes("multipart/form-data")
  );
}

function mapUploadError(err: unknown): Error {
  if (err instanceof MulterError && err.code === "LIMIT_FILE_SIZE") {
    return payloadTooLarge();
  }
  return invalidUpload();
}

function getImageBytes(req: Request): Buffer {
  const uploaded = getUploadedFile(req);
  if (uploaded) {
    // A zero-byte part is a caller who forgot to attach anything, not a
    // corrupt upload — report it the same way as an absent `image` field.
    if (uploaded.length === 0) {
      throw missingImage();
    }
    return uploaded;
  }

  const image = isRecord(req.body) ? req.body["image"] : undefined;
  if (image === undefined || image === null || image === "") {
    throw missingImage();
  }
  if (typeof image !== "string") {
    throw invalidBase64();
  }

  return decodeBase64Image(image);
}

export function decodeBase64Image(value: string): Buffer {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw missingImage();
  }

  const base64 = extractBase64Payload(trimmed);
  if (base64.length === 0) {
    throw missingImage();
  }

  const compact = base64.replace(/\s/g, "");
  const padded = padBase64(compact);
  if (!BASE64_BODY.test(padded)) {
    throw invalidBase64();
  }

  const bytes = Buffer.from(padded, "base64");
  if (bytes.length === 0) {
    throw missingImage();
  }

  return bytes;
}

/**
 * Identifies the image from its magic bytes.
 *
 * Deliberately ignores the client-supplied Content-Type: it is trivially
 * spoofed and frequently just wrong from mobile upload libraries.
 */
export function detectImageType(bytes: Buffer): ImageType {
  if (hasSignature(bytes, JPEG_SIGNATURE)) {
    return "jpeg";
  }
  if (hasSignature(bytes, PNG_SIGNATURE)) {
    return "png";
  }
  throw unsupportedFileType();
}

function extractBase64Payload(value: string): string {
  if (!value.startsWith("data:")) {
    return value;
  }

  const commaIndex = value.indexOf(",");
  if (commaIndex === -1) {
    throw invalidBase64();
  }

  const metadata = value.slice(5, commaIndex).toLowerCase();
  if (!/(?:^|;)base64$/.test(metadata)) {
    throw invalidBase64();
  }

  return value.slice(commaIndex + 1);
}

/**
 * Restores `=` padding.
 *
 * Several HTTP clients and base64url encoders strip it, and Node decodes an
 * unpadded string to truncated bytes rather than failing, so we pad before
 * validating instead of rejecting an otherwise-valid image.
 */
function padBase64(value: string): string {
  const remainder = value.length % 4;
  if (remainder === 0) {
    return value;
  }
  return `${value}${"=".repeat(4 - remainder)}`;
}

function hasSignature(bytes: Buffer, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) {
    return false;
  }
  return signature.every((byte, index) => bytes[index] === byte);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getUploadedFile(req: Request): Buffer | undefined {
  const file = (req as Request & { file?: unknown }).file;
  if (!isRecord(file) || !Buffer.isBuffer(file["buffer"])) {
    return undefined;
  }

  return file["buffer"];
}
