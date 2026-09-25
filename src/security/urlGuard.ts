import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { ApiError } from "../errors.js";

const MAX_URL_LENGTH = 2048;

/**
 * Reject hosts that would let a caller reach loopback, link-local, or RFC1918
 * addresses through this service. Decimal and octal spellings are normalized
 * first so they cannot skip the check.
 */
export async function assertPublicHttpUrl(raw: string, allowPrivate: boolean): Promise<URL> {
  if (raw.length > MAX_URL_LENGTH) {
    throw new ApiError(400, "INVALID_URL", `url must be at most ${MAX_URL_LENGTH} characters`);
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError(400, "INVALID_URL", "url must be an absolute http(s) URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiError(400, "INVALID_URL", "only http and https URLs are supported");
  }

  if (url.username || url.password) {
    throw new ApiError(400, "INVALID_URL", "URLs with embedded credentials are not allowed");
  }

  if (!url.hostname) {
    throw new ApiError(400, "INVALID_URL", "url must include a host");
  }

  if (!allowPrivate) {
    await assertPublicHost(url.hostname);
  }

  return url;
}

export async function assertPublicHost(hostname: string): Promise<void> {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();

  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local")) {
    throw blocked();
  }

  const literal = coerceIp(normalized);
  if (literal) {
    if (isBlockedAddress(literal)) {
      throw blocked();
    }
    return;
  }

  let records: { address: string }[];
  try {
    records = await lookup(normalized, { all: true, verbatim: true });
  } catch {
    throw new ApiError(400, "HOST_UNRESOLVED", "url host could not be resolved");
  }

  if (records.length === 0 || records.some((record) => isBlockedAddress(record.address))) {
    throw blocked();
  }
}

function blocked(): ApiError {
  return new ApiError(403, "BLOCKED_URL", "Refusing to fetch a private, loopback, or reserved address");
}

export function isBlockedAddress(address: string): boolean {
  const bare = address.toLowerCase();
  const mapped = bare.startsWith("::ffff:") ? bare.slice("::ffff:".length) : bare;
  if (isIP(mapped) === 4) {
    return isBlockedIpv4(mapped);
  }

  if (bare === "::1" || bare === "::") {
    return true;
  }

  // fc00::/7 unique local, fe80::/10 link-local.
  if (bare.startsWith("fc") || bare.startsWith("fd")) {
    return true;
  }

  const linkLocal = /^fe[89ab]/i.test(bare);
  return linkLocal;
}

function isBlockedIpv4(ip: string): boolean {
  const [a, b, c] = ip.split(".").map((part) => Number(part));
  if (a === undefined || b === undefined || c === undefined) {
    return true;
  }

  if (a === 0 || a === 10 || a === 127) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  if (a === 192 && b === 0 && (c === 0 || c === 2)) {
    return true;
  }
  if (a === 198 && (b === 18 || b === 19)) {
    return true;
  }
  if (a === 198 && b === 51 && c === 100) {
    return true;
  }
  if (a === 203 && b === 0 && c === 113) {
    return true;
  }
  if (a >= 224) {
    return true;
  }

  return false;
}

function coerceIp(hostname: string): string | null {
  if (isIP(hostname)) {
    return hostname;
  }

  if (/^\d+$/.test(hostname)) {
    return decimalToIpv4(Number(hostname));
  }

  if (/^0x[0-9a-f]+$/i.test(hostname)) {
    return decimalToIpv4(Number(hostname));
  }

  if (hostname.includes(".")) {
    const parts = hostname.split(".");
    if (parts.length === 4 && parts.every((part) => /^[0-9]+$/.test(part) || /^0x[0-9a-f]+$/i.test(part))) {
      const numbers = parts.map((part) => {
        if (/^0x/i.test(part)) {
          return Number(part);
        }
        if (part.length > 1 && part.startsWith("0")) {
          return Number.parseInt(part, 8);
        }
        return Number(part);
      });
      if (numbers.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
        return numbers.join(".");
      }
    }
  }

  return null;
}

function decimalToIpv4(value: number): string | null {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    return null;
  }

  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
}
