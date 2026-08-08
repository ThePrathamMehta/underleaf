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
 * Every value the theme contributes, as custom properties for one document's
 * root element.
 *
 * Deliberately not part of the stylesheet below. Those rules are scoped to the
 * `.rd-root` *class*, so a page holding more than one document — the template
 * gallery renders six — carries that many equal-specificity copies of the same
 * rule, and the last one parsed wins for every root on the page. Each thumbnail
 * then rendered with some other card's page size, margin, fonts and type scale;
 * the visible symptom was a Creative band stopping short of its own page edge,
 * because the wrapper was sized for Letter while the page had A4's width.
 *
 * An inline style is per-element and outranks any stylesheet, so each document
 * keeps its own theme and the static rules resolve `var()` against whichever
 * root they are inside.
 */
export function themeToCssVars(theme: Theme): Record<string, string> {
  const page = PAGE_DIMENSIONS[theme.pageSize];
  const scale = theme.fontSizeScale;
  const pt = (value: number) => `${(value * scale).toFixed(2)}pt`;

  return {
    "--rd-body-font": fontStack(theme.fontFamily),
    "--rd-heading-font": fontStack(theme.headingFontFamily),
    "--rd-accent": theme.accentColor,
    "--rd-text": theme.textColor,
    "--rd-leading": String(theme.lineSpacing),
    "--rd-margin": `${theme.marginSize}mm`,
    "--rd-page-width": `${page.width}mm`,
    "--rd-page-height": `${page.height}mm`,

    "--rd-size-name": pt(BASE_SIZES.name),
    "--rd-size-contact": pt(BASE_SIZES.contact),
    "--rd-size-section": pt(BASE_SIZES.sectionTitle),
    "--rd-size-primary": pt(BASE_SIZES.entryPrimary),
    "--rd-size-secondary": pt(BASE_SIZES.entrySecondary),
    "--rd-size-body": pt(BASE_SIZES.body),
    "--rd-size-small": pt(BASE_SIZES.small),

    "--rd-gap-section": `${(3.2 * theme.lineSpacing).toFixed(2)}mm`,
    "--rd-gap-entry": `${(2.1 * theme.lineSpacing).toFixed(2)}mm`,
  };
}

/**
 * Produces the stylesheet for a resume document — everything that isn't a
 * theme value, which `themeToCssVars` supplies per instance.
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

  return `
${options.fontFaces ?? ""}

@page {
  size: ${page.width}mm ${page.height}mm;
  /* Zero here so the theme's marginSize is the only margin source; the page
     padding below provides it, keeping screen and print in agreement. */
  margin: 0;
}

.rd-root {
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

/* --- Inline formatting ---

   Must come after the reset above, which flattens the font and text-decoration
   of every descendant. These are the tags a field's own HTML may carry (see
   rich-text.ts): the selection toolbar writes them, and without these rules
   bold text would render at normal weight in both the editor and the PDF. */

.rd-root b {
  font-weight: 700;
}

.rd-root i {
  font-style: italic;
}

.rd-root u {
  text-decoration: underline;
  text-underline-offset: 1.5pt;
  text-decoration-thickness: 0.4pt;
}

.rd-root s {
  text-decoration: line-through;
  text-decoration-thickness: 0.4pt;
}

.rd-root sub,
.rd-root sup {
  font-size: 0.72em;
  line-height: 0;
  position: relative;
  vertical-align: baseline;
}

.rd-root sup {
  top: -0.42em;
}

.rd-root sub {
  bottom: -0.22em;
}

/* Highlight. printBackground is on for the export, so this survives to PDF —
   which is why the default is a light wash rather than a saturated yellow. */
.rd-root mark {
  background: #fff2a8;
  color: inherit;
  padding: 0 0.4pt;
  border-radius: 0.6pt;
}

/* An inline link inside a field, as opposed to the header's .rd-link. Colour
   is inherited rather than accent-blue: a resume reads as a printed document,
   and the underline is enough to mark it. */
.rd-root a[href] {
  text-decoration: underline;
  text-underline-offset: 1.5pt;
  text-decoration-thickness: 0.4pt;
}

/* Nested marks compose: a run that is both struck through and underlined keeps
   both lines rather than the inner one winning. */
.rd-root u s,
.rd-root s u {
  text-decoration: underline line-through;
}

.rd-page {
  width: var(--rd-page-width);
  /* A fixed height, not a minimum. A sheet is a physical size: content that
     outgrows one has to continue on the next, and the renderer splits it so
     that it does. With min-height the sheet grew instead, which produced one
     endless page rather than two normal ones. */
  height: var(--rd-page-height);
  padding: var(--rd-margin);
  background: #ffffff;
  position: relative;
  overflow: hidden;
}

/* --- Multi-page --- */

/* Each .rd-page is one printed sheet; force a break after all but the last so
   a resume with a single page (the common case) prints with no extra break. */
.rd-page {
  break-after: page;
}
.rd-page:last-child {
  break-after: auto;
}

/* On screen the sheets stack with a small gap so they read as separate pages;
   print ignores this and uses the real page break above. */
@media screen {
  .rd-page + .rd-page {
    margin-top: 6mm;
  }
  /* Per-sheet drop shadow, only inside the editor canvas host — so the gallery
     thumbnails and the PDF (print media) are unaffected. */
  .rd-canvas-host .rd-page {
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.18), 0 12px 36px rgb(0 0 0 / 0.22);
    outline: 1px solid rgb(0 0 0 / 0.05);
    /* Breaks are measured against the printed form, which omits placeholders
       the editor shows for blank optional fields. A resume with those near a
       break can run a line past the sheet on screen only — better to let it
       show than to clip a line the user is editing. The PDF still clips. */
    overflow: visible;
  }
}

