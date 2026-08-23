import type { LatexImportConfidence } from "@repo/types";

/**
 * Carrying the "you just imported this" notice from the import dialog to the
 * editor.
 *
 * The banner belongs to the navigation, not to the resume: it is shown once,
 * right after an import, and a resume opened again next week is just a resume.
 * That rules out persisting it on the row — a flag in the database would need a
 * column, a migration, and a write to clear it, all to describe something that
 * stopped being true the moment the user read it.
 *
 * A query param is the other obvious carrier and is nearly right, but the notice
 * includes up to twelve warning strings — too much for a URL, and a URL the user
 * might bookmark or share with the banner baked into it.
 *
 * So: session storage, keyed by resume id, and **removed on read**. One-time by
 * construction rather than by remembering to clear a flag, scoped to the tab that
 * did the importing, and gone when that tab closes.
 */

export interface ImportNotice {
  confidence: LatexImportConfidence;
  warnings: string[];
}

const KEY_PREFIX = "underleaf:import-notice:";

/**
 * Storage is best-effort throughout. Safari's private mode throws on write and
 * an embedded context can have storage denied outright — neither is a reason to
 * fail an import that has otherwise succeeded, so the notice is simply lost and
 * the user lands on their resume without a banner.
 */
export function stashImportNotice(resumeId: string, notice: ImportNotice): void {
  try {
    sessionStorage.setItem(KEY_PREFIX + resumeId, JSON.stringify(notice));
  } catch {
    // Ignored deliberately — see above.
  }
}

/** Reads the notice and consumes it, so a refresh doesn't show the banner twice. */
export function takeImportNotice(resumeId: string): ImportNotice | null {
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + resumeId);
    if (!raw) return null;
    sessionStorage.removeItem(KEY_PREFIX + resumeId);

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;

    const { confidence, warnings } = parsed as Partial<ImportNotice>;
    if (confidence !== "deterministic" && confidence !== "ai-assisted") return null;

    return {
      confidence,
      warnings: Array.isArray(warnings)
        ? warnings.filter((entry): entry is string => typeof entry === "string").slice(0, 12)
        : [],
    };
  } catch {
    return null;
  }
}
