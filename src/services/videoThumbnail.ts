import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ApiError } from "../errors.js";
import { processImage } from "./processImage.js";
import type { ProcessedImage, VideoThumbnailOptions } from "../types.js";

let ffmpegAvailable: Promise<boolean> | undefined;

export async function createVideoThumbnail(input: Buffer, options: VideoThumbnailOptions): Promise<ProcessedImage> {
  if (input.length === 0) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA", "The remote file is empty");
  }

  if (!(await isFfmpegAvailable())) {
    throw new ApiError(503, "FFMPEG_UNAVAILABLE", "ffmpeg is not installed, so video thumbnails are unavailable");
  }

  const directory = await mkdtemp(path.join(tmpdir(), "image-process-"));
  const inputPath = path.join(directory, `${randomUUID()}.bin`);
  const outputPath = path.join(directory, `${randomUUID()}.jpg`);

  try {
    await writeFile(inputPath, input);
    await runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      options.time.toFixed(3),
      "-i",
      inputPath,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      outputPath,
    ]);

    const frame = await readFile(outputPath);
    return processImage(frame, {
      width: options.width,
      height: options.height,
      format: options.format ?? "jpeg",
      quality: options.quality,
      crop: options.crop,
      gravity: options.gravity,
      background: options.background,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(422, "PROCESSING_FAILED", "A thumbnail could not be extracted at the requested time");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function isFfmpegAvailable(): Promise<boolean> {
  ffmpegAvailable ??= new Promise((resolve) => {
    const child = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
    child.once("error", () => resolve(false));
    child.once("exit", (code) => resolve(code === 0));
  });
  return ffmpegAvailable;
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", () => {
      reject(new ApiError(503, "FFMPEG_UNAVAILABLE", "ffmpeg is not installed, so video thumbnails are unavailable"));
    });
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
  });
}