/* Continuation sheets start flush against the top margin: on sheet one that
   space belongs to the header, which is why the measuring pass folds the first
   section's gap into the header height. A descendant selector rather than a
   child one, because three of the templates wrap their sections in a themed
   div (.rd-classic, .rd-minimal, .rd-creative) and Deedy nests them in columns. */
.rd-page[data-page-index]:not([data-page-index="0"]) .rd-section:first-of-type {
  margin-top: 0;
}

/* An entry whose heading rows stayed on the previous sheet: its bullets are all
   that continue here, so they sit directly under the repeated section heading. */
.rd-entry[data-continued] > .rd-bullets {
  margin-top: 0;
}

/* Continuation pages don't repeat the name/contact header. Scoped to
   data-page-index so page 0 keeps its header untouched. */
.rd-page[data-page-index]:not([data-page-index="0"]) header,
.rd-page[data-page-index]:not([data-page-index="0"]) .rd-header-divider,
.rd-page[data-page-index]:not([data-page-index="0"]) .rd-band {
  display: none;
}

/* The measuring mirror (see canvas.tsx and the PDF export): the same document
   rendered as one uninterrupted flow so every block can be measured at once.
   The sheet keeps its real fixed height — that height is what the measurements
   are compared against — and only stops clipping, because overflow hides
   painting while leaving layout alone. Blocks past the bottom edge therefore
   still report their true geometry, which is exactly what the packer needs. */
.rd-measure-host .rd-page {
  overflow: visible;
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

/* Sheets are explicit elements with a fixed height, and the renderer decides
   what goes on each — so nothing below asks the print engine to avoid breaking
   inside a section or an entry. Those hints would fight the measured layout. */

.rd-section {
  margin-top: var(--rd-gap-section);
}

/* Title and rule travel together as one measurable block, so a heading can't be
   left at the foot of a sheet with its first entry overleaf. */
.rd-section-head {
  display: block;
}

.rd-section-title {
  font-family: var(--rd-heading-font);
  font-size: var(--rd-size-section);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--rd-accent);
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

/* --- Editor-only affordances ---

   Scoped to .rd-canvas-host (the editor's page wrapper) and to screen media,
   so none of this reaches the exported PDF or the gallery thumbnails. */

@media screen {
  /* A quiet hover tint, so it's discoverable which runs of the page are text
     you can click into. Uses a background rather than an outline to avoid
     shifting any glyph position. */
  .rd-canvas-host [contenteditable]:hover {
    background: rgb(194 65 12 / 0.06);
    border-radius: 1pt;
  }

  .rd-canvas-host [contenteditable]:focus {
    outline: none;
    background: rgb(194 65 12 / 0.09);
    border-radius: 1pt;
  }

  /* The two halves of a date range are separate fields while editing, so give
     the pair a little breathing room and keep the dash out of the tab order. */
  .rd-canvas-host .rd-date-range {
    white-space: nowrap;
  }

  .rd-canvas-host .rd-date-sep {
    opacity: 0.45;
  }

  /* An empty optional field (tech, issuer, subheading) renders only in the
     editor. Dim its separator so a half-filled entry doesn't look broken. */
  .rd-canvas-host .rd-entry-divider {
    opacity: 0.45;
  }
}
`.trim();
}
