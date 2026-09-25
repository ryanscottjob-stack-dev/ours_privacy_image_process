import { describe, expect, it } from "vitest";

import { ApiError } from "../src/errors.js";
import { assertPublicHttpUrl } from "../src/security/urlGuard.js";

describe("assertPublicHttpUrl", () => {
  it("allows a public address literal", async () => {
    const url = await assertPublicHttpUrl("https://1.1.1.1/photo.jpg", false);
    expect(url.hostname).toBe("1.1.1.1");
  });

  it.each([
    "http://127.0.0.1/a.jpg",
    "http://localhost/a.jpg",
    "http://10.1.2.3/a.jpg",
    "http://192.168.0.5/a.jpg",
    "http://172.16.0.1/a.jpg",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/a.jpg",
    "http://2130706433/a.jpg",
    "http://0x7f000001/a.jpg",
    "http://0177.0.0.1/a.jpg",
  ])("blocks %s", async (raw) => {
    await expect(assertPublicHttpUrl(raw, false)).rejects.toMatchObject({
      status: 403,
      code: "BLOCKED_URL",
    });
  });

  it("rejects non-http protocols and embedded credentials before any lookup", async () => {
    await expect(assertPublicHttpUrl("ftp://example.com/a.jpg", false)).rejects.toBeInstanceOf(ApiError);
    await expect(assertPublicHttpUrl("https://user:pass@example.com/a.jpg", false)).rejects.toMatchObject({
      status: 400,
      code: "INVALID_URL",
    });
    await expect(assertPublicHttpUrl("not a url", false)).rejects.toMatchObject({
      code: "INVALID_URL",
    });
  });

  it("permits private hosts when the caller opts in", async () => {
    const url = await assertPublicHttpUrl("http://127.0.0.1/a.jpg", true);
    expect(url.hostname).toBe("127.0.0.1");
  });
});
