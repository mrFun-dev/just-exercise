import { MAX_PAYLOAD_BYTES } from "./config.js";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function payloadTooLarge(): ApiError {
  const megabytes = MAX_PAYLOAD_BYTES / (1024 * 1024);
  return new ApiError(
    413,
    "PAYLOAD_TOO_LARGE",
    `Request payload exceeds the ${megabytes}MB limit`,
  );
}

export function missingImage(): ApiError {
  return new ApiError(400, "MISSING_IMAGE", "An image is required");
}

export function invalidBase64(): ApiError {
  return new ApiError(
    400,
    "INVALID_BASE64",
    "The image is not valid base64",
  );
}

export function invalidUpload(): ApiError {
  return new ApiError(
    400,
    "INVALID_UPLOAD",
    "The uploaded file could not be read",
  );
}

export function unsupportedFileType(): ApiError {
  return new ApiError(
    415,
    "UNSUPPORTED_FILE_TYPE",
    "Only JPEG and PNG images are accepted",
  );
}

export function invalidJson(): ApiError {
  return new ApiError(
    400,
    "INVALID_JSON",
    "Request body is not valid JSON",
  );
}

export function unreadableImage(): ApiError {
  return new ApiError(
    422,
    "UNREADABLE_IMAGE",
    "Could not extract a mileage reading from the provided image",
  );
}

export function ocrProviderError(): ApiError {
  return new ApiError(
    500,
    "OCR_PROVIDER_ERROR",
    "Failed to extract a reading from the image",
  );
}
