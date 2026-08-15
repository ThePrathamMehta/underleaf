"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  COVER_LETTER_TONES,
  COVER_LETTER_TONE_BLURBS,
  COVER_LETTER_TONE_LABELS,
  type AiUsageDto,
  type CoverLetterDto,
  type CoverLetterSummary,
  type CoverLetterTone,
  type ResumeWithTemplateDto,
} from "@repo/types";
import { api, ApiError } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth-context";
import { useUsage } from "../../../../lib/usage";
import { useLetterAutosave } from "../../../../lib/use-letter-autosave";
import { AllowanceMeter, AllowanceWall } from "../../../../components/allowance";
import { Button, ButtonLink, buttonClass } from "../../../../components/button";
import { FieldLabel } from "../../../../components/editor/controls";
import { Logo } from "../../../../components/logo";
import { ResumeThumbnail } from "../../../../components/resume-thumbnail";
import type { SaveStatus } from "../../../../lib/use-autosave";

/**
 * The cover letter workspace.
 *
 * Split view: the resume's facts on the left, the letter on the right. That
 * arrangement is the point — the letter may only claim what the resume says, so
 * the source is on screen while it's edited rather than a tab away.
 *
 * The body is a textarea, deliberately. A letter is prose; it has no sections to
 * reorder and nothing the pagination packer needs to measure, so inheriting the
 * block editor would hand the user heavier machinery than the task deserves and
 * a second document model to keep in step.
 */

