"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import type { PdfDocumentSummaryDto } from "@repo/types";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { pdfUploadError } from "../../lib/uploads";
import { ButtonLink } from "../../components/button";
import { SiteHeader } from "../../components/site-header";

/**
 * The home for PDF editing.
 *
 * The feature previously existed only as a button on the dashboard, which put it
 * behind a sign-in and a click most people never made. This route is public and
 * linkable — the header and the landing page both point here — so the capability
 * can be explained before an account exists. Uploading still needs one (every
 * `/pdfs` route is behind requireAuth), so a signed-out visitor is sent to
 * signup with `next=/pdf` and lands right back on the dropzone.
 */
export default function PdfPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [documents, setDocuments] = useState<PdfDocumentSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  // dragenter/dragleave also fire when the pointer crosses a *child* of the
  // dropzone, so a boolean alone flickers. Counting entries against leaves is
  // the standard fix.
  const dragDepth = useRef(0);

  useEffect(() => {
    if (!user) {
      setDocuments(null);
      return;
    }
    api
      .pdfs()
      .then(({ documents: list }) => setDocuments(list))
      .catch(() => setDocuments([]));
  }, [user]);

  async function uploadPdf(file: File) {
    setError(null);
    setUploading(true);

    try {
      const { document } = await api.uploadPdf(file);
      // Straight into the editor: the upload already parsed the whole document,
      // so there's nothing else the user would do from here.
      router.push(`/pdf-editor/${document.id}`);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not upload that PDF. Please try again.",
      );
      setUploading(false);
    }
  }

  /** Shared by the file picker and the dropzone. */
  function accept(file: File | undefined) {
    if (!file) return;

    // The server enforces all of this too; checking here saves a pointless round
    // trip of what may be a large file, and turns "wait for the upload, then get
    // rejected" into an instant answer.
    const rejection = pdfUploadError(file);
    if (rejection) {
      setError(rejection);
      return;
    }

    void uploadPdf(file);
  }

  /** True once we know there's no session — not while auth is still resolving. */
  const signedOut = !authLoading && !user;

  function openPicker() {
    if (signedOut) {
      router.push("/signup?next=/pdf");
      return;
    }
    inputRef.current?.click();
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (uploading || authLoading) return;
    if (signedOut) {
      router.push("/signup?next=/pdf");
      return;
    }
    accept(event.dataTransfer.files[0]);
  }

  return (
    <>
      <SiteHeader />

      <main>
        <section className="relative overflow-hidden border-b border-rule">
          <div className="pointer-events-none absolute inset-0 opacity-[0.55] paper-lines" aria-hidden />

          <div className="relative mx-auto grid max-w-6xl gap-14 px-6 pb-20 pt-16 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:gap-16 lg:pt-20">
            <div>
              <motion.p
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="mb-6 font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-ink-faint"
              >
                PDF editing · No re-typing
              </motion.p>

              <motion.h1
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
                className="max-w-[16ch] font-display text-[clamp(2.25rem,5.5vw,3.75rem)] leading-[1.02] tracking-tightest text-balance"
              >
                Already have a PDF? <em className="italic text-accent">Edit it.</em>
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.14, ease: [0.22, 1, 0.36, 1] }}
                className="mt-6 max-w-[46ch] text-[1.0625rem] leading-relaxed text-ink-muted text-pretty"
              >
                Upload a resume you exported years ago — from Word, Canva, LaTeX, anywhere. We read
                its text, fonts and layout, and let you retype any line in place. Everything you
                don&rsquo;t touch stays byte-for-byte identical.
              </motion.p>

              <motion.ul
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="mt-8 space-y-2.5 text-[0.9375rem] text-ink-muted"
              >
                {[
                  "The original fonts, kept — embedded ones are extracted and reused.",
                  "Rules, logos and graphics untouched; only the text you edit changes.",
                  "Export back to PDF whenever you like.",
                ].map((line) => (
                  <li key={line} className="flex gap-2.5">
                    <CheckGlyph />
                    <span className="text-pretty">{line}</span>
                  </li>
                ))}
              </motion.ul>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
            >
              {/* Hidden input + a real button, rather than a styled file input:
                  file inputs can't be restyled consistently across browsers. */}
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  // Reset first so re-picking the same file still fires onChange.
                  event.target.value = "";
                  accept(file);
                }}
              />

              <button
                type="button"
                onClick={openPicker}
                disabled={uploading || authLoading}
                onDragEnter={(event) => {
                  event.preventDefault();
                  dragDepth.current += 1;
                  setDragging(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => {
                  event.preventDefault();
                  dragDepth.current -= 1;
                  if (dragDepth.current <= 0) setDragging(false);
                }}
                onDrop={handleDrop}
                className={`flex w-full flex-col items-center justify-center gap-4 rounded-2xl px-8 py-14 text-center transition-all duration-200 disabled:cursor-default ${
                  dragging
                    ? "bg-accent-wash ring-2 ring-accent"
                    : "bg-paper-raised ring-1 ring-inset ring-rule-strong hover:bg-paper-sunken hover:ring-rule-strong"
                }`}
              >
                <UploadGlyph active={dragging} busy={uploading} />

                <span className="font-display text-2xl tracking-tight text-ink">
                  {uploading
                    ? "Reading your PDF…"
                    : dragging
                      ? "Drop it here"
                      : "Drop a PDF, or choose a file"}
                </span>

                <span className="max-w-[34ch] text-[0.875rem] leading-relaxed text-ink-muted">
                  {uploading
                    ? "Extracting text, fonts and page images. This takes a few seconds."
                    : signedOut
                      ? "You'll need an account first — it takes about twenty seconds, and you'll come straight back here."
                      : "Up to 15 MB. Text-based PDFs only; a scanned page has no text to edit."}
                </span>
              </button>

              {signedOut && (
                <p className="mt-4 text-center text-[0.8125rem] text-ink-faint">
                  Already have an account?{" "}
                  <Link
                    href="/login?next=/pdf"
                    className="text-accent underline decoration-accent-ring underline-offset-[3px] hover:decoration-accent"
                  >
                    Sign in
                  </Link>
                </p>
              )}

              {error && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  role="alert"
                  className="mt-4 rounded-lg bg-danger-wash px-4 py-3 text-sm text-danger ring-1 ring-inset ring-danger/15"
                >
                  {error}
                </motion.p>
              )}
            </motion.div>
          </div>
        </section>

        {/* The caller's own uploads, so this page is somewhere to come back to
            rather than a one-way funnel. */}
        <AnimatePresence>
          {documents !== null && documents.length > 0 && (
            <motion.section
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="border-b border-rule bg-paper-raised"
            >
              <div className="mx-auto max-w-6xl px-6 py-14">
                <h2 className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-ink-faint">
                  Your PDFs
                </h2>

                <ul className="mt-6 divide-y divide-rule border-y border-rule">
                  {documents.map((pdf) => (
                    <li key={pdf.id}>
                      <Link
                        href={`/pdf-editor/${pdf.id}`}
                        className="group flex items-center gap-4 py-3.5"
                      >
                        <PdfFileGlyph />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium tracking-tight transition-colors group-hover:text-accent">
                            {pdf.title}
                          </span>
                          <span className="mt-0.5 block text-[0.8125rem] text-ink-faint">
                            {pdf.pageCount} {pdf.pageCount === 1 ? "page" : "pages"}
                          </span>
                        </span>
                        <span
                          aria-hidden
                          className="shrink-0 text-ink-faint transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-ink"
                        >
                          →
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        <section className="border-b border-rule">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="mb-14 font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-ink-faint">
              What happens to your file
            </h2>

            <ol className="grid gap-x-12 gap-y-12 md:grid-cols-3">
              {[
                {
                  n: "01",
                  title: "It gets read, not redrawn",
                  body: "Every page is measured in PDF points and every run of text is located exactly where it sits. The page you see in the editor is your page, rendered from the file itself.",
                },
                {
                  n: "02",
                  title: "You retype in place",
                  body: "Click a line and edit it. The run keeps its font, size, colour and baseline, so a corrected job title looks like it was always there.",
                },
                {
                  n: "03",
                  title: "Export keeps the rest",
                  body: "The exporter reopens your original file and replaces only the runs you changed. Nothing else in the document is re-rendered.",
                },
              ].map((step, i) => (
                <motion.li
                  key={step.n}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-80px" }}
                  transition={{ duration: 0.5, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="mb-5 rule-fade" />
                  <span className="font-mono text-xs text-accent">{step.n}</span>
                  <h3 className="mt-3 font-display text-2xl tracking-tight">{step.title}</h3>
                  <p className="mt-3 leading-relaxed text-ink-muted text-pretty">{step.body}</p>
                </motion.li>
              ))}
            </ol>
          </div>
        </section>

        <section className="bg-paper-raised">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-8 px-6 py-16 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="max-w-[28ch] font-display text-[clamp(1.5rem,3vw,2.25rem)] leading-[1.15] tracking-tight text-balance">
                Starting from scratch instead?
              </h2>
              <p className="mt-3 max-w-[46ch] text-ink-muted text-pretty">
                Pick a typeset template and edit it like a document — same editor, structured
                content, full control over the layout.
              </p>
            </div>
            <ButtonLink href="/start" variant="secondary" size="lg" className="shrink-0">
              Browse templates
            </ButtonLink>
          </div>
        </section>
      </main>
    </>
  );
}

function UploadGlyph({ active, busy }: { active: boolean; busy: boolean }) {
  return (
    <span
      className={`flex h-14 w-14 items-center justify-center rounded-full transition-colors duration-200 ${
        active ? "bg-accent text-white dark:text-paper" : "bg-paper-sunken text-ink-muted"
      }`}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className={busy ? "animate-pulse" : undefined}
      >
        <path d="M12 16V4" />
        <path d="m7 9 5-5 5 5" />
        <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      </svg>
    </span>
  );
}

function CheckGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="mt-1 shrink-0 text-accent"
    >
      <path d="m4 12 5.5 5.5L20 7" />
    </svg>
  );
}

function PdfFileGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0 text-ink-muted"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}
