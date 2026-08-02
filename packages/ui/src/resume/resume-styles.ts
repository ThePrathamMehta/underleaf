import type { Theme, PageSize } from "@repo/types";

/**
 * Physical page dimensions in millimetres. The renderer works in mm/pt
 * throughout so that the on-screen page and the printed PDF describe the same
 * geometry — px would introduce a DPI conversion at print time.
 */
export const PAGE_DIMENSIONS: Record<PageSize, { width: number; height: number }> = {
  a4: { width: 210, height: 297 },
  letter: { width: 215.9, height: 279.4 },
};

/** Maps a theme font key to a concrete stack. Families are vendored as WOFF2. */
const FONT_STACKS: Record<Theme["fontFamily"], string> = {
  inter: "'Underleaf Inter', 'Helvetica Neue', Arial, sans-serif",
  lato: "'Underleaf Lato', 'Helvetica Neue', Arial, sans-serif",
  roboto: "'Underleaf Roboto', 'Helvetica Neue', Arial, sans-serif",
  "source-serif": "'Underleaf Source Serif', Georgia, 'Times New Roman', serif",
  "eb-garamond": "'Underleaf EB Garamond', Garamond, Georgia, serif",
  merriweather: "'Underleaf Merriweather', Georgia, 'Times New Roman', serif",
};

export function fontStack(family: Theme["fontFamily"]): string {
  return FONT_STACKS[family];
}

/** Base type sizes in points, before `fontSizeScale` is applied. */
const BASE_SIZES = {
  name: 22,
  contact: 9.5,
  sectionTitle: 11.5,
  entryPrimary: 10.5,
  entrySecondary: 10,
  body: 10,
  small: 9,
} as const;

/**
 * Produces the complete stylesheet for a resume document.
 *
 * Every rule is scoped under `.rd-root` and every class is `rd-`-prefixed so the
 * resume renders identically whether it sits inside the Tailwind-styled editor
 * (where preflight would otherwise leak in) or alone in a Puppeteer page.
 *
 * `fontFaces` is injected by the export path only: `page.setContent()` has no
 * origin, so relative font URLs can't resolve and the bytes must arrive inline.
 */
