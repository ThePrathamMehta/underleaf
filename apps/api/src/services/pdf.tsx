import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import puppeteer, { type Browser } from "puppeteer";
import type { ResumeContent, Theme } from "@repo/types";
import { ResumeDocument } from "@repo/ui/resume";
import { ALL_FONT_FILES, fontFacesFromBase64 } from "@repo/ui/resume/fonts";

// --- Font bytes, read once ---

const FONTS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.resolve("@repo/ui/resume/fonts"))),
  "fonts",
);

/**
 * Loaded eagerly at boot so no request pays disk I/O, and so a missing font file
 * shows up as a startup warning instead of a silently ugly PDF.
 */
const fontCache = new Map<string, string>();

for (const { file } of ALL_FONT_FILES) {
  try {
    fontCache.set(file, readFileSync(path.join(FONTS_DIR, file)).toString("base64"));
  } catch {
    console.warn(`[pdf] font missing, PDFs will fall back for it: ${file}`);
  }
}

// --- Browser singleton ---

let browserPromise: Promise<Browser> | null = null;

function launch(): Promise<Browser> {
  return puppeteer.launch({
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      // Without this Chromium hints glyphs differently from the desktop browser
      // and text metrics shift slightly, breaking screen/print parity.
      "--font-render-hinting=none",
    ],
  });
}

/** Reuses one browser across requests; relaunching per request costs ~1s. */
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launch().then((browser) => {
      browser.on("disconnected", () => {
        browserPromise = null;
      });
      return browser;
    });
  }

  try {
    return await browserPromise;
  } catch (error) {
    // Don't cache a failed launch, or every later request inherits the failure.
    browserPromise = null;
    throw error;
  }
}

export async function closeBrowser(): Promise<void> {
  const pending = browserPromise;
  browserPromise = null;
  if (!pending) return;
  try {
    await (await pending).close();
  } catch {
    // Already gone; nothing to release.
  }
}

// --- Concurrency limit ---

const MAX_CONCURRENT_EXPORTS = 3;
let activeExports = 0;
const waiting: Array<() => void> = [];

/** Caps simultaneous pages so a burst of exports can't exhaust memory. */
async function acquireSlot(): Promise<() => void> {
  if (activeExports >= MAX_CONCURRENT_EXPORTS) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  activeExports++;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeExports--;
    waiting.shift()?.();
  };
}

// --- Export ---

export type RenderResumeArgs = {
  templateSlug: string;
  content: ResumeContent;
  theme: Theme;
};

/**
 * Renders the resume to a full HTML document.
 *
 * Uses the same `ResumeDocument` component the editor canvas mounts, so the two
 * outputs cannot drift. Fonts are inlined as base64 because `setContent()` has
 * no origin for relative URLs to resolve against.
 */
export function renderResumeHtml({ templateSlug, content, theme }: RenderResumeArgs): string {
  const fontFaces = fontFacesFromBase64(theme, (file) => fontCache.get(file));

  const markup = renderToStaticMarkup(
    <ResumeDocument
      templateSlug={templateSlug}
      content={content}
      theme={theme}
      fontFaces={fontFaces}
    />,
  );

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Resume</title><style>html,body{margin:0;padding:0;background:#fff;}</style></head><body>${markup}</body></html>`;
}

export async function exportResumePdf(args: RenderResumeArgs): Promise<Uint8Array> {
  const release = await acquireSlot();
  let page: Awaited<ReturnType<Browser["newPage"]>> | undefined;

  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    await page.setContent(renderResumeHtml(args), { waitUntil: "load" });

    // Base64 @font-face decoding is async; printing before it settles would
    // measure fallback metrics and shift every line.
    await page.evaluate(() => document.fonts.ready);

    return await page.pdf({
      // The document's own @page rule is authoritative for size and margins —
      // passing format/margin here would override the theme and break parity.
      preferCSSPageSize: true,
      printBackground: true,
    });
  } finally {
    await page?.close().catch(() => {});
    release();
  }
}