const TONE_OPTIONS = COVER_LETTER_TONES.map((tone) => ({
  value: tone,
  label: COVER_LETTER_TONE_LABELS[tone],
}));

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export default function CoverLetterPage({
  params,
}: {
  params: Promise<{ resumeId: string }>;
}) {
  const { resumeId } = use(params);
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [resume, setResume] = useState<ResumeWithTemplateDto | null>(null);
  const [letter, setLetter] = useState<CoverLetterDto | null>(null);
  const [letters, setLetters] = useState<CoverLetterSummary[]>([]);
  const [body, setBody] = useState("");
  const [tone, setTone] = useState<CoverLetterTone>("formal");
  const [jobDescription, setJobDescription] = useState("");
  const [reusedJd, setReusedJd] = useState(false);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when generation was refused for want of allowance. */
  const [blocked, setBlocked] = useState<AiUsageDto | null>(null);
  const { applyUsage } = useUsage();

  const aborter = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace(`/login?next=${encodeURIComponent(`/resumes/${resumeId}/cover-letter`)}`);
    }
  }, [authLoading, user, router, resumeId]);

  // The resume and any existing letters load together: the left pane needs the
  // former, and without the latter the page can't tell a first visit from a
  // return visit, which is the difference between an empty state and a draft.
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();

    // Wrapped in `Promise.resolve().then(...)` rather than calling the two
    // straight into `Promise.all(...)`: an exception raised while building the
    // argument array — a stale hot-reload chunk where a method isn't defined
    // yet, say — is thrown synchronously, escapes the chain, and reaches the
    // user as a raw error overlay instead of this page's own error screen.
    Promise.resolve()
      .then(() => Promise.all([api.resume(resumeId), api.coverLetters(resumeId, controller.signal)]))
      .then(([{ resume: loaded }, { letters: list, latest }]) => {
        if (controller.signal.aborted) return;
        setResume(loaded);
        setLetters(list);
        if (latest) {
          setLetter(latest);
          setBody(latest.content);
          setTone(latest.tone);
          setJobDescription(latest.jobDescriptionText ?? "");
        }
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setLoadError(
          caught instanceof ApiError
            ? { status: caught.status, message: caught.message }
            : { status: 0, message: "Could not load this resume." },
        );
        setLoading(false);
      });

    return () => controller.abort();
  }, [user, resumeId]);

  useEffect(() => () => aborter.current?.abort(), []);

  const buildPatch = useCallback(() => ({ content: body, tone }), [body, tone]);
  const { status, error: saveError, isDirty, onEdit, saveNow, reset } = useLetterAutosave(
    letter?.id ?? null,
    buildPatch,
  );

  const generate = useCallback(
    async (options: { regenerate: boolean }) => {
      if (generating) return;

      setGenerating(true);
      setError(null);
      setBlocked(null);

      // A queued edit would otherwise save the old body back over the new letter
      // a beat after it arrives.
      if (isDirty && letter) {
        try {
          await saveNow();
        } catch {
          // Non-fatal: the generation replaces the body anyway.
        }
      }

      const controller = new AbortController();
      aborter.current = controller;

      try {
        const trimmed = jobDescription.trim();
        const response = await api.generateCoverLetter(
          resumeId,
          {
            tone,
            // Undefined asks the server to reuse the newest JD comparison; a
            // string — including "" — is an explicit choice.
            jobDescriptionText: letter || trimmed ? trimmed : undefined,
            ...(options.regenerate && letter ? { coverLetterId: letter.id } : {}),
          },
          controller.signal,
        );

        reset();
        setLetter(response.letter);
        setBody(response.letter.content);
        setTone(response.letter.tone);
        setReusedJd(response.reusedJobDescription);
        // Always present on a generate: there's no deterministic half to fall
        // back to here, so a letter that exists is an action that was spent.
        applyUsage(response.usage);
        if (response.reusedJobDescription && response.letter.jobDescriptionText) {
          setJobDescription(response.letter.jobDescriptionText);
        }

        setLetters((current) => {
          const summary: CoverLetterSummary = {
            id: response.letter.id,
            resumeId: response.letter.resumeId,
            excerpt: response.letter.content.replace(/\s+/g, " ").slice(0, 100),
            tone: response.letter.tone,
            updatedAt: response.letter.updatedAt,
          };
          const rest = current.filter((entry) => entry.id !== summary.id);
          return [summary, ...rest];
        });
      } catch (caught: unknown) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;

        // Refused for want of allowance: replace the button's dead click with
        // the inline wall, exactly where the letter would have appeared.
        if (caught instanceof ApiError && caught.isAllowanceExhausted && caught.usage) {
          applyUsage(caught.usage);
          setBlocked(caught.usage);
          return;
        }

        setError(
          caught instanceof ApiError
            ? caught.message
            : "The letter couldn't be written. Try again.",
        );
      } finally {
        aborter.current = null;
        setGenerating(false);
      }
    },
    [generating, isDirty, jobDescription, letter, resumeId, reset, saveNow, tone, applyUsage],
  );

  /**
   * Changing the tone of an existing letter saves the choice immediately, but
   * doesn't rewrite anything. Regenerating costs a provider call and would throw
   * away hand edits, so it stays an explicit button.
   */
  const changeTone = useCallback(
    (next: CoverLetterTone) => {
      setTone(next);
      if (letter) onEdit();
    },
    [letter, onEdit],
  );

  const words = useMemo(() => wordCount(body), [body]);

  if (loadError) {
    return (
      <ErrorScreen
        title={loadError.status === 404 ? "We couldn't find that resume" : "Something went wrong"}
        message={
          loadError.status === 404
            ? "It may have been deleted, or it belongs to another account."
            : loadError.message
        }
      />
    );
  }

  if (loading || !resume) return <LoadingScreen />;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-paper">
      <LetterHeader
        resumeId={resumeId}
        resumeTitle={resume.title}
        status={status}
        letterId={letter?.id ?? null}
        onBack={() => {
          if (isDirty) void saveNow();
          router.push(`/editor/${resumeId}`);
        }}
      />

      {(saveError || error) && (
        <div role="alert" className="border-b border-danger/20 bg-danger-wash px-4 py-2 text-center text-sm text-danger">
          {error ?? saveError}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <SourcePane
          resume={resume}
          tone={tone}
          jobDescription={jobDescription}
          reusedJd={reusedJd}
          generating={generating}
          hasLetter={letter !== null}
          blocked={blocked}
          onToneChange={changeTone}
          onJobDescriptionChange={(value) => {
            setJobDescription(value);
            setReusedJd(false);
          }}
          onGenerate={() => void generate({ regenerate: letter !== null })}
        />

        <LetterPane
          letter={letter}
          body={body}
          words={words}
          generating={generating}
          letters={letters}
          onBodyChange={(value) => {
            setBody(value);
            onEdit();
          }}
          onOpen={(id) => {
            const controller = new AbortController();
            aborter.current = controller;
            void api
              .coverLetter(id, controller.signal)
              .then(({ letter: opened }) => {
                reset();
                setLetter(opened);
                setBody(opened.content);
                setTone(opened.tone);
                setJobDescription(opened.jobDescriptionText ?? "");
              })
              .catch(() => setError("Could not open that letter."));
          }}
        />
      </div>
    </div>
  );
}

