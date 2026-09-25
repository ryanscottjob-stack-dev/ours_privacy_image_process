import { MAX_DIMENSION } from "./types.js";

export type AppConfig = {
  port: number;
  allowPrivateUrls: boolean;
  fetchTimeoutMs: number;
  maxImageBytes: number;
  maxVideoBytes: number;
  maxDimension: number;
};

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: positiveInt(env.PORT, 3000, "PORT"),
    allowPrivateUrls: env.ALLOW_PRIVATE_URLS === "true",
    fetchTimeoutMs: positiveInt(env.FETCH_TIMEOUT_MS, 15_000, "FETCH_TIMEOUT_MS"),
    maxImageBytes: positiveInt(env.MAX_IMAGE_BYTES, 20 * 1024 * 1024, "MAX_IMAGE_BYTES"),
    maxVideoBytes: positiveInt(env.MAX_VIDEO_BYTES, 80 * 1024 * 1024, "MAX_VIDEO_BYTES"),
    maxDimension: MAX_DIMENSION,
  };
}
