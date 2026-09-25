import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { ImageProcessClient } from "../src/sdk/client.js";

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    allowPrivateUrls: true,
    fetchTimeoutMs: 5_000,
    maxImageBytes: 20 * 1024 * 1024,
    maxVideoBytes: 1024 * 1024,
    maxDimension: 4096,
    ...overrides,
  };
}

async function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe("HTTP API", () => {
  let image: Buffer;
  let imageServer: Server;
  let redirectServer: Server;
  let hangingServer: Server;
  let imageUrl = "";
  const hangingSockets = new Set<import("node:net").Socket>();

  beforeAll(async () => {
    image = await sharp({
      create: { width: 40, height: 20, channels: 3, background: { r: 10, g: 120, b: 200 } },
    })
      .png()
      .toBuffer();

    imageServer = createServer((req, res) => {
      if (req.url === "/missing") {
        res.writeHead(404).end("missing");
        return;
      }
      if (req.url === "/html") {
        res.writeHead(200, { "Content-Type": "text/html" }).end("<html></html>");
        return;
      }
      if (req.url === "/empty") {
        res.writeHead(200, { "Content-Type": "image/png" }).end();
        return;
      }
      res.writeHead(200, { "Content-Type": "image/png" }).end(image);
    });

    const imagePort = await listen(imageServer);
    imageUrl = `http://127.0.0.1:${imagePort}/photo.png`;

    redirectServer = createServer((_req, res) => {
      res.writeHead(302, { Location: imageUrl }).end();
    });
    const redirectPort = await listen(redirectServer);

    hangingServer = createServer((_req, res) => {
      void res;
    });
    hangingServer.on("connection", (socket) => {
      hangingSockets.add(socket);
      socket.on("close", () => hangingSockets.delete(socket));
    });
    const hangingPort = await listen(hangingServer);

    process.env.IMAGE_URL = imageUrl;
    process.env.REDIRECT_URL = `http://127.0.0.1:${redirectPort}/start`;
    process.env.HANGING_URL = `http://127.0.0.1:${hangingPort}/slow`;
  });

  afterAll(async () => {
    for (const socket of hangingSockets) {
      socket.destroy();
    }
    await Promise.all([close(imageServer), close(redirectServer), close(hangingServer)]);
  });

  it("reports health and the route index", async () => {
    const app = createApp(testConfig());
    await request(app).get("/health").expect(200, { status: "ok" });
    const index = await request(app).get("/").expect(200);
    expect(index.body.endpoints.process).toBe("/process");
  });

  it("rejects invalid parameters", async () => {
    const app = createApp(testConfig({ allowPrivateUrls: false }));

    const missing = await request(app).get("/process").expect(400);
    expect(missing.body.error.code).toBe("VALIDATION_ERROR");

    const huge = await request(app).get("/process").query({ url: imageUrl, width: 5000 }).expect(400);
    expect(huge.body.error.code).toBe("VALIDATION_ERROR");

    const quality = await request(app).get("/process").query({ url: imageUrl, quality: 0 }).expect(400);
    expect(quality.body.error.code).toBe("VALIDATION_ERROR");

    const format = await request(app).get("/process").query({ url: imageUrl, format: "bmp" }).expect(400);
    expect(format.body.error.code).toBe("VALIDATION_ERROR");

    const crop = await request(app).get("/process").query({ url: imageUrl, crop: "fill" }).expect(400);
    expect(crop.body.error.details.issues[0].path).toBe("crop");

    await request(app).post("/process").send("{").set("Content-Type", "application/json").expect(400);
    await request(app).get("/unknown").expect(404);
  });

  it("blocks private and malformed URLs", async () => {
    const app = createApp(testConfig({ allowPrivateUrls: false }));

    const local = await request(app).get("/process").query({ url: "http://127.0.0.1/a.jpg", width: 10 }).expect(403);
    expect(local.body.error.code).toBe("BLOCKED_URL");

    const decimal = await request(app).get("/process").query({ url: "http://2130706433/a.jpg" }).expect(403);
    expect(decimal.body.error.code).toBe("BLOCKED_URL");

    const credentials = await request(app).get("/process").query({ url: "https://user:pass@example.com/a.jpg" }).expect(400);
    expect(credentials.body.error.code).toBe("INVALID_URL");

    const ftp = await request(app).get("/process").query({ url: "ftp://example.com/a.jpg" }).expect(400);
    expect(ftp.body.error.code).toBe("INVALID_URL");
  });

  it("resizes and converts a remote image", async () => {
    const app = createApp(testConfig());
    const response = await request(app)
      .get("/process")
      .query({ url: imageUrl, width: 800, height: 600, format: "jpg", quality: 80, crop: "fill" })
      .expect(200);

    expect(response.headers["content-type"]).toMatch(/image\/jpeg/);
    expect(response.headers["x-image-width"]).toBe("800");
    expect(response.headers["x-image-height"]).toBe("600");
    expect(response.headers["x-image-format"]).toBe("jpeg");
    expect(response.body.subarray(0, 2).toString("hex")).toBe("ffd8");

    const metadata = await sharp(response.body).metadata();
    expect(metadata.width).toBe(800);
    expect(metadata.height).toBe(600);
    expect(metadata.format).toBe("jpeg");
  });

  it("accepts the same request as JSON", async () => {
    const app = createApp(testConfig());
    const response = await request(app)
      .post("/process")
      .send({ url: imageUrl, width: 20, format: "webp" })
      .expect(200);

    expect(response.headers["content-type"]).toMatch(/image\/webp/);
    expect(response.headers["x-image-format"]).toBe("webp");
    const metadata = await sharp(response.body).metadata();
    expect(metadata.width).toBe(20);
    expect(metadata.format).toBe("webp");
  });

  it("follows a redirect back to the fixture", async () => {
    const app = createApp(testConfig());
    const response = await request(app).get("/process").query({ url: process.env.REDIRECT_URL, width: 10 }).expect(200);
    expect(response.headers["x-image-width"]).toBe("10");
  });

  it("reports upstream status, bad media, timeouts, and oversized downloads", async () => {
    const app = createApp(testConfig({ fetchTimeoutMs: 300, maxImageBytes: 40 }));
    const base = imageUrl.replace("/photo.png", "");

    const missing = await request(app).get("/process").query({ url: `${base}/missing` }).expect(502);
    expect(missing.body.error.code).toBe("UPSTREAM_ERROR");

    const html = await request(app).get("/process").query({ url: `${base}/html` }).expect(415);
    expect(html.body.error.code).toBe("UNSUPPORTED_MEDIA");

    const empty = await request(app).get("/process").query({ url: `${base}/empty` }).expect(415);
    expect(empty.body.error.code).toBe("UNSUPPORTED_MEDIA");

    const oversized = await request(app).get("/process").query({ url: imageUrl, width: 10 }).expect(413);
    expect(oversized.body.error.code).toBe("PAYLOAD_TOO_LARGE");

    const timeoutApp = createApp(testConfig({ fetchTimeoutMs: 200 }));
    const timeout = await request(timeoutApp).get("/process").query({ url: process.env.HANGING_URL }).expect(504);
    expect(timeout.body.error.code).toBe("UPSTREAM_TIMEOUT");
  });

  it("rejects an image URL on the video route and validates thumbnail parameters", async () => {
    const app = createApp(testConfig());
    const missing = await request(app).get("/video/thumbnail").expect(400);
    expect(missing.body.error.code).toBe("VALIDATION_ERROR");

    const time = await request(app).get("/video/thumbnail").query({ url: imageUrl, time: -1 }).expect(400);
    expect(time.body.error.code).toBe("VALIDATION_ERROR");

    const imagePayload = await request(app).get("/video/thumbnail").query({ url: imageUrl, time: 15 }).expect(415);
    expect(imagePayload.body.error.code).toBe("UNSUPPORTED_MEDIA");
  });

  it("serves the client SDK against the running API", async () => {
    const app = createApp(testConfig());
    const server = app.listen(0, "127.0.0.1");
    const port = await new Promise<number>((resolve) => {
      server.once("listening", () => resolve((server.address() as AddressInfo).port));
    });

    try {
      const client = new ImageProcessClient({ baseUrl: `http://127.0.0.1:${port}` });
      expect(client.processUrl({ url: "https://example.com/a b.jpg", width: 12, format: "webp", crop: "fill" })).toBe(
        `http://127.0.0.1:${port}/process?url=https%3A%2F%2Fexample.com%2Fa+b.jpg&width=12&format=webp&crop=fill`,
      );

      const result = await client.process({ url: imageUrl, width: 16, height: 16, crop: "fill", format: "png" });
      expect(result.contentType).toMatch(/image\/png/);
      expect(result.width).toBe(16);
      expect(result.height).toBe(16);
      expect(result.format).toBe("png");
    } finally {
      await close(server);
    }
  });
});
