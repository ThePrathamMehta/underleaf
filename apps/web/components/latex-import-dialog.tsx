"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { LatexImportResult, ResumeContent, TemplateDto } from "@repo/types";
import { isBlankTemplate, LATEX_SOURCE_MAX, readableText } from "@repo/types";
import { api, ApiError } from "../lib/api";
import { stashImportNotice } from "../lib/import-handoff";
import { Button } from "./button";

/**
 * "Import from LaTeX" — paste an Overleaf `.tex` source, land in the editor.
 *
 * Two entry points share this: the card at the head of the template gallery and
 * the step in the dashboard's New-resume flow. Importing is how most people with
 * an existing resume will arrive, so it can't be a feature you only find by
 * browsing templates first.
 *
 * The whole flow is two requests and no persistence in between: extract, show the
 * user what came back, then create the resume with that content when they say go.
 * Nothing is saved until they do, so backing out of a bad import costs a closed
 * modal rather than a resume in the dashboard to go and delete.
 */

/** Which template the imported content lands in, unless the caller says otherwise. */
const DEFAULT_TEMPLATE_SLUG = "jakes";

export function LatexImportDialog({
  open,
  templates,
  onClose,
  onImported,
}: {
  open: boolean;
  /** The gallery's list, used to pick which template the content lands in. */
  templates: TemplateDto[];
  onClose: () => void;
  /** Called with the new resume's id once it exists. */
  onImported: (resumeId: string) => void;
}) {
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState<"reading" | "creating" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // The template the content lands in. Blank is excluded on purpose: it is a
  // canvas with no section layout, so imported sections would render nowhere.
  const target =
    templates.find((t) => t.slug === DEFAULT_TEMPLATE_SLUG) ??
    templates.find((t) => !isBlankTemplate(t.slug)) ??
    null;

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // The paste target is the only thing anyone opens this for.
    const focusTimer = window.setTimeout(() => textareaRef.current?.focus(), 60);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
    };
  }, [open, busy, onClose]);

  // Reset between openings, so a failed attempt isn't still on screen next time.
  useEffect(() => {
    if (!open) {
      setSource("");
      setError(null);
      setBusy(null);
    }
  }, [open]);

  const tooLong = source.length > LATEX_SOURCE_MAX;

  async function submit() {
    const latexSource = source.trim();
    if (!latexSource || tooLong || !target) return;

    setError(null);
    setBusy("reading");

    let result: LatexImportResult;
    try {
      result = await api.importLatex(latexSource);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not read that LaTeX. Check the source and try again.",
      );
      setBusy(null);
      return;
    }

    setBusy("creating");
    try {
      const { resume } = await api.createResume({
        templateId: target.id,
        importedContent: result.content,
        // Named from the source rather than "Imported Resume", so the dashboard
        // shows whose resume it is at a glance.
        ...titleFrom(result.content),
      });

      // Stashed before navigating: the editor picks it up on mount and shows the
      // review banner once.
      stashImportNotice(resume.id, {
        confidence: result.confidence,
        warnings: result.warnings,
      });
      onImported(resume.id);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "The import worked, but the resume couldn't be created. Please try again.",
      );
      setBusy(null);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={() => !busy && onClose()}
          role="dialog"
          aria-modal="true"
          aria-label="Import from LaTeX"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm sm:p-8"
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            onClick={(event) => event.stopPropagation()}
            className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-paper-raised shadow-lift ring-1 ring-rule"
          >
            <div className="shrink-0 border-b border-rule px-6 py-5">
              <p className="font-mono text-[0.625rem] uppercase tracking-[0.14em] text-ink-faint">
                Import
              </p>
              <h2 className="mt-1.5 font-display text-2xl tracking-tight">
                Bring in a LaTeX resume
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted text-pretty">
                Paste the whole file, preamble and all. We read the structure —
                sections, roles, dates, bullets — and open it in an editor you can
                keep working in.
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
              <label
                htmlFor="latex-source"
                className="font-mono text-[0.625rem] uppercase tracking-[0.14em] text-ink-faint"
              >
                LaTeX source
              </label>
              <textarea
                id="latex-source"
                ref={textareaRef}
                value={source}
                onChange={(event) => setSource(event.target.value)}
                disabled={busy !== null}
                spellCheck={false}
                placeholder={"Paste your Overleaf .tex source here"}
                className="mt-2 h-64 w-full resize-y rounded-lg bg-paper px-3.5 py-3 font-mono text-[0.8125rem] leading-relaxed text-ink ring-1 ring-inset ring-rule transition-shadow placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60"
              />

              <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-[0.75rem] text-ink-faint">
                  One file. <code className="font-mono">\input</code> and{" "}
                  <code className="font-mono">\include</code> aren&rsquo;t followed.
                </p>
                {source.length > 0 && (
                  <p
                    className={`font-mono text-[0.6875rem] ${tooLong ? "text-danger" : "text-ink-faint"}`}
                  >
                    {source.length.toLocaleString()} / {LATEX_SOURCE_MAX.toLocaleString()}
                  </p>
                )}
              </div>

              {tooLong && (
                <p role="alert" className="mt-3 text-sm text-danger">
                  That&rsquo;s longer than a resume source should be — paste just the
                  one <code className="font-mono">.tex</code> file.
                </p>
              )}

              {error && (
                <p
                  role="alert"
                  className="mt-4 rounded-lg bg-danger-wash px-4 py-3 text-sm text-danger ring-1 ring-inset ring-danger/15"
                >
                  {error}
                </p>
              )}

              {!target && templates.length > 0 && (
                <p role="alert" className="mt-4 text-sm text-danger">
                  No template is available to import into.
                </p>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-rule px-6 py-4">
              <Button variant="ghost" size="md" onClick={onClose} disabled={busy !== null}>
                Cancel
              </Button>
              <Button
                size="md"
                onClick={() => void submit()}
                disabled={busy !== null || source.trim().length === 0 || tooLong || !target}
              >
                {busy === "reading"
                  ? "Reading…"
                  : busy === "creating"
                    ? "Opening editor…"
                    : // Reachable for a moment when `?import=1` opens the dialog
                      // before the gallery's templates have arrived.
                      !target
                      ? "Preparing…"
                      : "Import"}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * A title from the imported name, when there is one.
 *
 * `personalInfo.name` holds the same narrow inline HTML every rich-text field in
 * a resume does, so the tags come off before it becomes a plain-text title —
 * `<b>Jake Ryan</b>` in a dashboard heading would show the markup, not the name.
 * Omitting the key entirely when there's no name lets the API's own default
 * ("Imported Resume") apply rather than sending an empty string it would accept.
 */
function titleFrom(content: ResumeContent): { title?: string } {
  const name = readableText(content.personalInfo.name).slice(0, 60).trim();
  return name ? { title: `${name} — Resume` } : {};
}
