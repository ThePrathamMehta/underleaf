/**
 * Font preservation for uploaded PDFs (spec B.2.3).
 *
 * Three tiers, in priority order:
 *
 *   1. `embedded` — the PDF carries the font program. Extract it, store it, and
 *      use those exact bytes in both the editor and the export. Pixel-perfect.
 *   2. `standard` — the font is one of PDF's base-14. Map it to the equivalent
 *      web font; Arial/Helvetica and Times New Roman/Times are metrically
 *      identical, so this is near-exact.
 *   3. `fallback` — a custom font referenced by name only. Match the name
 *      against a small catalog to at least get serif-vs-sans-vs-mono and
 *      weight/style right, then render with the standard font for that class.
 *      Only this tier is approximate, and the UI says so.
 *
 * One rule shapes the whole module: **whatever the editor shows, the export must
 * draw.** So tiers 2 and 3 both resolve to a base-14 font on the export side and
 * to a CSS stack whose first available family matches it on the editor side. A
 * catalog that rendered Garamond on screen and Times in the export would look
 * like a bug to the user, however good the on-screen match was.
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  StandardFonts,
  decodePDFRawStream,
} from "pdf-lib";
import type { FontSource } from "@repo/types";

// --- Generic classes ---

export type FontClass = "sans" | "serif" | "mono";

/**
 * CSS stacks chosen so the browser lands on the same metrics pdf-lib will draw
 * with. Arial is metrically identical to Helvetica and ships everywhere; Times
 * New Roman likewise for Times.
 */
const CSS_STACK: Record<FontClass, string> = {
  sans: "Helvetica, Arial, 'Liberation Sans', sans-serif",
  serif: "'Times New Roman', Times, 'Liberation Serif', serif",
  mono: "'Courier New', Courier, 'Liberation Mono', monospace",
};

/** The base-14 member for a class and style, which is what export embeds. */
const STANDARD_FONT: Record<FontClass, Record<string, StandardFonts>> = {
  sans: {
    regular: StandardFonts.Helvetica,
    bold: StandardFonts.HelveticaBold,
    italic: StandardFonts.HelveticaOblique,
    boldItalic: StandardFonts.HelveticaBoldOblique,
  },
  serif: {
    regular: StandardFonts.TimesRoman,
    bold: StandardFonts.TimesRomanBold,
    italic: StandardFonts.TimesRomanItalic,
    boldItalic: StandardFonts.TimesRomanBoldItalic,
  },
  mono: {
    regular: StandardFonts.Courier,
    bold: StandardFonts.CourierBold,
    italic: StandardFonts.CourierOblique,
    boldItalic: StandardFonts.CourierBoldOblique,
  },
};

export function standardFontFor(cls: FontClass, bold: boolean, italic: boolean): StandardFonts {
  const key = bold && italic ? "boldItalic" : bold ? "bold" : italic ? "italic" : "regular";
  return STANDARD_FONT[cls][key]!;
}

// --- Name analysis ---

/** Subset fonts are prefixed with six uppercase letters and a `+`. */
function stripSubsetPrefix(name: string): string {
  return name.replace(/^[A-Z]{6}\+/, "");
}

