import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { ApiError } from "../src/errors.js";
import { processImage } from "../src/services/processImage.js";

async function fixture(): Promise<Buffer> {
  return sharp({
    create: {
      width: 40,
      height: 20,
      channels: 3,
      background: { r: 220, g: 30, b: 30 },
    },
  })
    .png()
    .toBuffer();
}

describe("processImage", () => {
  it("returns the original bytes when no transform is requested", async () => {
    const input = await fixture();
    const result = await processImage(input, {});
    expect(result.data.equals(input)).toBe(true);
    expect(result).toMatchObject({ format: "png", width: 40, height: 20, contentType: "image/png" });
  });

  it("resizes to the exact width and height from the process API", async () => {
    const result = await processImage(await fixture(), { width: 10, height: 8 });
    expect(result).toMatchObject({ width: 10, height: 8 });
  });

  it("keeps the aspect ratio when only one dimension is set", async () => {
    const result = await processImage(await fixture(), { width: 20 });
    expect(result).toMatchObject({ width: 20, height: 10 });
  });

  it("fits inside the requested box and preserves aspect ratio", async () => {
    const result = await processImage(await fixture(), { width: 10, height: 10, crop: "fit" });
    expect(result.width).toBe(10);
    expect(result.height).toBe(5);
  });

  it("fills, pads, and scales to the exact box", async () => {
    const input = await fixture();
    for (const crop of ["fill", "pad", "scale"] as const) {
      const result = await processImage(input, { width: 10, height: 10, crop });
      expect(result.width, crop).toBe(10);
      expect(result.height, crop).toBe(10);
    }
  });

  it("does not enlarge when crop is limit", async () => {
    const result = await processImage(await fixture(), { width: 1000, height: 1000, crop: "limit" });
    expect(result.width).toBe(40);
    expect(result.height).toBe(20);
  });

  it("converts PNG to JPEG", async () => {
    const result = await processImage(await fixture(), { format: "jpeg", quality: 80 });
    expect(result.format).toBe("jpeg");
    expect(result.contentType).toBe("image/jpeg");
    expect(result.data.subarray(0, 2).toString("hex")).toBe("ffd8");
  });

  it("extracts a region without scaling", async () => {
    const result = await processImage(await fixture(), { width: 10, height: 10, crop: "crop", gravity: "west" });
    expect(result).toMatchObject({ width: 10, height: 10, format: "png" });
  });

  it("rejects a crop larger than the source", async () => {
    await expect(processImage(await fixture(), { width: 80, height: 80, crop: "crop" })).rejects.toMatchObject({
      status: 422,
      code: "CROP_OUT_OF_BOUNDS",
    });
  });

  it("rejects files that are not images", async () => {
    await expect(processImage(Buffer.from("hello"), {})).rejects.toBeInstanceOf(ApiError);
    await expect(processImage(Buffer.from("hello"), {})).rejects.toMatchObject({
      status: 415,
      code: "UNSUPPORTED_MEDIA",
    });
  });
});
