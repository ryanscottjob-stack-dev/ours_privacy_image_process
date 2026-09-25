import { ApiError } from "../errors.js";
import { assertPublicHttpUrl } from "../security/urlGuard.js";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 3;

export type FetchAssetOptions = {
  allowPrivateUrls: boolean;
  timeoutMs: number;
  maxBytes: number;
};

export type FetchedAsset = {
  buffer: Buffer;
  contentType: string;
  finalUrl: string;
};

export async function fetchAsset(rawUrl: string, options: FetchAssetOptions): Promise<FetchedAsset> {
  let current = await assertPublicHttpUrl(rawUrl, options.allowPrivateUrls);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(options.timeoutMs),
        headers: {
          Accept: "image/*,video/*,*/*;q=0.1",
          "User-Agent": "image-process-service/1.0",
        },
      });
    } catch (error) {
      throw toFetchError(error);
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      if (hop === MAX_REDIRECTS) {
        throw new ApiError(502, "UPSTREAM_ERROR", "The remote URL redirected too many times");
      }

      const location = response.headers.get("location");
      if (!location) {
        throw new ApiError(502, "UPSTREAM_ERROR", "The remote URL redirected without a Location header");
      }

      current = await assertPublicHttpUrl(new URL(location, current).toString(), options.allowPrivateUrls);
      continue;
    }

    if (!response.ok) {
      throw new ApiError(502, "UPSTREAM_ERROR", `Upstream responded with status ${response.status}`);
    }

    const buffer = await readLimitedBody(response, options.maxBytes);
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    return { buffer, contentType, finalUrl: current.toString() };
  }

  throw new ApiError(502, "UPSTREAM_ERROR", "The remote URL redirected too many times");
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, "PAYLOAD_TOO_LARGE", `Remote asset exceeds the ${maxBytes} byte limit`);
      }

      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw toFetchError(error);
  }

  return Buffer.concat(chunks);
}

function toFetchError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return new ApiError(504, "UPSTREAM_TIMEOUT", "Timed out while fetching the remote asset");
  }

  return new ApiError(502, "UPSTREAM_ERROR", "The remote asset could not be fetched");
}
