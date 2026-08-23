import { orderedFreeformBlocks, type ResumeContent } from "./content";

/**
 * What a downloaded file is called.
 *
 * One utility rather than a `replace` chain per route, because there are already
 * three download surfaces (resume PDF, uploaded-PDF export, cover letter) and the
 * bug this fixes — a file named after the *template* instead of the person — is
 * exactly what happens when each one derives its own name from whichever field is
 * nearest to hand.
 *
 * It lives in `packages/types` because the resolution order is a fact about the
 * content schema: which field holds a person's name, and what stands in for it in
 * a document that has no name field. That knowledge belongs next to the schema
 * rather than in an API route.
 */

/** Entities the editor writes, decoded so they don't become stray hyphens. */
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/**
 * The readable text of a rich-text field.
 *
 * Deliberately a local, minimal strip rather than a shared one. `@repo/scoring`
 * and `@repo/ui` both have a fuller version, and both depend on this package, so
 * importing either would invert the dependency — and filename derivation needs
 * only "the words a human would read", which is the easy 90% of the problem.
 *
 * Exported because that same easy 90% is exactly what a caller wants whenever a
 * rich-text field has to become plain text outside a renderer — a document title
 * from a person's name, say. Anything doing real analysis of the text should use
 * `@repo/scoring`'s `toPlainText` instead.
 */
export function readableText(value: string | null | undefined): string {
  if (!value) return "";

  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Long enough for any real name, short enough for every filesystem. */
const MAX_STEM_LENGTH = 80;

/**
 * A filename-safe stem: letters and digits from any script, joined by single
 * hyphens.
 *
 * Hyphen rather than underscore or space, per the spec's own example
 * (`Pratham-Mehta-Resume.pdf`), and one separator used everywhere so two surfaces
 * can't disagree.
 *
 * Collapsing *everything* that isn't a letter or a digit is also what makes the
 * result safe to put in a header: quotes, semicolons, backslashes and newlines —
 * the characters that would let a name break out of `Content-Disposition` — are
 * gone by construction rather than by an escaping step someone has to remember.
 */
export function toFilenameStem(text: string | null | undefined): string {
  return readableText(text)
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_STEM_LENGTH)
    .replace(/-+$/g, "");
}

/** The name of the document, as the person who owns it would say it. */
type ExportNameSource = {
  title?: string | null;
  content?: Pick<ResumeContent, "personalInfo" | "freeformBlocks"> | null;
};

/** Suffixed onto the stem, unless the stem already ends with the same word. */
const SUFFIX = "Resume";

const FALLBACK_STEM = `Untitled-${SUFFIX}`;

/**
 * The filename for a resume download, e.g. `Pratham-Mehta-Resume.pdf`.
 *
 * Resolution order, each step used only if it yields readable text:
 *
 * 1. `content.personalInfo.name` — the structured field, on every template resume.
 * 2. The first heading block of a freeform document, in visual order. A blank
 *    canvas has no name *field*; the top-of-page heading is what the user typed
 *    their name into, so it's the closest equivalent.
 * 3. `title` — the document's own name, which at worst is the default we gave it.
 * 4. `Untitled-Resume`, so this never returns an extension with nothing in front
 *    of it.
 *
 * The suffix is skipped when the stem already ends in "Resume", so a document
 * titled "My Resume" downloads as `My-Resume.pdf` rather than
 * `My-Resume-Resume.pdf`.
 */
export function getExportFilename(
  resume: ExportNameSource,
  options: { extension?: string; suffix?: string } = {},
): string {
  const suffix = options.suffix ?? SUFFIX;
  const extension = options.extension ?? "pdf";

  const heading = orderedFreeformBlocks(resume.content?.freeformBlocks ?? []).find(
    (block) => block.type === "heading",
  );

  const stem =
    [resume.content?.personalInfo?.name, heading?.content, resume.title]
      .map(toFilenameStem)
      .find((candidate) => candidate.length > 0) ?? FALLBACK_STEM;

  const named = new RegExp(`(?:^|-)${suffix}$`, "i").test(stem) ? stem : `${stem}-${suffix}`;

  return `${named}.${extension}`;
}

/**
 * A `Content-Disposition` value that survives a non-ASCII filename.
 *
 * Two forms, per RFC 6266: the bare `filename` for anything that only speaks
 * ASCII, and `filename*` percent-encoded as UTF-8 for everything since IE9.
 * Browsers that understand the second prefer it, which is what lets a resume
 * belonging to नंदिनी or 李雷 download under their own name instead of a
 * transliteration — while `toFilenameStem` has already removed every character
 * that could terminate the header early.
 */
export function contentDispositionAttachment(filename: string): string {
  // ASCII is the widest set the bare form may safely carry. Dropping a whole
  // script can leave the separators that surrounded it, so those are tidied too —
  // the fallback should read as a filename, not as the wreckage of one.
  const ascii = filename
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/["\\]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "");

  return `attachment; filename="${ascii || "resume.pdf"}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
