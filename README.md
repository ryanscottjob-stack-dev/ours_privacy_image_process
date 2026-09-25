# Image Processing Service

HTTP API for resizing, cropping, and converting remote images. Pass an image URL and the transformations you want. The response is the processed image.

Video thumbnail extraction is included when `ffmpeg` is installed.

## Requirements

- Node.js 20 or newer
- `ffmpeg` on `PATH` only if you use `GET /video/thumbnail`

## Run

```bash
npm install
npm run dev
```

The server listens on `http://localhost:3000`. A production build uses:

```bash
npm run build
npm start
```

Copy `.env.example` to `.env` if you want to change ports, fetch limits, or the private-URL guard. This service reads environment variables from the process; it does not load `.env` automatically.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `ALLOW_PRIVATE_URLS` | `false` | Allow loopback and private hosts. Leave this off except for local fixtures. |
| `FETCH_TIMEOUT_MS` | `15000` | Per-request upstream timeout |
| `MAX_IMAGE_BYTES` | `20971520` | Largest image download (20 MB) |
| `MAX_VIDEO_BYTES` | `83886080` | Largest video download (80 MB) |

## Transform an image

`GET` and `POST /process` accept the same fields. `GET` reads the query string. `POST` reads a JSON body.

```bash
curl -L "http://localhost:3000/process?url=https://example.com/image.jpg&width=500&height=300" -o out.jpg

curl -L "http://localhost:3000/process?url=https://example.com/image.png&format=jpeg&quality=80" -o out.jpg

curl -L "http://localhost:3000/process?url=https://example.com/image.jpg&width=800&height=600&format=webp&crop=fill" -o out.webp
```

```bash
curl -X POST http://localhost:3000/process \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"https://example.com/image.jpg\",\"width\":800,\"height\":600,\"format\":\"webp\",\"crop\":\"fill\"}" \
  -o out.webp
```

| Field | Description |
| --- | --- |
| `url` | Required absolute `http` or `https` URL |
| `width`, `height` | Output size in pixels, from 1 to 4096. Both together resize to that exact size. One alone keeps the aspect ratio. |
| `format` | `jpeg` (`jpg`), `png`, `webp`, `avif`, `gif`, or `tiff`. Omit to keep the source format. |
| `quality` | `1`–`100`. Defaults to `80` for lossy formats. For PNG it maps to compression level. |
| `crop` | How `width` and `height` are applied. Defaults to `scale` when both are set, and to `fit` when only one is set. |
| `gravity` | Anchor for `fill`, `thumb`, and `crop`: `center`, `north`, `south`, `east`, `west`, the four corners, `attention`, or `entropy`. |
| `background` | Hex color, such as `#ffffff` or `#fff`. Used by `pad` and when flattening transparency into JPEG. |

Crop modes:

| Mode | Behavior |
| --- | --- |
| `fit` | Shrink or grow inside the box and keep the aspect ratio. |
| `limit` | Same as `fit`, but never enlarge. |
| `fill` | Fill the box and crop overflow. |
| `pad` | Fit inside the box and pad the remaining space with `background`. |
| `scale` | Stretch to the exact box. This is the default when both `width` and `height` are set. |
| `crop` | Cut a region at the requested size without scaling. The region cannot be larger than the source. |
| `thumb` | Fill the box using the visually interesting region when `gravity` is omitted. |

With no size, format, crop, or quality, the original bytes are returned for JPEG, PNG, WebP, GIF, AVIF, and TIFF. Animated images are flattened to the first frame when a transform is applied. SVG is rejected.

Successful responses use the image content type and these headers:

- `X-Image-Width`
- `X-Image-Height`
- `X-Image-Format`
- `Cache-Control: public, max-age=86400`

`GET /` lists the routes. `GET /health` returns `{ "status": "ok" }`.

## Video thumbnail

```bash
curl -L "http://localhost:3000/video/thumbnail?url=https://example.com/video.mp4&time=15&width=640&format=jpeg" -o thumb.jpg
```

`time` is seconds from the start and defaults to `0`. The same size, format, quality, and crop fields as `/process` are optional. If `ffmpeg` is missing, the route returns `503` with code `FFMPEG_UNAVAILABLE`.

## Errors

Failures are JSON:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request parameters are invalid",
    "details": {
      "issues": [{ "path": "width", "message": "Number must be greater than 0" }]
    }
  }
}
```

| HTTP | Code | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Missing or invalid parameters, or a body that is not JSON |
| 400 | `INVALID_URL` | URL is not absolute `http(s)`, has credentials, or is too long |
| 400 | `HOST_UNRESOLVED` | The host does not resolve |
| 403 | `BLOCKED_URL` | Host is loopback, private, link-local, or otherwise reserved |
| 404 | `NOT_FOUND` | Unknown route |
| 413 | `PAYLOAD_TOO_LARGE` | Download exceeds the configured limit |
| 415 | `UNSUPPORTED_MEDIA` | File is not a supported raster image, or not a video for thumbnails |
| 422 | `CROP_OUT_OF_BOUNDS` | `crop=crop` is larger than the source |
| 422 | `PROCESSING_FAILED` | The file could not be decoded or the frame could not be extracted |
| 502 | `UPSTREAM_ERROR` | Upstream status, redirect loop, or network failure |
| 503 | `FFMPEG_UNAVAILABLE` | Thumbnail requested without `ffmpeg` |
| 504 | `UPSTREAM_TIMEOUT` | Upstream exceeded `FETCH_TIMEOUT_MS` |

Each redirect is checked again before it is followed. Private and reserved targets are refused, including decimal and octal IP spellings such as `http://2130706433/`.

## Client

`src/sdk/client.ts` builds request URLs and reads the image response, including the size headers.

```ts
import { ImageProcessClient } from "./src/sdk/client.ts";

const client = new ImageProcessClient({ baseUrl: "http://localhost:3000" });

const src = client.processUrl({
  url: "https://example.com/image.jpg",
  width: 800,
  height: 600,
  format: "webp",
  crop: "fill",
});

const image = await client.process({
  url: "https://example.com/image.jpg",
  width: 500,
  height: 300,
});
```

`image.data` is the raw bytes. A non-2xx response throws `ImageProcessError` with `status`, `code`, and `message`.

## Tests

```bash
npm test
```

The suite covers parameter validation, the private-URL guard, resize and format conversion, upstream failures, and the client URL builder. Tests that fetch an image use a local fixture server and enable `ALLOW_PRIVATE_URLS` only inside that app instance.

## API description

`openapi.yaml` is the machine-readable description of the same routes.
