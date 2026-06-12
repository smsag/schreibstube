const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
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

export async function resizeImageToBase64(
  buffer: ArrayBuffer,
  mimeType: string,
  maxPx: number
): Promise<string> {
  const blob = new Blob([buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);

  try {
    const img = await loadImage(url);
    const dims = scaleDimensions(img.naturalWidth, img.naturalHeight, maxPx);

    const canvas = document.createElement("canvas");
    canvas.width = dims.width;
    canvas.height = dims.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    ctx.drawImage(img, 0, 0, dims.width, dims.height);

    const outBlob = await canvasToBlob(canvas, mimeType);
    return blobToBase64(outBlob);
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

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob returned null"))),
      mimeType,
      0.85
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