// --- Header ---

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: "",
  pending: "Unsaved",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed",
};

function LetterHeader({
  resumeId,
  resumeTitle,
  status,
  letterId,
  onBack,
}: {
  resumeId: string;
  resumeTitle: string;
  status: SaveStatus;
  letterId: string | null;
  onBack: () => void;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-rule px-3">
      <button
        type="button"
        onClick={onBack}
        title="Back to the resume"
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[0.8125rem] text-ink-muted transition-colors duration-150 hover:bg-paper-sunken hover:text-ink"
      >
        <BackIcon />
        <span className="hidden sm:inline">Resume</span>
      </button>

      <div className="mx-1 h-5 w-px shrink-0 bg-rule" aria-hidden />

      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-[0.9375rem] tracking-tight">
          Cover letter
          <span className="ml-2 text-ink-faint">for {resumeTitle}</span>
        </p>
      </div>

      {status !== "idle" && (
        <span
          role="status"
          aria-live="polite"
          className={`hidden shrink-0 items-center gap-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.1em] sm:inline-flex ${
            status === "error" ? "text-danger" : "text-ink-faint"
          }`}
        >
          <span
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full ${
              status === "saving"
                ? "animate-pulse bg-ink-faint"
                : status === "saved"
                  ? "bg-positive"
                  : status === "error"
                    ? "bg-danger"
                    : "bg-ink-faint/50"
            }`}
          />
          {STATUS_TEXT[status]}
        </span>
      )}

      {/* A navigation, not a fetch: the PDF arrives as a file download, and the
          server renders it from the saved row. */}
      {letterId ? (
        <a
          href={api.coverLetterExportUrl(letterId)}
          className={buttonClass("secondary", "sm", "shrink-0")}
        >
          <DownloadIcon />
          <span className="hidden sm:inline">Export PDF</span>
        </a>
      ) : (
        <ButtonLink href={`/editor/${resumeId}`} variant="ghost" size="sm" className="shrink-0">
          Editor
        </ButtonLink>
      )}
    </header>
  );
}

// --- Left: what the letter is written from ---

function SourcePane({
  resume,
  tone,
  jobDescription,
  reusedJd,
  generating,
  hasLetter,
  blocked,
  onToneChange,
  onJobDescriptionChange,
  onGenerate,
}: {
  resume: ResumeWithTemplateDto;
  tone: CoverLetterTone;
  jobDescription: string;
  reusedJd: boolean;
  generating: boolean;
  hasLetter: boolean;
  /** Non-null once generation was refused for want of allowance. */
  blocked: AiUsageDto | null;
  onToneChange: (tone: CoverLetterTone) => void;
  onJobDescriptionChange: (value: string) => void;
  onGenerate: () => void;
}) {
  return (
    <aside className="flex min-h-0 shrink-0 flex-col border-b border-rule lg:w-[24rem] lg:border-b-0 lg:border-r">
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-5">
        <section>
          <FieldLabel>Written from</FieldLabel>
          <Link
            href={`/editor/${resume.id}`}
            className="mt-2 block overflow-hidden rounded-lg ring-1 ring-rule transition-all duration-300 hover:shadow-lift hover:ring-rule-strong"
          >
            <ResumeThumbnail
              templateSlug={resume.template.slug}
              content={resume.content}
              theme={resume.theme}
            />
          </Link>
          <p className="mt-2 text-[0.75rem] leading-snug text-ink-faint">
            Every claim in the letter comes from this document. Nothing is invented &mdash;
            if a number isn&rsquo;t here, it won&rsquo;t be there.
          </p>
        </section>

        <section>
          <FieldLabel>Tone</FieldLabel>
          <div className="mt-2 inline-flex w-full rounded-lg bg-paper-sunken p-0.5">
            {TONE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={tone === option.value}
                onClick={() => onToneChange(option.value)}
                className={`h-8 flex-1 rounded-[0.375rem] text-[0.75rem] transition-colors duration-150 ${
                  tone === option.value
                    ? "bg-paper-raised text-ink shadow-[0_1px_2px_rgb(0_0_0/0.06)]"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[0.75rem] leading-snug text-ink-faint">
            {COVER_LETTER_TONE_BLURBS[tone]}
          </p>
        </section>

        <section>
          <div className="flex items-baseline justify-between">
            <FieldLabel>Job posting</FieldLabel>
            <span className="font-mono text-[0.625rem] text-ink-faint">Optional</span>
          </div>

          {reusedJd && (
            <p
              role="status"
              className="mt-2 rounded-lg bg-accent-wash px-3 py-2 text-[0.75rem] leading-snug text-accent"
            >
              Reused the posting from your last job match, so you don&rsquo;t have to paste
              it twice.
            </p>
          )}

          <textarea
            value={jobDescription}
            onChange={(event) => onJobDescriptionChange(event.target.value)}
            placeholder="Paste the posting to tailor the letter to it. Leave this empty for a general letter you can adapt later."
            rows={8}
            maxLength={20_000}
            className="mt-2 w-full resize-y rounded-lg bg-paper-sunken px-3 py-2 text-[0.8125rem] leading-relaxed text-ink outline-none ring-1 ring-inset ring-rule placeholder:text-ink-faint focus:ring-rule-strong"
          />
        </section>
      </div>

      <div className="border-t border-rule p-3">
        {blocked && <AllowanceWall usage={blocked} className="mb-3" />}
        <Button size="sm" className="w-full" onClick={onGenerate} disabled={generating}>
          {generating ? "Writing…" : hasLetter ? "Regenerate" : "Write the letter"}
        </Button>
        {hasLetter && !blocked && (
          <p className="mt-2 text-center text-[0.6875rem] leading-snug text-ink-faint">
            Regenerating replaces the letter, including any edits you&rsquo;ve made.
          </p>
        )}
        <AllowanceMeter className="mt-2 text-center" />
      </div>
    </aside>
  );
}

// --- Right: the letter ---

function LetterPane({
  letter,
  body,
  words,
  generating,
  letters,
  onBodyChange,
  onOpen,
}: {
  letter: CoverLetterDto | null;
  body: string;
  words: number;
  generating: boolean;
  letters: CoverLetterSummary[];
  onBodyChange: (value: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <main className="flex min-h-0 flex-1 flex-col bg-paper-sunken/40">
      <AnimatePresence mode="wait">
        {generating && !letter ? (
          <motion.div
            key="writing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex min-h-0 flex-1 items-center justify-center p-6"
          >
            <WritingState />
          </motion.div>
        ) : letter ? (
          <motion.div
            key="letter"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
              {/* A sheet, not a form field: the letter should look like the thing
                  it becomes. The textarea grows with its content rather than
                  scrolling internally, so the page scrolls as a document would. */}
              <div className="mx-auto w-full max-w-[46rem] rounded-lg bg-paper p-6 shadow-lift ring-1 ring-rule sm:p-10">
                <textarea
                  value={body}
                  onChange={(event) => onBodyChange(event.target.value)}
                  disabled={generating}
                  spellCheck
                  aria-label="Cover letter body"
                  rows={Math.max(18, body.split("\n").length + 2)}
                  className="w-full resize-none bg-transparent text-[0.9375rem] leading-[1.75] text-ink outline-none disabled:opacity-60"
                />
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-rule bg-paper px-4 py-2">
              <span className="font-mono text-[0.625rem] uppercase tracking-[0.12em] text-ink-faint">
                {words} {words === 1 ? "word" : "words"}
                {words > 400 && <span className="ml-2 text-danger">Long &mdash; aim under 400</span>}
              </span>

              {letters.length > 1 && (
                <LetterSwitcher letters={letters} activeId={letter.id} onOpen={onOpen} />
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex min-h-0 flex-1 items-center justify-center p-6"
          >
            <EmptyState />
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

function LetterSwitcher({
  letters,
  activeId,
  onOpen,
}: {
  letters: CoverLetterSummary[];
  activeId: string;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <FieldLabel>Drafts</FieldLabel>
      <select
        value={activeId}
        onChange={(event) => onOpen(event.target.value)}
        aria-label="Switch draft"
        className="min-w-0 max-w-[18rem] truncate rounded-md bg-paper-sunken px-2 py-1 text-[0.75rem] text-ink-muted outline-none ring-1 ring-inset ring-rule focus:ring-rule-strong"
      >
        {letters.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {COVER_LETTER_TONE_LABELS[entry.tone]} &mdash; {entry.excerpt || "Untitled draft"}
          </option>
        ))}
      </select>
    </div>
  );
}

// --- States ---

function WritingState() {
  return (
    <div className="w-full max-w-[46rem] rounded-lg bg-paper p-6 shadow-lift ring-1 ring-rule sm:p-10">
      <p className="font-mono text-[0.625rem] uppercase tracking-[0.14em] text-ink-faint">
        Writing your letter
      </p>
      <div className="mt-5 space-y-3" aria-hidden>
        {[92, 100, 96, 74, 100, 88, 46].map((width, index) => (
          <motion.div
            key={index}
            animate={{ opacity: [0.25, 0.6, 0.25] }}
            transition={{ duration: 1.6, repeat: Infinity, delay: index * 0.1, ease: "easeInOut" }}
            className="h-3 rounded bg-paper-sunken"
            style={{ width: `${width}%` }}
          />
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="max-w-[36rem] text-center">
      <p className="font-display text-2xl tracking-tight">No letter yet</p>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-muted">
        Pick a tone, paste the posting if you have one, and the letter gets written from
        your resume &mdash; only from what it already says.
      </p>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-muted">
        You can edit every word afterwards. It saves as you type, and exports as a PDF in
        the same typeface as the resume it goes with.
      </p>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-paper">
      <motion.div
        animate={{ opacity: [0.35, 1, 0.35] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      >
        <Logo className="h-7 w-auto" />
      </motion.div>
      <p className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ink-faint">
        Opening your letter
      </p>
    </div>
  );
}

function ErrorScreen({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-5 bg-paper px-6 text-center">
      <Logo className="h-7 w-auto" />
      <div className="max-w-[42ch]">
        <h1 className="font-display text-2xl tracking-tight">{title}</h1>
        <p className="mt-2 text-ink-muted">{message}</p>
      </div>
      <ButtonLink href="/dashboard" variant="secondary" size="sm">
        Back to your resumes
      </ButtonLink>
    </div>
  );
}

// --- Icons ---

const svg = {
  width: 15,
  height: 15,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function BackIcon() {
  return (
    <svg {...svg}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg {...svg}>
      <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
    </svg>
  );
}
