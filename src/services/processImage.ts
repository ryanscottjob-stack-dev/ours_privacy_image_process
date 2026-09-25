import sharp, { type FitEnum, type Gravity as SharpGravity } from "sharp";

import { ApiError } from "../errors.js";
import {
  contentTypeFor,
  isOutputFormat,
  type CropMode,
  type Gravity,
  type OutputFormat,
  type ProcessedImage,
  type Rgba,
  type TransformOptions,
} from "../types.js";

const INPUT_FORMATS = new Set(["jpeg", "png", "webp", "gif", "tif", "tiff", "avif", "heif"]);

const SHARP_FIT: Record<Exclude<CropMode, "crop">, keyof FitEnum> = {
  scale: "fill",
  fit: "inside",
  fill: "cover",
  pad: "contain",
  limit: "inside",
  thumb: "cover",
};

export async function processImage(input: Buffer, options: TransformOptions): Promise<ProcessedImage> {
  if (input.length === 0) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA", "The remote file is empty");
  }

  let image = sharp(input, {
    failOn: "error",
    limitInputPixels: 40_000_000,
    animated: false,
    pages: 1,
  }).rotate();

  let metadata: sharp.Metadata;
  try {
    metadata = await image.metadata();
  } catch {
    throw new ApiError(415, "UNSUPPORTED_MEDIA", "The remote file is not a supported image");
  }

  if (!metadata.format || !INPUT_FORMATS.has(metadata.format) || !metadata.width || !metadata.height) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA", "The remote file is not a supported raster image");
  }

  const requestedFormat = options.format;
  const sourceFormat = metadata.format === "tif" ? "tiff" : metadata.format === "heif" ? "jpeg" : metadata.format;
  if (!isOutputFormat(sourceFormat) && !requestedFormat) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA", "The source image format cannot be delivered");
  }

  const outputFormat: OutputFormat = requestedFormat ?? (sourceFormat as OutputFormat);
  const background = parseHexColor(options.background);
  const hasTransform = hasDimension(options) || Boolean(options.crop) || Boolean(requestedFormat) || options.quality !== undefined;

  if (!hasTransform && isOutputFormat(metadata.format === "tif" ? "tiff" : metadata.format)) {
    return {
      data: input,
      format: outputFormat,
      width: metadata.width,
      height: metadata.height,
      contentType: contentTypeFor(outputFormat),
    };
  }

  try {
    image = applyTransform(image, options, metadata, background);

    if (outputFormat === "jpeg") {
      image = image.flatten({ background });
    }

    image = applyFormat(image, outputFormat, options.quality ?? 80);
    const { data, info } = await image.toBuffer({ resolveWithObject: true });
    const delivered = info.format === "tif" ? "tiff" : info.format;

    if (!isOutputFormat(delivered)) {
      throw new ApiError(422, "PROCESSING_FAILED", "The image could not be encoded in the requested format");
    }

    return {
      data,
      format: delivered,
      width: info.width,
      height: info.height,
      contentType: contentTypeFor(delivered),
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(422, "PROCESSING_FAILED", "The image could not be processed");
  }
}

function applyTransform(
  image: sharp.Sharp,
  options: TransformOptions,
  metadata: sharp.Metadata,
  background: Rgba,
): sharp.Sharp {
  const width = options.width;
  const height = options.height;
  const crop = options.crop ?? defaultCrop(width, height);

  if (!crop || (!width && !height)) {
    return image;
  }

  if (crop === "crop") {
    return extractRegion(image, metadata, width, height, options.gravity ?? "center");
  }

  return image.resize({
    width,
    height,
    fit: SHARP_FIT[crop],
    position: toSharpGravity(options.gravity ?? (crop === "thumb" ? "attention" : "center")),
    background,
    withoutEnlargement: crop === "limit",
  });
}

function extractRegion(
  image: sharp.Sharp,
  metadata: sharp.Metadata,
  width: number | undefined,
  height: number | undefined,
  gravity: Gravity,
): sharp.Sharp {
  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.height ?? 0;
  const cropWidth = width ?? sourceWidth;
  const cropHeight = height ?? sourceHeight;

  if (cropWidth > sourceWidth || cropHeight > sourceHeight) {
    throw new ApiError(
      422,
      "CROP_OUT_OF_BOUNDS",
      "crop=crop cannot request a region larger than the source image",
      { sourceWidth, sourceHeight, width: cropWidth, height: cropHeight },
    );
  }

  const { left, top } = regionOrigin(gravity, sourceWidth, sourceHeight, cropWidth, cropHeight);
  return image.extract({ left, top, width: cropWidth, height: cropHeight });
}

function regionOrigin(
  gravity: Gravity,
  sourceWidth: number,
  sourceHeight: number,
  cropWidth: number,
  cropHeight: number,
): { left: number; top: number } {
  const extraX = sourceWidth - cropWidth;
  const extraY = sourceHeight - cropHeight;
  const centerX = Math.floor(extraX / 2);
  const centerY = Math.floor(extraY / 2);

  switch (gravity) {
    case "north":
      return { left: centerX, top: 0 };
    case "south":
      return { left: centerX, top: extraY };
    case "east":
      return { left: extraX, top: centerY };
    case "west":
      return { left: 0, top: centerY };
    case "northeast":
      return { left: extraX, top: 0 };
    case "northwest":
      return { left: 0, top: 0 };
    case "southeast":
      return { left: extraX, top: extraY };
    case "southwest":
      return { left: 0, top: extraY };
    case "center":
    case "attention":
    case "entropy":
    default:
      return { left: centerX, top: centerY };
  }
}

function toSharpGravity(gravity: Gravity): SharpGravity {
  if (gravity === "center") {
    return "centre";
  }
  return gravity;
}

function applyFormat(image: sharp.Sharp, format: OutputFormat, quality: number): sharp.Sharp {
  switch (format) {
    case "jpeg":
      return image.jpeg({ quality, mozjpeg: true });
    case "png":
      return image.png({ compressionLevel: compressionFromQuality(quality) });
    case "webp":
      return image.webp({ quality });
    case "avif":
      return image.avif({ quality });
    case "gif":
      return image.gif();
    case "tiff":
      return image.tiff({ quality });
  }
}

function compressionFromQuality(quality: number): number {
  return Math.max(0, Math.min(9, Math.round((100 - quality) / 11)));
}

function hasDimension(options: TransformOptions): boolean {
  return options.width !== undefined || options.height !== undefined;
}

function defaultCrop(width: number | undefined, height: number | undefined): CropMode | undefined {
  if (width !== undefined && height !== undefined) {
    return "scale";
  }
  if (width !== undefined || height !== undefined) {
    return "fit";
  }
  return undefined;
}

export function parseHexColor(input: string | undefined, fallback: Rgba = { r: 255, g: 255, b: 255, alpha: 1 }): Rgba {
  if (!input) {
    return fallback;
  }

  const stripped = input.startsWith("#") ? input.slice(1) : input;
  const hex = stripped.length === 3 ? stripped.split("").map((char) => char + char).join("") : stripped;
  const value = Number.parseInt(hex, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
    alpha: 1,
  };
}
