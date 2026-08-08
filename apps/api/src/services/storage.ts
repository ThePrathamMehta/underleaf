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
