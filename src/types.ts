export const MAX_DIMENSION = 4096;

export const OUTPUT_FORMATS = ["jpeg", "png", "webp", "avif", "gif", "tiff"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export const CROP_MODES = ["scale", "fit", "fill", "crop", "pad", "limit", "thumb"] as const;
export type CropMode = (typeof CROP_MODES)[number];

export const GRAVITIES = [
  "center",
  "north",
  "south",
  "east",
  "west",
  "northeast",
  "northwest",
  "southeast",
  "southwest",
  "attention",
  "entropy",
] as const;
export type Gravity = (typeof GRAVITIES)[number];

export type Rgba = {
  r: number;
  g: number;
  b: number;
  alpha: number;
};

export type TransformOptions = {
  width?: number;
  height?: number;
  format?: OutputFormat;
  quality?: number;
  crop?: CropMode;
  gravity?: Gravity;
  background?: string;
};

export type ProcessedImage = {
  data: Buffer;
  format: OutputFormat;
  width: number;
  height: number;
  contentType: string;
};

export type VideoThumbnailOptions = TransformOptions & {
  time: number;
};

const CONTENT_TYPES: Record<OutputFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  tiff: "image/tiff",
};

export function contentTypeFor(format: OutputFormat): string {
  return CONTENT_TYPES[format];
}

export function isOutputFormat(value: string): value is OutputFormat {
  return (OUTPUT_FORMATS as readonly string[]).includes(value);
}
