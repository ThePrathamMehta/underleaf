/**
 * Blob storage for uploaded PDFs and their rendered page images.
 *
 * These files are too big for Postgres and too many to keep in memory, so they
 * live behind a small driver interface. The only implementation today writes to
 * local disk; the interface is deliberately the S3 subset we'd actually use
 * (put/get/delete by key, plus a prefix delete for cascading a document away) so
 * swapping in an S3/R2 driver later is one new file and one line in `driver`
 * below — no call sites change.
 *
 * Keys are opaque, internal, and never public URLs. Bytes reach the browser
 * through an authenticated, ownership-checked route, which is what lets this run
 * on a private bucket without signed-URL plumbing.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config";

export interface StoredObject {
  bytes: Buffer;
  contentType: string;
}

export interface StorageDriver {
  /** Writes (or overwrites) the object at `key`. */
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  /** Returns null when the key is absent — callers treat that as a 404, not a crash. */
  get(key: string): Promise<StoredObject | null>;
  /** Removes every object whose key starts with `prefix`. Missing prefixes are a no-op. */
  deletePrefix(prefix: string): Promise<void>;
}

// --- Key construction ---

/**
 * Every key is namespaced by owner first, so a listing or a bulk delete can
 * never span users even if a caller passes the wrong id.
 */
export const storageKeys = {
  /** The original uploaded file, kept verbatim — export re-reads it every time. */
  source: (userId: string, documentId: string) => `users/${userId}/pdfs/${documentId}/source.pdf`,
  /** One rasterized background per page, used as the editor's canvas. */
  pageImage: (userId: string, documentId: string, pageIndex: number) =>
    `users/${userId}/pdfs/${documentId}/pages/${pageIndex}.png`,
  /**
   * An embedded font program lifted out of the source, by CSS family name.
   *
   * The extension carries the format so the key alone is enough to serve the
   * bytes with the right content type and to write the `format()` hint into the
   * editor's `@font-face` rule — no sidecar read, no extra column.
   */
  font: (userId: string, documentId: string, family: string, extension: FontExtension) =>
    `users/${userId}/pdfs/${documentId}/fonts/${family}.${extension}`,
  /** Everything belonging to one document, for cascading deletes. */
  document: (userId: string, documentId: string) => `users/${userId}/pdfs/${documentId}/`,
  /**
   * An image the user inserted into a resume.
   *
   * `fileName` carries its own extension (`img_a1b2c3d4.png`), which is what lets
   * a request for one rebuild this key from the URL alone — no lookup table, no
   * Prisma row. It sits under the user rather than under a resume because the same
   * headshot is reasonably dropped into several, and a copy per resume would mean
   * a re-upload per resume.
   */
  image: (userId: string, fileName: string) => `users/${userId}/images/${fileName}`,  /**
   * Everything belonging to one user. Deleting an account cascades its rows
   * through Prisma, but nothing in the database knows about blobs — this prefix
   * is what makes the same cascade reach disk.
   */
  user: (userId: string) => `users/${userId}/`,
} as const;

/** The web font formats the `embedded` tier can produce. */
export type FontExtension = "ttf" | "otf";

export const FONT_MIME_TYPES: Record<FontExtension, string> = {
  ttf: "font/ttf",
  otf: "font/otf",
};

/** The extension for a MIME type the parser produced, defaulting to TrueType. */
export function fontExtensionFor(mimeType: string): FontExtension {
  return mimeType === "font/otf" ? "otf" : "ttf";
}

/**
 * The image types a resume may embed, and the extension each is stored under.
 *
 * A deliberately short list. SVG is the notable omission: it is a document, not a
 * bitmap — it can carry script, and this app serves uploaded bytes from its own
 * origin, so a stored SVG opened directly would run that script as us. PDF export
 * would also have to rasterize it. Everything a resume actually needs — a
 * headshot, a logo, a QR code — is one of the three below.
 */
