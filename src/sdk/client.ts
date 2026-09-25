import type { CropMode, Gravity, OutputFormat } from "../types.js";

export type ProcessParams = {
  url: string;
  width?: number;
  height?: number;
  format?: OutputFormat | "jpg";
  quality?: number;
  crop?: CropMode;
  gravity?: Gravity;
  background?: string;
};

export type VideoThumbnailParams = ProcessParams & {
  time?: number;
};

export type ImageResult = {
  data: Uint8Array;
  contentType: string;
  width: number;
  height: number;
  format: string;
};

export class ImageProcessError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ImageProcessError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type ImageProcessClientOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
};

/**
 * Small client for the image processing API.
 * `processUrl` builds a URL that can be used directly as an `<img>` source.
 */
export class ImageProcessClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ImageProcessClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  processUrl(params: ProcessParams): string {
    return this.endpoint("/process", params);
  }

  videoThumbnailUrl(params: VideoThumbnailParams): string {
    return this.endpoint("/video/thumbnail", params);
  }

  async process(params: ProcessParams): Promise<ImageResult> {
    return this.fetchImage(this.processUrl(params));
  }

  async videoThumbnail(params: VideoThumbnailParams): Promise<ImageResult> {
    return this.fetchImage(this.videoThumbnailUrl(params));
  }

  private endpoint(pathname: string, params: ProcessParams | VideoThumbnailParams): string {
    const url = new URL(pathname, `${this.baseUrl}/`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private async fetchImage(url: string): Promise<ImageResult> {
    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw await toClientError(response);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      data: bytes,
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      width: numberHeader(response, "x-image-width"),
      height: numberHeader(response, "x-image-height"),
      format: response.headers.get("x-image-format") ?? "",
    };
  }
}

async function toClientError(response: Response): Promise<ImageProcessError> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string; details?: unknown } };
    return new ImageProcessError(
      response.status,
      body.error?.code ?? "REQUEST_FAILED",
      body.error?.message ?? response.statusText,
      body.error?.details,
    );
  } catch {
    return new ImageProcessError(response.status, "REQUEST_FAILED", response.statusText || "Request failed");
  }
}

function numberHeader(response: Response, name: string): number {
  const parsed = Number(response.headers.get(name));
  return Number.isFinite(parsed) ? parsed : 0;
}
