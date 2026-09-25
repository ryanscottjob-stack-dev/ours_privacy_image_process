import { z } from "zod";

import { ApiError } from "./errors.js";
import {
  CROP_MODES,
  GRAVITIES,
  MAX_DIMENSION,
  OUTPUT_FORMATS,
  type OutputFormat,
  type TransformOptions,
  type VideoThumbnailOptions,
} from "./types.js";

const hexColor = /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

const transformShape = {
  width: z.coerce.number().int().positive().max(MAX_DIMENSION).optional(),
  height: z.coerce.number().int().positive().max(MAX_DIMENSION).optional(),
  format: z.enum(OUTPUT_FORMATS).optional(),
  quality: z.coerce.number().int().min(1).max(100).optional(),
  crop: z.enum(CROP_MODES).optional(),
  gravity: z.enum(GRAVITIES).optional(),
  background: z.string().trim().regex(hexColor, "background must be a hex color").optional(),
};

const processSchema = z
  .object({
    url: z.string().trim().min(1, "url is required"),
    ...transformShape,
  })
  .strict()
  .superRefine((value, ctx) => {
    const needsDimension =
      value.crop === "crop" || value.crop === "fill" || value.crop === "pad" || value.crop === "thumb" || value.crop === "scale";
    if (needsDimension && value.width === undefined && value.height === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["crop"],
        message: `crop=${value.crop} requires width or height`,
      });
    }
  });

const videoSchema = z
  .object({
    url: z.string().trim().min(1, "url is required"),
    time: z.coerce.number().min(0).max(86_400).optional(),
    ...transformShape,
  })
  .strict();

export function parseProcessRequest(input: unknown): { url: string } & TransformOptions {
  return parseWith(processSchema, input);
}

export function parseVideoRequest(input: unknown): { url: string } & VideoThumbnailOptions {
  const parsed = parseWith(videoSchema, input);
  return { ...parsed, time: parsed.time ?? 0 };
}

function parseWith<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(normalizeInput(input));
  if (result.success) {
    return result.data;
  }

  throw new ApiError(400, "VALIDATION_ERROR", "Request parameters are invalid", {
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}

function normalizeInput(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return input;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === "" || value === null || value === undefined) {
      continue;
    }
    normalized[key] = typeof value === "string" ? value.trim() : value;
  }

  lowercase(normalized, "format");
  lowercase(normalized, "crop");
  lowercase(normalized, "gravity");
  if (normalized.format === "jpg") {
    normalized.format = "jpeg" satisfies OutputFormat;
  }

  return normalized;
}

function lowercase(record: Record<string, unknown>, key: string): void {
  const value = record[key];
  if (typeof value === "string") {
    record[key] = value.toLowerCase();
  }
}
