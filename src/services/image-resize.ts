const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp"
};

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function getImageMimeType(extension: string): string | null {
  return MIME_BY_EXTENSION[extension.toLowerCase()] ?? null;
}

export function scaleDimensions(
  width: number,
  height: number,
  maxPx: number
): { width: number; height: number } {
  if (width <= maxPx && height <= maxPx) return { width, height };
  const scale = maxPx / Math.max(width, height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * What a canvas can actually encode.
 *
 * `toBlob` takes any type and quietly returns PNG for one it cannot write —
 * GIF among them. The bytes then went to the model declared as `image/gif`,
 * which is a mismatch the API rejects, so renaming any GIF failed with an
 * error about the request rather than about the picture. What comes back is
 * declared honestly instead: re-encoded as PNG, and called PNG.
 */
const ENCODABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

/** The type a canvas will really produce for a source of this type. */
export function encodedMimeType(mimeType: string): string {
  return ENCODABLE.has(mimeType.toLowerCase()) ? mimeType.toLowerCase() : "image/png";
}

export interface ResizedImage {
  base64: string;
  /** What the bytes actually are, which is not always what went in. */
  mimeType: string;
}

/** The default a vision model gets; printing passes the template's own. */
export const DEFAULT_QUALITY = 0.85;

export async function resizeImageToBase64(
  buffer: ArrayBuffer,
  mimeType: string,
  maxPx: number,
  quality = DEFAULT_QUALITY
): Promise<ResizedImage> {
  const { blob, mimeType: encoded } = await resizeImage(buffer, mimeType, maxPx, quality);
  return { base64: await blobToBase64(blob), mimeType: encoded };
}

/**
 * The same resize, as bytes.
 *
 * Printing embeds the picture in a document rather than posting it to an API,
 * so it wants the bytes rather than their base64 form — which would otherwise
 * be encoded here and decoded again a moment later, a third larger in between.
 */
export async function resizeImageToBytes(
  buffer: ArrayBuffer,
  mimeType: string,
  maxPx: number,
  quality = DEFAULT_QUALITY
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const { blob, mimeType: encoded } = await resizeImage(buffer, mimeType, maxPx, quality);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: encoded };
}

async function resizeImage(
  buffer: ArrayBuffer,
  mimeType: string,
  maxPx: number,
  quality: number
): Promise<{ blob: Blob; mimeType: string }> {
  const source = new Blob([buffer], { type: mimeType });
  const url = URL.createObjectURL(source);

  try {
    const img = await loadImage(url);
    const dims = scaleDimensions(img.naturalWidth, img.naturalHeight, maxPx);

    const canvas = document.createElement("canvas");
    canvas.width = dims.width;
    canvas.height = dims.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    ctx.drawImage(img, 0, 0, dims.width, dims.height);

    const encoded = encodedMimeType(mimeType);
    return { blob: await canvasToBlob(canvas, encoded, quality), mimeType: encoded };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image failed to load"));
    img.src = url;
  });
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality = DEFAULT_QUALITY
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob returned null"))),
      mimeType,
      quality
    );
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}
