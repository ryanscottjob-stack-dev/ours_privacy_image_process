import type { NextFunction, Request, Response } from "express";

import type { AppConfig } from "../config.js";
import { ApiError, isApiError } from "../errors.js";
import { parseProcessRequest, parseVideoRequest } from "../schemas.js";
import { fetchAsset } from "../services/fetchAsset.js";
import { processImage } from "../services/processImage.js";
import { createVideoThumbnail } from "../services/videoThumbnail.js";
import type { ProcessedImage } from "../types.js";

export async function handleProcess(req: Request, res: Response, next: NextFunction, config: AppConfig): Promise<void> {
  try {
    const params = parseProcessRequest(requestInput(req));
    const asset = await fetchAsset(params.url, {
      allowPrivateUrls: config.allowPrivateUrls,
      timeoutMs: config.fetchTimeoutMs,
      maxBytes: config.maxImageBytes,
    });
    rejectNonImagePayload(asset.contentType);
    const image = await processImage(asset.buffer, params);
    sendImage(res, image);
  } catch (error) {
    next(error);
  }
}

export async function handleVideoThumbnail(req: Request, res: Response, next: NextFunction, config: AppConfig): Promise<void> {
  try {
    const params = parseVideoRequest(requestInput(req));
    const asset = await fetchAsset(params.url, {
      allowPrivateUrls: config.allowPrivateUrls,
      timeoutMs: config.fetchTimeoutMs,
      maxBytes: config.maxVideoBytes,
    });
    rejectNonVideoPayload(asset.contentType);
    const image = await createVideoThumbnail(asset.buffer, params);
    sendImage(res, image);
  } catch (error) {
    next(error);
  }
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "No route matches this request",
    },
  });
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (isApiError(error)) {
    res.status(error.status).json({ error: errorBody(error.code, error.message, error.details) });
    return;
  }

  if (isJsonParseError(error)) {
    res.status(400).json({
      error: errorBody("VALIDATION_ERROR", "Request body must be valid JSON"),
    });
    return;
  }

  console.error(error);
  res.status(500).json({
    error: errorBody("INTERNAL_ERROR", "Unexpected server error"),
  });
}

function requestInput(req: Request): unknown {
  return req.method === "GET" ? req.query : req.body;
}

function sendImage(res: Response, image: ProcessedImage): void {
  res.status(200);
  res.setHeader("Content-Type", image.contentType);
  res.setHeader("Content-Length", image.data.length);
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.setHeader("X-Image-Width", String(image.width));
  res.setHeader("X-Image-Height", String(image.height));
  res.setHeader("X-Image-Format", image.format);
  res.send(image.data);
}

function rejectNonImagePayload(contentType: string): void {
  if (contentType.includes("svg") || contentType.startsWith("text/") || contentType.includes("html") || contentType.includes("json")) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA", "The remote URL did not return a supported image");
  }
}

function rejectNonVideoPayload(contentType: string): void {
  if (contentType.startsWith("text/") || contentType.includes("html") || contentType.includes("json") || contentType.startsWith("image/")) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA", "The remote URL did not return a video");
  }
}

function errorBody(code: string, message: string, details?: Record<string, unknown>) {
  return details ? { code, message, details } : { code, message };
}

function isJsonParseError(error: unknown): boolean {
  if (!(error instanceof SyntaxError)) {
    return false;
  }
  const typed = error as SyntaxError & { status?: number; type?: string };
  return typed.type === "entity.parse.failed" || typed.status === 400;
}