export const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * The image file names this app will build a key from.
 *
 * Tight enough that traversal, absolute paths and nested segments are impossible
 * before a key exists at all — `assertSafeKey` below is the backstop, not the
 * gate. Lives here beside the key builder so the upload route, the serving route
 * and the export's inlining pass all agree on what a valid name is.
 */
export const IMAGE_FILE_NAME = /^img_[a-z0-9]{1,32}\.(?:png|jpg|webp)$/;

/** The path this app serves uploaded images from, matched by the export pass. */
export const IMAGE_URL_PREFIX = "/uploads/image/";

/** Whether a browser-declared MIME type is one this app stores. */
export function isSupportedImageType(mimeType: string): boolean {
  return mimeType in IMAGE_EXTENSIONS;
}

/**
 * The image type these bytes actually are, or null if they aren't an image this
 * app stores.
 *
 * The type a browser declares on an upload is just a string in the request, and
 * these bytes are served back out of our own origin — so the stored content type
 * is taken from the file's own magic number instead. A `.png` that is really an
 * HTML document is rejected here rather than stored and later served as one.
 */
export function sniffImageType(bytes: Buffer): string | null {
  if (bytes.length >= 12 && bytes.subarray(0, 8).equals(PNG_MAGIC)) return "image/png";
  if (bytes.length >= 3 && bytes.subarray(0, 3).equals(JPEG_MAGIC)) return "image/jpeg";
  // RIFF....WEBP — the four bytes between are the chunk length.
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

/**
 * Keys come from `storageKeys` today, but a driver that maps them onto a
 * filesystem must not be one bad caller away from writing outside its root.
 * Rejecting traversal here keeps that guarantee in the storage layer rather than
 * relying on every future call site to be careful.
 */
function assertSafeKey(key: string): void {
  if (!key || key.startsWith("/") || key.includes("\\") || key.includes("..") || /[\0]/.test(key)) {
    throw new Error(`Unsafe storage key: ${JSON.stringify(key)}`);
  }
}

// --- Local disk driver ---

const CONTENT_TYPE_FILE = ".contenttype";

class LocalDiskDriver implements StorageDriver {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    // Belt and braces: even with the key check above, confirm the resolved path
    // is still inside the root before any write touches disk.
    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      throw new Error(`Storage key escapes root: ${JSON.stringify(key)}`);
    }
    return full;
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, bytes);
    // S3 stores the content type with the object; on disk there's nowhere to put
    // it, so it goes in a sidecar. `get` falls back to sniffing when it's absent,
    // which keeps files copied in by hand working.
    await writeFile(full + CONTENT_TYPE_FILE, contentType, "utf8");
  }

  async get(key: string): Promise<StoredObject | null> {
    const full = this.resolve(key);
    let bytes: Buffer;
    try {
      bytes = await readFile(full);
    } catch {
      return null;
    }

    let contentType: string;
    try {
      contentType = (await readFile(full + CONTENT_TYPE_FILE, "utf8")).trim();
    } catch {
      contentType = guessContentType(key);
    }

    return { bytes, contentType };
  }

  async deletePrefix(prefix: string): Promise<void> {
    assertSafeKey(prefix);
    // Every prefix we generate is a directory boundary, so removing the
    // directory is both correct and far cheaper than listing and unlinking.
    const full = this.resolve(prefix.endsWith("/") ? prefix.slice(0, -1) : prefix);
    await rm(full, { recursive: true, force: true });
  }
}

function guessContentType(key: string): string {
  if (key.endsWith(".pdf")) return "application/pdf";
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg";
  if (key.endsWith(".webp")) return "image/webp";
  if (key.endsWith(".ttf")) return FONT_MIME_TYPES.ttf;
  if (key.endsWith(".otf")) return FONT_MIME_TYPES.otf;
  return "application/octet-stream";
}

// --- The one driver the app uses ---

export const storage: StorageDriver = new LocalDiskDriver(config.storageDir);

/**
 * A short, stable fingerprint of some bytes. Page images are cached hard by the
 * browser, so their URLs carry this — re-parsing a document changes the hash and
 * busts the cache without any cache-control gymnastics.
 */
export function contentHash(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}
