/**
 * Turns the image URLs in a resume into inlined bytes, for the PDF export.
 *
 * Puppeteer prints from `page.setContent()`, which gives the document no origin
 * and sends no cookies — so a `<img src="http://localhost:4000/uploads/image/…">`
 * pointing at an authenticated route resolves to a broken image in the PDF. Fonts
 * already work around this by being inlined as base64; images take the same route.
 *
 * URLs are matched on their *path*, never their host. The host in a stored URL is
 * whatever `API_ORIGIN` was when the upload happened, and a deployment that moves
 * to a new domain must not silently start exporting resumes with the images
 * missing. What makes that safe is that the bytes are read from the caller's own
 * storage prefix: the path supplies a file name and nothing else, so a URL naming
 * someone else's host — or someone else's image — still only ever reaches this
 * user's own files.
 */
import type { ResumeContent } from "@repo/types";
import { isImageItem } from "@repo/types";
import { IMAGE_FILE_NAME, IMAGE_URL_PREFIX, storage, storageKeys } from "./storage.js";

/**
 * The file name an upload URL refers to, or null if it isn't one of ours.
 *
 * Absolute and app-relative forms both appear in stored documents — the upload
 * route returns absolute, and a document edited before that did returns relative —
 * so both are accepted.
 */
export function uploadedImageName(url: string): string | null {
  const path = url.startsWith(IMAGE_URL_PREFIX) ? url : pathOfAbsolute(url);
  if (!path?.startsWith(IMAGE_URL_PREFIX)) return null;

  const fileName = path.slice(IMAGE_URL_PREFIX.length);
  return IMAGE_FILE_NAME.test(fileName) ? fileName : null;
}

function pathOfAbsolute(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    // Not a URL at all: a data: URL, an empty string, or a half-typed one.
    return null;
  }
}

/**
 * The same content with every uploaded image replaced by a data URL.
 *
 * Anything that isn't ours is left exactly as it was: an external `https://` image
 * Chromium can fetch for itself, a `data:` URL that is already inline, and an empty
 * `src` on an image whose upload never finished. An image whose bytes have gone
 * missing is also left alone rather than blanked — the export should print the rest
 * of the resume, not fail because one file was swept out of storage.
 */
export async function inlineResumeImages(
  content: ResumeContent,
  userId: string,
): Promise<ResumeContent> {
  const urls = new Set<string>();
  const collect = (url: string) => {
    if (uploadedImageName(url)) urls.add(url);
  };

  for (const block of content.freeformBlocks ?? []) {
    if (block.type === "image") collect(block.content);
  }
  for (const section of content.sections) {
    for (const item of section.items) {
      if (isImageItem(item)) collect(item.src);
    }
  }

  if (urls.size === 0) return content;

  // One read per distinct URL, so the same headshot used three times is fetched
  // once and inlined three times from the one buffer.
  const inlined = new Map<string, string>();
  await Promise.all(
    [...urls].map(async (url) => {
      const dataUrl = await readAsDataUrl(url, userId);
      if (dataUrl) inlined.set(url, dataUrl);
    }),
  );

  if (inlined.size === 0) return content;
  const resolve = (url: string) => inlined.get(url) ?? url;

  return {
    ...content,
    ...(content.freeformBlocks
      ? {
          freeformBlocks: content.freeformBlocks.map((block) =>
            block.type === "image" ? { ...block, content: resolve(block.content) } : block,
          ),
        }
      : {}),
    /**
     * One cast, because mapping over a discriminated union's `items` loses the
     * correlation between a section's `type` and the entry shapes its array holds
     * — TypeScript widens the result to "any section's items", which no longer
     * satisfies any single member. The assertion is sound: every field is carried
     * over untouched and the only value replaced is an image item's `src` string,
     * so no discriminant and no entry shape changes.
     */
    sections: content.sections.map((section) => ({
      ...section,
      items: section.items.map((item) =>
        isImageItem(item) ? { ...item, src: resolve(item.src) } : item,
      ),
    })) as ResumeContent["sections"],
  };
}

async function readAsDataUrl(url: string, userId: string): Promise<string | null> {
  const fileName = uploadedImageName(url);
  if (!fileName) return null;

  const obj = await storage.get(storageKeys.image(userId, fileName));
  if (!obj) return null;

  return `data:${obj.contentType};base64,${obj.bytes.toString("base64")}`;
}
