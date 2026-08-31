import { BadRequestException } from "@nestjs/common";
import sharp from "sharp";
export { EVIDENCE_MAX_PER_STAGE } from "@ward-ops/contracts";

export interface ProcessedImage {
  buffer: Buffer;
  contentType: "image/jpeg" | "image/png";
  width: number;
  height: number;
}

export const EVIDENCE_MAX_DIMENSION = 1920;
export const EVIDENCE_JPEG_QUALITY = 80;
export const EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HEIC_MAGIC = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);

function detectType(buffer: Buffer): "image/jpeg" | "image/png" | null {
  if (buffer.length >= JPEG_MAGIC.length && buffer.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)) {
    return "image/jpeg";
  }
  if (buffer.length >= PNG_MAGIC.length && buffer.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    return "image/png";
  }
  return null;
}

function isHeic(buffer: Buffer): boolean {
  return (
    buffer.length >= HEIC_MAGIC.length && buffer.subarray(0, HEIC_MAGIC.length).equals(HEIC_MAGIC)
  );
}

/**
 * Validates an uploaded image by file signature (never the filename extension),
 * rejects anything that is not a genuine JPEG/PNG (SVG/HTML/etc. are refused),
 * normalizes orientation from EXIF, resizes down to a sane long edge and
 * recompresses before the bytes reach object storage (projectredefine §23).
 */
export async function processEvidenceImage(input: {
  buffer: Buffer;
  originalName: string;
}): Promise<ProcessedImage> {
  const type = detectType(input.buffer);
  if (!type) {
    throw new BadRequestException(
      isHeic(input.buffer)
        ? "HEIC photos are not supported; convert to JPEG/PNG before uploading"
        : "Evidence must be a genuine JPEG or PNG image",
    );
  }
  if (input.buffer.length > EVIDENCE_MAX_BYTES) {
    throw new BadRequestException("Evidence photo exceeds the maximum allowed size");
  }

  try {
    const image = sharp(input.buffer, { failOn: "error" }).rotate();
    const processed = image
      .resize({
        width: EVIDENCE_MAX_DIMENSION,
        height: EVIDENCE_MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: EVIDENCE_JPEG_QUALITY, mozjpeg: true });

    const buffer = await processed.toBuffer();
    const out = sharp(buffer);
    const outMetadata = await out.metadata();
    return {
      buffer,
      contentType: "image/jpeg",
      width: outMetadata.width ?? 0,
      height: outMetadata.height ?? 0,
    };
  } catch (error) {
    throw new BadRequestException(
      `Evidence image could not be decoded: ${String(error instanceof Error ? error.message : error)}`,
    );
  }
}
