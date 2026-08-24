import type { NextFunction, Request, Response } from "express";
import {
  ApiError,
  invalidJson,
  ocrProviderError,
  payloadTooLarge,
} from "./errors.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPayloadTooLargeError(err: unknown): boolean {
  return isRecord(err) && err["type"] === "entity.too.large";
}

function isJsonParseError(err: unknown): boolean {
  return isRecord(err) && err["type"] === "entity.parse.failed";
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  const apiError = toApiError(err);
  res.status(apiError.status).json({
    error: apiError.code,
    message: apiError.message,
  });
}

function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) {
    return err;
  }
  if (isPayloadTooLargeError(err)) {
    return payloadTooLarge();
  }
  if (isJsonParseError(err)) {
    return invalidJson();
  }
  // Anything unrecognised reaching here came out of the OCR provider —
  // it is the only part of the request path allowed to throw.
  return ocrProviderError();
}