function normalize(name: string): string {
  return stripSubsetPrefix(name).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The base-14 names, plus the aliases producers actually emit for them. */
const BASE_14: Array<{ match: RegExp; cls: FontClass }> = [
  { match: /^(helvetica|arial|arialmt|liberationsans|nimbussan)/, cls: "sans" },
  { match: /^(times|timesnewroman|timesnewromanpsmt|liberationserif|nimbusroman)/, cls: "serif" },
  { match: /^(courier|couriernew|liberationmono|nimbusmono)/, cls: "mono" },
  { match: /^(symbol|zapfdingbats)/, cls: "sans" },
];

/**
 * Best-effort name catalog for the fallback tier. Only the class matters — see
 * the module note on why we don't render the real family here — so this is a
 * list of "which bucket does this name belong in", not a font library.
 */
const NAME_CATALOG: Array<{ match: RegExp; cls: FontClass }> = [
  {
    match:
      /(garamond|georgia|baskerville|caslon|palatino|book|minion|cambria|constantia|charter|utopia|merriweather|sourceserif|ptserif|droidserif|notoserif|libre|crimson|lora|playfair|spectral|serif)/,
    cls: "serif",
  },
  {
    match:
      /(mono|consolas|menlo|monaco|inconsolata|firacode|sourcecode|robotomono|ubuntumono|jetbrains|hack)/,
    cls: "mono",
  },
  {
    match:
      /(inter|roboto|lato|opensans|montserrat|poppins|raleway|nunito|worksans|sourcesans|notosans|ubuntu|calibri|verdana|tahoma|segoe|futura|avenir|gothic|grotesk|helvetic|sans)/,
    cls: "sans",
  },
];

function classifyByName(name: string): FontClass {
  const n = normalize(name);
  for (const { match, cls } of NAME_CATALOG) {
    if (match.test(n)) return cls;
  }
  // Nothing matched. Sans is the safer default for a resume — serif set at a
  // sans font's metrics reads noticeably heavier than the reverse.
  return "sans";
}

function isBase14(name: string): FontClass | null {
  const n = normalize(name);
  for (const { match, cls } of BASE_14) {
    if (match.test(n)) return cls;
  }
  return null;
}

export function looksBold(name: string): boolean {
  return /(bold|black|heavy|semibold|demibold|[-_,]?(700|800|900)\b)/.test(normalize(name).replace(/(\d{3})/g, "-$1"));
}

export function looksItalic(name: string): boolean {
  return /(italic|oblique)/.test(normalize(name));
}

// --- Embedded font extraction ---

export interface EmbeddedFontProgram {
  /** BaseFont name with any subset prefix removed, for matching against pdfjs. */
  baseName: string;
  /** `FontFile2` (TrueType), `FontFile3` (CFF/OpenType) or `FontFile` (Type1). */
  kind: string;
  /** MIME type to serve these bytes as, or null when browsers can't use them. */
  webMimeType: string | null;
  bytes: Uint8Array;
}

/**
 * Whether a browser can render these bytes through `@font-face`.
 *
 * This gates the `embedded` tier, because the tier's promise is that editor and
 * export agree. TrueType and full OpenType qualify. Bare CFF (`/Type1C`) and
 * Type1 do not — fontkit can embed them at export, but no browser will load
 * them, so a run using one would look different on screen than on paper. Those
 * demote to `standard`/`fallback` instead.
 */
function webMimeTypeFor(kind: string, subtype: string | null): string | null {
  if (kind === "FontFile2") return "font/ttf";
  if (kind === "FontFile3" && subtype === "OpenType") return "font/otf";
  return null;
}

/**
 * Walks every page's `/Resources /Font` dict and pulls out each embedded font
 * program, keyed by normalized base name.
 *
 * pdfjs exposes font *identity* but not font *bytes* — its font objects report a
 * zero-length `data` — so this has to come from pdf-lib's low-level object graph.
 */
export function extractEmbeddedFonts(doc: PDFDocument): Map<string, EmbeddedFontProgram> {
  const found = new Map<string, EmbeddedFontProgram>();
  const context = doc.context;

  for (const page of doc.getPages()) {
    let fontDict: PDFDict | undefined;
    try {
      // `lookup(key, type)` throws when the key is absent; every optional
      // lookup in this walk has to be the `Maybe` variant.
      fontDict = page.node.Resources()?.lookupMaybe(PDFName.of("Font"), PDFDict);
    } catch {
      continue;
    }
    if (!fontDict) continue;

    for (const [, ref] of fontDict.entries()) {
      try {
        const font = context.lookup(ref, PDFDict);
        if (!font) continue;

        // Composite (Type0) fonts keep the real descriptor on a descendant.
        const descendants = font.lookupMaybe(PDFName.of("DescendantFonts"), PDFArray);
        const target = descendants
          ? (context.lookup(descendants.get(0) as PDFRef, PDFDict) ?? font)
          : font;

        const descriptor = target.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict);
        if (!descriptor) continue;

        const baseName = stripSubsetPrefix(
          String(target.lookup(PDFName.of("BaseFont")) ?? "").replace(/^\//, ""),
        );
        if (!baseName) continue;

        for (const kind of ["FontFile2", "FontFile3", "FontFile"]) {
          // Single-argument `lookup` is the non-throwing form, and unlike
          // `lookupMaybe` it isn't restricted to pdf-lib's overload list — which
          // has no PDFRawStream entry. The instanceof does the narrowing.
          const stream = descriptor.lookup(PDFName.of(kind));
          if (!(stream instanceof PDFRawStream)) continue;

          const subtype = stream.dict.lookupMaybe(PDFName.of("Subtype"), PDFName);
          const bytes = decodePDFRawStream(stream).decode();
          if (!bytes.length) continue;

          const key = normalize(baseName);
          // First page wins; the same font repeated across pages is one program.
          if (!found.has(key)) {
            found.set(key, {
              baseName,
              kind,
              webMimeType: webMimeTypeFor(kind, subtype ? String(subtype).replace(/^\//, "") : null),
              bytes,
            });
          }
          break;
        }
      } catch {
        // A malformed font entry shouldn't cost us the other fonts on the page;
        // the run using it just resolves to a lower tier.
        continue;
      }
    }
  }

  return found;
}

// --- Resolution ---

export interface ResolvedFont {
  fontSource: FontSource;
  /** CSS stack for the editor overlay. */
  fontFamily: string;
  fontClass: FontClass;
  bold: boolean;
  italic: boolean;
  /** The embedded program to reuse, when `fontSource` is `embedded`. */
  program: EmbeddedFontProgram | null;
}

/**
 * Picks the highest tier available for one font reference.
 *
 * `rawName` is the PDF's own font name (pdfjs's `font.name`, not its internal
 * `g_d0_f1` id). `flags` are pdfjs's parsed hints, which catch bold/italic that
 * the name alone doesn't state.
 */
export function resolveFont(
  rawName: string,
  embedded: Map<string, EmbeddedFontProgram>,
  flags: { bold?: boolean; italic?: boolean; serif?: boolean; mono?: boolean } = {},
): ResolvedFont {
  const name = stripSubsetPrefix(rawName || "");
  const bold = flags.bold ?? looksBold(name);
  const italic = flags.italic ?? looksItalic(name);

  // Tier 1 — the PDF's own font program, if a browser can also render it.
  const program = embedded.get(normalize(name));
  if (program?.webMimeType) {
    return {
      fontSource: "embedded",
      // Family name is filled in by the caller once it knows the storage key —
      // it has to be unique per program so two PDFs' subsets can't collide.
      fontFamily: "",
      fontClass: flags.mono ? "mono" : flags.serif ? "serif" : classifyByName(name),
      bold,
      italic,
      program,
    };
  }

  // Tier 2 — a base-14 font, mapped to its metrically-equivalent web font.
  const base = isBase14(name);
  if (base) {
    return {
      fontSource: "standard",
      fontFamily: CSS_STACK[base],
      fontClass: base,
      bold,
      italic,
      program: null,
    };
  }

  // Tier 3 — best effort by name. Honest about being approximate.
  const cls = flags.mono ? "mono" : flags.serif ? "serif" : classifyByName(name);
  return {
    fontSource: "fallback",
    fontFamily: CSS_STACK[cls],
    fontClass: cls,
    bold,
    italic,
    program: null,
  };
}

/**
 * A CSS family name for an embedded program, unique to the document that owns
 * it. Subsets with the same base name differ between PDFs, so a shared family
 * name would let one document's `@font-face` satisfy another's lookup and render
 * the wrong glyphs.
 */
export function embeddedFamilyName(documentId: string, baseName: string): string {
  return `ul-${documentId.slice(0, 8)}-${normalize(baseName) || "font"}`;
}

/** The stack an embedded run renders with: its own program, then a safety net. */
export function embeddedCssStack(family: string, cls: FontClass): string {
  return `'${family}', ${CSS_STACK[cls]}`;
}

export { CSS_STACK, normalize as normalizeFontName, stripSubsetPrefix };