export function themeToCss(theme: Theme, options: { fontFaces?: string } = {}): string {
  const page = PAGE_DIMENSIONS[theme.pageSize];
  const scale = theme.fontSizeScale;
  const pt = (value: number) => `${(value * scale).toFixed(2)}pt`;

  return `
${options.fontFaces ?? ""}

@page {
  size: ${page.width}mm ${page.height}mm;
  /* Zero here so the theme's marginSize is the only margin source; the page
     padding below provides it, keeping screen and print in agreement. */
  margin: 0;
}

.rd-root {
  --rd-body-font: ${fontStack(theme.fontFamily)};
  --rd-heading-font: ${fontStack(theme.headingFontFamily)};
  --rd-accent: ${theme.accentColor};
  --rd-text: ${theme.textColor};
  --rd-leading: ${theme.lineSpacing};
  --rd-margin: ${theme.marginSize}mm;
  --rd-page-width: ${page.width}mm;
  --rd-page-height: ${page.height}mm;

  --rd-size-name: ${pt(BASE_SIZES.name)};
  --rd-size-contact: ${pt(BASE_SIZES.contact)};
  --rd-size-section: ${pt(BASE_SIZES.sectionTitle)};
  --rd-size-primary: ${pt(BASE_SIZES.entryPrimary)};
  --rd-size-secondary: ${pt(BASE_SIZES.entrySecondary)};
  --rd-size-body: ${pt(BASE_SIZES.body)};
  --rd-size-small: ${pt(BASE_SIZES.small)};

  --rd-gap-section: ${(3.2 * theme.lineSpacing).toFixed(2)}mm;
  --rd-gap-entry: ${(2.1 * theme.lineSpacing).toFixed(2)}mm;

  font-family: var(--rd-body-font);
  font-size: var(--rd-size-body);
  line-height: var(--rd-leading);
  color: var(--rd-text);
  background: #ffffff;
  text-rendering: geometricPrecision;
  -webkit-font-smoothing: antialiased;
}

/* Local reset: makes the document independent of whatever global styles the
   host page applies. */
.rd-root *,
.rd-root *::before,
.rd-root *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  border: 0;
  font: inherit;
  color: inherit;
  text-decoration: none;
  list-style: none;
  background: transparent;
}

.rd-page {
  width: var(--rd-page-width);
  min-height: var(--rd-page-height);
  padding: var(--rd-margin);
  background: #ffffff;
  position: relative;
  overflow: hidden;
}

/* --- Header --- */

.rd-name {
  font-family: var(--rd-heading-font);
  font-size: var(--rd-size-name);
  font-weight: 700;
  letter-spacing: 0.01em;
  line-height: 1.1;
}

.rd-role {
  font-size: var(--rd-size-secondary);
  color: var(--rd-accent);
  margin-top: 0.8mm;
}

.rd-contact {
  font-size: var(--rd-size-contact);
  margin-top: 1.4mm;
  display: flex;
  flex-wrap: wrap;
  gap: 0 2.4mm;
  align-items: baseline;
}

.rd-contact-sep {
  opacity: 0.45;
}

.rd-link {
  text-decoration: underline;
  text-underline-offset: 1.5pt;
  text-decoration-thickness: 0.4pt;
}

/* --- Sections --- */

.rd-section {
  margin-top: var(--rd-gap-section);
  /* Keeps a heading from being orphaned at the foot of a printed page. */
  break-inside: avoid-page;
}

.rd-section-title {
  font-family: var(--rd-heading-font);
  font-size: var(--rd-size-section);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--rd-accent);
  break-after: avoid-page;
}

.rd-rule {
  height: 0.5pt;
  background: currentColor;
  opacity: 0.55;
  margin-top: 1mm;
  margin-bottom: 1.6mm;
}

.rd-entry {
  margin-top: var(--rd-gap-entry);
  break-inside: avoid-page;
}

.rd-entry:first-of-type {
  margin-top: 0;
}

.rd-entry-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 4mm;
}

.rd-entry-primary {
  font-size: var(--rd-size-primary);
  font-weight: 700;
}

.rd-entry-secondary {
  font-size: var(--rd-size-secondary);
  font-style: italic;
}

.rd-entry-meta {
  font-size: var(--rd-size-small);
  white-space: nowrap;
  flex-shrink: 0;
  text-align: right;
}

.rd-bullets {
  margin-top: 0.9mm;
  padding-left: 4.2mm;
}

.rd-bullet {
  position: relative;
  margin-top: 0.6mm;
}

.rd-bullet::before {
  content: "";
  position: absolute;
  left: -2.8mm;
  top: calc(var(--rd-size-body) * 0.52);
  width: 1.05pt;
  height: 1.05pt;
  border-radius: 50%;
  background: currentColor;
}

.rd-bullet:first-child {
  margin-top: 0;
}

.rd-summary {
  font-size: var(--rd-size-body);
}

/* --- Skills --- */

.rd-skill-row {
  margin-top: 0.7mm;
}

.rd-skill-row:first-child {
  margin-top: 0;
}

.rd-skill-label {
  font-weight: 700;
}

/* --- Two-column / sidebar layouts --- */

.rd-columns {
  display: flex;
  gap: 6mm;
  align-items: flex-start;
}

.rd-col-side {
  width: 32%;
  flex-shrink: 0;
}

.rd-col-main {
  flex: 1;
  min-width: 0;
}

/* First section in each column sits flush with the column top, so the two
   columns start on the same baseline. */
.rd-col-side > .rd-section:first-child,
.rd-col-main > .rd-section:first-child {
  margin-top: 0;
}

.rd-col-side .rd-entry-row {
  /* Too narrow for a right-aligned date column; stack instead of squeezing. */
  display: block;
}

.rd-col-side .rd-entry-meta {
  text-align: left;
  white-space: normal;
  opacity: 0.8;
}

/* --- Creative colored header band --- */

.rd-band {
  background: var(--rd-accent);
  color: #ffffff;
  /* Bleeds to the page edge by cancelling the page padding. */
  margin: calc(-1 * var(--rd-margin)) calc(-1 * var(--rd-margin)) 0;
  padding: calc(var(--rd-margin) * 0.85) var(--rd-margin);
}

.rd-band .rd-role,
.rd-band .rd-contact {
  color: #ffffff;
}

.rd-band .rd-role {
  opacity: 0.9;
}

/* Utility used by templates that center their header. */
.rd-center {
  text-align: center;
}

.rd-center .rd-contact {
  justify-content: center;
}

/* Full-width rule beneath the header, for templates that separate it. */
.rd-header-divider {
  height: 0.75pt;
  background: var(--rd-accent);
  opacity: 0.8;
  margin-top: 2.4mm;
}

/* --- Modern Minimal: separation by whitespace and weight, not rules --- */

.rd-minimal .rd-section {
  margin-top: calc(var(--rd-gap-section) * 1.55);
}

.rd-minimal .rd-section-title {
  text-transform: none;
  letter-spacing: 0.01em;
  font-weight: 600;
  /* Sits quietly above its content rather than shouting a category. */
  color: var(--rd-text);
  opacity: 0.55;
  font-size: var(--rd-size-small);
}

.rd-minimal .rd-name {
  font-weight: 500;
  letter-spacing: -0.015em;
}

.rd-minimal .rd-entry-primary {
  font-weight: 600;
}

.rd-minimal .rd-entry-secondary {
  font-style: normal;
  opacity: 0.75;
}

/* --- Classic Professional: conventional, print-first --- */

.rd-classic .rd-name {
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-size: calc(var(--rd-size-name) * 0.86);
}

.rd-classic .rd-section-title {
  letter-spacing: 0.12em;
  /* Headings stay in the body color here; the accent is reserved for rules. */
  color: var(--rd-text);
}

.rd-classic .rd-rule {
  opacity: 0.85;
}

/* --- Creative: colored band, restrained body --- */

.rd-creative .rd-section-title {
  font-size: var(--rd-size-secondary);
  letter-spacing: 0.09em;
}

.rd-creative .rd-section-title::after {
  /* A short accent underline in place of a full-width rule. */
  content: "";
  display: block;
  width: 9mm;
  height: 1.1pt;
  background: var(--rd-accent);
  margin-top: 0.9mm;
  margin-bottom: 1.4mm;
}

.rd-creative .rd-band .rd-name {
  font-size: calc(var(--rd-size-name) * 1.05);
}

/* Empty editable regions would collapse to zero height and become unclickable
   in the editor; this keeps a caret target without affecting print output. */
.rd-root [contenteditable]:empty::before {
  content: attr(data-placeholder);
  opacity: 0.35;
}
`.trim();
}
