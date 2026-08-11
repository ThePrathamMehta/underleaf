import type { PersonalInfo, Theme } from "@repo/types";
import { PAGE_DIMENSIONS, fontStack } from "@repo/ui/resume/styles";
import { inlineFontFaces } from "./pdf.js";

/**
 * The printed cover letter.
 *
 * Deliberately not `ResumeDocument`. That component and its pagination packer
 * exist to place structured blocks on measured sheets; a letter is one flow of
 * paragraphs and lets the browser break it, which is both correct and free.
 *
 * What it *does* share is the resume's theme — the same font files, margin, type
 * scale and accent. A letter that arrives in a different typeface from the resume
 * behind it reads as two documents from two people.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Strips the inline markup resume fields carry; a letterhead is plain text. */
function plain(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

/**
 * Paragraphs from blank-line-separated plain text — the storage format.
 *
 * Single newlines inside a paragraph become `<br>`: someone who hand-edits the
 * letter and puts each line of an address on its own line means those breaks,
 * and collapsing them would silently rewrite what they typed.
 */
function paragraphs(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p class="cl-p">${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** The sender block: whatever of the resume's contact details actually exists. */
function letterhead(info: PersonalInfo): string {
  const name = plain(info.name);
  const details = [plain(info.email), plain(info.phone), plain(info.location)].filter(Boolean);

  if (!name && details.length === 0) return "";

  return [
    '<header class="cl-head">',
    name ? `<p class="cl-name">${escapeHtml(name)}</p>` : "",
    details.length ? `<p class="cl-meta">${escapeHtml(details.join("  ·  "))}</p>` : "",
    "</header>",
  ].join("");
}

export function renderCoverLetterHtml(options: {
  content: string;
  personalInfo: PersonalInfo;
  theme: Theme;
}): string {
  const { theme } = options;
  const page = PAGE_DIMENSIONS[theme.pageSize];
  const scale = theme.fontSizeScale;
  const pt = (value: number) => `${(value * scale).toFixed(2)}pt`;

  const css = `
${inlineFontFaces(theme)}

@page { size: ${page.width}mm ${page.height}mm; margin: 0; }

html, body { margin: 0; padding: 0; background: #fff; }

.cl-page {
  box-sizing: border-box;
  width: ${page.width}mm;
  /* min-height, not height: a letter that runs long flows onto a second
     sheet rather than being clipped at the bottom of the first. */
  min-height: ${page.height}mm;
  padding: ${theme.marginSize}mm;
  background: #fff;
  color: ${theme.textColor};
  font-family: ${fontStack(theme.fontFamily)};
  font-size: ${pt(10.5)};
  line-height: ${theme.lineSpacing};
  -webkit-font-smoothing: antialiased;
  text-rendering: geometricPrecision;
}

.cl-head {
  margin-bottom: ${(6 * theme.lineSpacing).toFixed(2)}mm;
  padding-bottom: 2.5mm;
  border-bottom: 0.4pt solid ${theme.accentColor};
}

.cl-name {
  margin: 0;
  font-family: ${fontStack(theme.headingFontFamily)};
  font-size: ${pt(15)};
  font-weight: 700;
  letter-spacing: -0.01em;
  color: ${theme.accentColor};
}

.cl-meta {
  margin: 1.2mm 0 0;
  font-size: ${pt(9)};
  opacity: 0.75;
}

.cl-p {
  margin: 0 0 ${(3.4 * theme.lineSpacing).toFixed(2)}mm;
  /* Two lines is the smallest orphan worth keeping together; one stranded line
     at a page break is what makes a printed letter look accidental. */
  orphans: 2;
  widows: 2;
}

.cl-p:last-child { margin-bottom: 0; }
`;

  return [
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Cover letter</title>",
    `<style>${css}</style></head><body>`,
    '<div class="cl-page">',
    letterhead(options.personalInfo),
    paragraphs(options.content),
    "</div></body></html>",
  ].join("");
}
