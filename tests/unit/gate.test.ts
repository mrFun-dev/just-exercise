import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/errors.js";
import {
  decodeBase64Image,
  detectImageType,
} from "../../src/odometer/gate.js";
import { MINIMAL_GIF, MINIMAL_JPEG, MINIMAL_PNG } from "../helpers.js";

describe("decodeBase64Image", () => {
  it("accepts raw base64, data URLs and unpadded input; rejects the rest", () => {
    const raw = MINIMAL_PNG.toString("base64");

    expect(decodeBase64Image(raw)).toEqual(MINIMAL_PNG);
    expect(decodeBase64Image(`data:image/png;base64,${raw}`)).toEqual(
      MINIMAL_PNG,
    );
    expect(
      decodeBase64Image(MINIMAL_JPEG.toString("base64").replace(/=+$/, "")),
    ).toEqual(MINIMAL_JPEG);

    expect(() => decodeBase64Image("not base64!!!")).toThrow(ApiError);
    expect(() => decodeBase64Image("data:image/png,rawbytes")).toThrow(ApiError);
    expect(() => decodeBase64Image("   ")).toThrow(ApiError);
  });


});

describe("detectImageType", () => {
  it("identifies jpeg and png from their magic bytes, and nothing else", () => {
    expect(detectImageType(MINIMAL_JPEG)).toBe("jpeg");
    expect(detectImageType(MINIMAL_PNG)).toBe("png");

    expect(() => detectImageType(MINIMAL_GIF)).toThrow(ApiError);
    expect(() => detectImageType(Buffer.from("hello"))).toThrow(ApiError);
    // Shorter than a signature — must not read past the end of the buffer.
    expect(() => detectImageType(Buffer.from([0xff, 0xd8]))).toThrow(ApiError);
  });
});
