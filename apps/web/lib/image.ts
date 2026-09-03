/**
 * Client-side image compression for field uploads. Phone cameras produce
 * multi-megabyte originals that are slow and costly to push over mobile links;
 * downscale to a bounded dimension before upload while leaving non-image files
 * untouched.
 */
interface DecodedImage {
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  close: () => void;
}

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
        close: () => bitmap.close(),
      };
    } catch {
      // Fall through to HTMLImageElement fallback.
    }
  }

  if (typeof Image !== "undefined" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject();
        img.src = url;
      });
      return {
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
        close: () => URL.revokeObjectURL(url),
      };
    } catch {
      URL.revokeObjectURL(url);
      throw new Error("Unable to decode image");
    }
  }

  throw new Error("No image decoder available");
}

export async function compressImage(
  file: File,
  maxDimension = 1600,
  quality = 0.82,
): Promise<File> {
  const isImage =
    file.type.startsWith("image/") ||
    /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
  if (!isImage) return file;
  if (typeof document === "undefined") return file;

  try {
    const decoded = await decodeImage(file);
    try {
      const scale = Math.min(1, maxDimension / Math.max(decoded.width, decoded.height));
      if (scale >= 1 && (file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name))) {
        return file;
      }
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(decoded.width * scale));
      canvas.height = Math.max(1, Math.round(decoded.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return file;
      decoded.draw(context, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
      if (!blob) return file;
      const name = file.name.replace(/\.(png|webp|heic|heif)$/i, ".jpg");
      return new File([blob], name.endsWith(".jpg") ? name : `${name}.jpg`, { type: "image/jpeg" });
    } finally {
      decoded.close();
    }
  } catch {
    return file;
  }
}