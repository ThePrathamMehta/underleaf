/**
 * Client-side checks for the app's file uploads: the `.pdf` a document is
 * imported from, and the images the editor's Insert menu adds.
 *
 * These are an optimization, not the enforcement — the API applies its own limits
 * regardless of what happens here. The point is that refusing a 40MB file locally
 * is instant, whereas letting it go costs the user a full upload before the same
 * answer comes back. Keeping every call site on one function per file type is what
 * stops them from disagreeing about what's allowed.
 */

/**
 * Must match `MAX_UPLOAD_BYTES` on the API. They're separate values because the
 * browser can't read the server's env, so the shared default is the contract;
 * override both together, or the server's 413 becomes the one the user sees.
 */
export const MAX_UPLOAD_BYTES = Number(
  process.env.NEXT_PUBLIC_MAX_UPLOAD_BYTES ?? 15 * 1024 * 1024,
);

/** A byte count as the megabytes a user recognises: `15728640` → `15MB`. */
export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10}MB`;
}

/**
 * Returns why this file can't be uploaded, or `null` if it can.
 *
 * Extension as well as MIME type: some systems hand over a `.pdf` with an empty
 * or generic `file.type`, and rejecting those would refuse a perfectly good
 * document the server would have accepted.
 */
export function pdfUploadError(file: File): string | null {
  const looksLikePdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!looksLikePdf) {
    return "That file isn't a PDF. Only .pdf files can be edited here.";
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return `That PDF is ${formatBytes(file.size)}, and the limit is ${formatBytes(MAX_UPLOAD_BYTES)}. Try compressing it, or split out just the pages you need.`;
  }

  // Multer accepts a zero-byte upload; the parser then fails on it with a much
  // vaguer message than the plain truth we can tell here.
  if (file.size === 0) {
    return "That file is empty. Try re-exporting the PDF and uploading it again.";
  }

  return null;
}

/**
 * The image types the editor's Insert → Image accepts, as an `accept` attribute
 * and as the set the check below tests against.
 *
 * Matches what the API stores. SVG is deliberately absent there — it's a document
 * that can carry script rather than a bitmap — so offering it in the file picker
 * would only produce a rejected upload.
 */
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";

const IMAGE_TYPES = new Set(IMAGE_ACCEPT.split(","));

/** Returns why this image can't be uploaded, or `null` if it can. */
export function imageUploadError(file: File): string | null {
  if (!IMAGE_TYPES.has(file.type)) {
    return "That file isn't a PNG, JPEG or WebP image.";
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return `That image is ${formatBytes(file.size)}, and the limit is ${formatBytes(MAX_UPLOAD_BYTES)}. Try exporting it at a smaller size.`;
  }

  if (file.size === 0) {
    return "That file is empty. Try saving the image again and re-adding it.";
  }

  return null;
}
