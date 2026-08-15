"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import type {
  AiUsageDto,
  JdComparisonDto,
  JdComparisonSummary,
  JdKeyword,
  JdSuggestion,
  ResumeContent,
  Theme,
} from "@repo/types";
import { api, ApiError } from "../../lib/api";
import { useUsage } from "../../lib/usage";
import { AllowanceMeter, AllowanceWall } from "../allowance";
import { Button } from "../button";
import { FieldLabel, IconButton } from "./controls";

/**
 * The job-match panel.
 *
 * Paste a posting, get a weighted keyword diff and a short list of gaps worth
 * closing. The interesting control is "Apply with AI": it hands one suggestion to
 * the same tool-calling pipeline the chat assistant uses, streams the resulting
 * document straight into the editor's reducer, and is therefore undoable in one
 * Ctrl+Z like anything typed into the chat box.
 *
 * The panel never composes the instruction the model receives — it sends a
 * suggestion id and the server reads back the text it wrote when it found the
 * gap. That keeps "Apply with AI" a button that closes a measured gap rather
 * than a prompt box in disguise.
 */

const MIN_JD_LENGTH = 80;

function scoreTone(score: number): string {
  if (score >= 75) return "text-positive";
  if (score >= 50) return "text-accent";
  return "text-danger";
}

export function JdPanel({
  resumeId,
  onClose,
  onBeforeRun,
  onBeforeApply,
  onApplyDocument,
  onFocusSection,
}: {
  resumeId: string;
  onClose: () => void;
  /** Flushes autosave — the comparison runs against the saved document. */
  onBeforeRun: () => Promise<void>;
  /** Flushes *and* opens one undo step, before an edit streams in. */
  onBeforeApply: () => Promise<void>;
  onApplyDocument: (content: ResumeContent, theme: Theme) => void;
  onFocusSection: (sectionId: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [comparison, setComparison] = useState<JdComparisonDto | null>(null);
  const [past, setPast] = useState<JdComparisonSummary[]>([]);
  const [aiError, setAiError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The suggestion currently being applied, or null. */
  const [applying, setApplying] = useState<string | null>(null);
  const [applied, setApplied] = useState<Record<string, string>>({});
  /**
   * Set when either metered action here was refused. One piece of state for both,
   * because the wall says the same thing whichever button hit it and showing two
   * copies of it would be noise.
   */
  const [blocked, setBlocked] = useState<AiUsageDto | null>(null);
  const { applyUsage } = useUsage();

  const aborter = useRef<AbortController | null>(null);

  // Loads the history list, then the most recent comparison in full — so
  // reopening the panel shows what you last compared against rather than a
  // blank box you have to re-paste into.
  useEffect(() => {
    const controller = new AbortController();

    api
      .jdComparisons(resumeId, controller.signal)
      .then(async ({ comparisons }) => {
        setPast(comparisons);
        const latest = comparisons[0];
        if (latest) {
          const { comparison: full } = await api.jdComparison(
            resumeId,
            latest.id,
            controller.signal,
          );
          setComparison(full);
          setDraft(full.jobDescriptionText);
        }
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof ApiError ? caught.message : "Could not load your comparisons.");
        setLoading(false);
      });

    return () => controller.abort();
  }, [resumeId]);

  // Anything in flight when the panel closes is abandoned with it.
  useEffect(() => () => aborter.current?.abort(), []);

  const compare = useCallback(async () => {
    const text = draft.trim();
    if (text.length < MIN_JD_LENGTH || comparing) return;

    setComparing(true);
    setError(null);
    setBlocked(null);
    setApplied({});

    try {
      await onBeforeRun();
    } catch {
      // Non-fatal: the server falls back to the last saved document.
    }

    const controller = new AbortController();
    aborter.current = controller;

    try {
      const response = await api.compareJd(
        resumeId,
        { jobDescriptionText: text },
        controller.signal,
      );
      setComparison(response.comparison);
      setAiError(response.aiError);
      // Refunded already if the AI half never ran — the keyword diff on its own
      // is free, and this is whatever the server ended up charging.
      applyUsage(response.usage);
      setPast((current) => [
        {
          id: response.comparison.id,
          matchScore: response.comparison.matchScore,
          excerpt: response.comparison.jobDescriptionText.split("\n")[0]?.slice(0, 90) ?? "",
          createdAt: response.comparison.createdAt,
        },
        ...current,
      ]);
    } catch (caught: unknown) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;

      if (caught instanceof ApiError && caught.isAllowanceExhausted && caught.usage) {
        applyUsage(caught.usage);
        setBlocked(caught.usage);
        return;
      }

      setError(
        caught instanceof ApiError ? caught.message : "The comparison couldn't finish. Try again.",
      );
    } finally {
      aborter.current = null;
      setComparing(false);
    }
  }, [applyUsage, comparing, draft, onBeforeRun, resumeId]);

  /**
   * Runs one suggestion through the assistant.
   *
   * `document` events go straight to `onApplyDocument`, the same handler the chat
   * panel uses, so the canvas updates live and the whole application collapses
   * into one undo step.
   */
  const apply = useCallback(
    async (suggestion: JdSuggestion) => {
      if (!comparison || applying) return;

      setApplying(suggestion.id);
      setError(null);
      setBlocked(null);

      try {
        await onBeforeApply();
      } catch {
        // Non-fatal, as above.
      }

      const controller = new AbortController();
      aborter.current = controller;

      let changes = 0;
      let failure: string | null = null;

      try {
        for await (const event of api.applyJdSuggestion(
          resumeId,
          comparison.id,
          suggestion.id,
          controller.signal,
        )) {
          if (event.type === "document") {
            onApplyDocument(event.content, event.theme);
          } else if (event.type === "tool") {
            if (event.outcome.ok) changes += 1;
          } else if (event.type === "error") {
            failure = event.message;
          } else if (event.type === "done") {
            // `done` carries the counter the apply just spent.
            applyUsage(event.usage);
          }
        }
      } catch (caught: unknown) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;

        // Same refusal as a compare, surfaced the same way.
        if (caught instanceof ApiError && caught.isAllowanceExhausted && caught.usage) {
          applyUsage(caught.usage);
          setBlocked(caught.usage);
          return;
        }

        failure =
          caught instanceof ApiError ? caught.message : "The connection to the assistant dropped.";
      } finally {
        aborter.current = null;
        setApplying(null);
      }

      if (failure) {
        setError(failure);
        return;
      }

      // "Nothing changed" is a legitimate outcome — the assistant is told to
      // refuse a gap the resume can't honestly support — so it's reported as
      // such rather than shown as a success.
      setApplied((current) => ({
        ...current,
        [suggestion.id]:
          changes > 0
            ? `Applied ${changes} change${changes === 1 ? "" : "s"} · Ctrl+Z to undo`
            : "No change — your resume didn't support this one.",
      }));

      if (suggestion.sectionRef) onFocusSection(suggestion.sectionRef);
    },
    [applying, comparison, onApplyDocument, onBeforeApply, onFocusSection, resumeId, applyUsage],
  );

  const tooShort = draft.trim().length < MIN_JD_LENGTH;

  return (
    <aside
      className="fixed inset-0 z-40 flex flex-col bg-paper md:relative md:inset-auto md:z-auto md:w-[22rem] md:shrink-0 md:border-l md:border-rule"
      aria-label="Job description match"
    >
      <div className="flex h-12 items-center justify-between border-b border-rule px-4">
        <FieldLabel>Job match</FieldLabel>
        <IconButton label="Close job match panel" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {loading && <LoadingLines />}

        {error && (
          <p role="alert" className="rounded-lg bg-danger-wash px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        {blocked && <AllowanceWall usage={blocked} />}

        {!loading && (
          <section>
            <FieldLabel>The posting</FieldLabel>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Paste the full job description here — requirements, responsibilities, the lot. The more of it, the more accurate the match."
              rows={7}
              maxLength={20_000}
              className="mt-2 w-full resize-y rounded-lg bg-paper-sunken px-3 py-2 text-[0.8125rem] leading-relaxed text-ink outline-none ring-1 ring-inset ring-rule placeholder:text-ink-faint focus:ring-rule-strong"
            />
            <p className="mt-1 text-[0.75rem] text-ink-faint">
              {tooShort
                ? `${Math.max(0, MIN_JD_LENGTH - draft.trim().length)} more characters needed.`
                : `${draft.trim().length.toLocaleString()} characters.`}
            </p>
          </section>
        )}

        {comparison && (
          <>
            <ScoreRow score={comparison.matchScore} />

            {aiError && (
              <div role="status" className="rounded-lg bg-accent-wash px-3 py-2">
                <p className="text-[0.8125rem] text-accent">
                  The keyword match ran, but the written suggestions didn&rsquo;t.
                </p>
                <p className="mt-1 text-[0.75rem] text-ink-muted">{aiError}</p>
              </div>
            )}

            <SuggestionList
              suggestions={comparison.suggestions}
              applying={applying}
              applied={applied}
              onApply={(suggestion) => void apply(suggestion)}
              onFocusSection={onFocusSection}
            />

            <KeywordColumn
              title="Missing"
              hint="Sorted by how much the posting leans on them."
              keywords={comparison.missingKeywords}
              tone="missing"
            />

            <KeywordColumn
              title="Matched"
              hint="Found in your resume, with where."
              keywords={comparison.matchedKeywords}
              tone="matched"
            />
          </>
        )}

        {!loading && !comparison && <EmptyState />}

        {past.length > 1 && (
          <PastComparisons
            comparisons={past}
            activeId={comparison?.id ?? null}
            onOpen={(id) => {
              const controller = new AbortController();
              aborter.current = controller;
              void api
                .jdComparison(resumeId, id, controller.signal)
                .then(({ comparison: full }) => {
                  setComparison(full);
                  setDraft(full.jobDescriptionText);
                  setApplied({});
                  setAiError(null);
                })
                .catch(() => setError("Could not open that comparison."));
            }}
          />
        )}
      </div>

      <div className="border-t border-rule p-3">
        <Button
          size="sm"
          className="w-full"
          onClick={() => void compare()}
          disabled={comparing || loading || tooShort}
        >
          {comparing ? "Comparing…" : comparison ? "Compare again" : "Compare"}
        </Button>
        <AllowanceMeter className="mt-2 text-center" />
      </div>
    </aside>
  );
}

// --- Score ---

function ScoreRow({ score }: { score: number }) {
  return (
    <section>
      <div className="flex items-baseline justify-between">
        <FieldLabel>Match</FieldLabel>
        <span className={`font-display text-2xl tabular-nums tracking-tight ${scoreTone(score)}`}>
          {score}
          <span className="ml-0.5 font-mono text-[0.6875rem] text-ink-faint">/100</span>
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-paper-sunken">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="h-full rounded-full bg-accent"
        />
      </div>
      <p className="mt-1.5 text-[0.75rem] leading-snug text-ink-faint">
        The share of what this posting asks for, weighted by how much it asks —
        not the share of its words.
      </p>
    </section>
  );
}

// --- Suggestions ---

function SuggestionList({
  suggestions,
  applying,
  applied,
  onApply,
  onFocusSection,
}: {
  suggestions: JdSuggestion[];
  applying: string | null;
  applied: Record<string, string>;
  onApply: (suggestion: JdSuggestion) => void;
  onFocusSection: (sectionId: string) => void;
}) {
  if (suggestions.length === 0) {
    return (
      <p className="rounded-lg bg-positive-wash px-3 py-2 text-sm text-positive">
        Nothing to close. This resume already names what the posting asks for.
      </p>
    );
  }

  return (
    <section>
      <FieldLabel>Close the gaps</FieldLabel>
      <ul className="mt-3 space-y-2">
        {suggestions.map((suggestion) => (
          <SuggestionRow
            key={suggestion.id}
            suggestion={suggestion}
            busy={applying === suggestion.id}
            disabled={applying !== null && applying !== suggestion.id}
            result={applied[suggestion.id]}
            onApply={() => onApply(suggestion)}
            onFocusSection={onFocusSection}
          />
        ))}
      </ul>
    </section>
  );
}

function SuggestionRow({
  suggestion,
  busy,
  disabled,
  result,
  onApply,
  onFocusSection,
}: {
  suggestion: JdSuggestion;
  busy: boolean;
  disabled: boolean;
  result: string | undefined;
  onApply: () => void;
  onFocusSection: (sectionId: string) => void;
}) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="rounded-lg px-3 py-2 ring-1 ring-inset ring-rule"
    >
      <p className="text-[0.8125rem] leading-snug text-ink">{suggestion.message}</p>

      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={onApply}
          disabled={busy || disabled}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent-wash px-2 py-1 font-mono text-[0.625rem] uppercase tracking-[0.12em] text-accent transition-opacity hover:opacity-80 disabled:pointer-events-none disabled:opacity-40"
        >
          {busy ? (
            <motion.span
              aria-hidden
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
              className="h-1.5 w-1.5 rounded-full bg-accent"
            />
          ) : (
            <SparkIcon />
          )}
          {busy ? "Applying" : "Apply with AI"}
        </button>

        {suggestion.sectionRef && (
          <button
            type="button"
            onClick={() => onFocusSection(suggestion.sectionRef!)}
            className="font-mono text-[0.625rem] uppercase tracking-[0.12em] text-ink-faint underline underline-offset-2 transition-colors hover:text-ink"
          >
            Show me
          </button>
        )}
      </div>

      {result && (
        <p
          role="status"
          className={`mt-1.5 font-mono text-[0.625rem] uppercase tracking-[0.12em] ${
            result.startsWith("Applied") ? "text-positive" : "text-ink-faint"
          }`}
        >
          {result}
        </p>
      )}
    </motion.li>
  );
}

// --- Keyword columns ---

function KeywordColumn({
  title,
  hint,
  keywords,
  tone,
}: {
  title: string;
  hint: string;
  keywords: JdKeyword[];
  tone: "matched" | "missing";
}) {
  if (keywords.length === 0) return null;

  return (
    <section>
      <div className="flex items-baseline justify-between">
        <FieldLabel>{title}</FieldLabel>
        <span className="font-mono text-[0.625rem] tabular-nums text-ink-faint">
          {keywords.length}
        </span>
      </div>
      <p className="mt-1 text-[0.75rem] text-ink-faint">{hint}</p>
      <ul className="mt-2 flex flex-wrap gap-1">
        {keywords.map((keyword) => (
          <li key={keyword.term}>
            <span
              // The evidence is the whole reason a match is arguable rather than
              // a number to take on faith.
              title={
                keyword.evidence
                  ? `Found in ${keyword.evidence}`
                  : `Weight ${keyword.weight} in the posting`
              }
              className={`inline-block rounded-full px-2 py-0.5 text-[0.75rem] ${
                tone === "matched"
                  ? "bg-positive-wash text-positive"
                  : "bg-paper-sunken text-ink-muted ring-1 ring-inset ring-rule"
              }`}
            >
              {keyword.term}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// --- History, empty and loading states ---

function PastComparisons({
  comparisons,
  activeId,
  onOpen,
}: {
  comparisons: JdComparisonSummary[];
  activeId: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <section>
      <FieldLabel>Earlier postings</FieldLabel>
      <ul className="mt-2 space-y-0.5">
        {comparisons.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              onClick={() => onOpen(entry.id)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[0.8125rem] transition-colors ${
                entry.id === activeId
                  ? "bg-accent-wash text-accent"
                  : "text-ink-muted hover:bg-paper-sunken hover:text-ink"
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{entry.excerpt || "Untitled posting"}</span>
              <span className="shrink-0 font-mono text-[0.625rem] tabular-nums">
                {entry.matchScore}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="px-1 py-4">
      <p className="font-display text-lg tracking-tight">Match this resume to a posting</p>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        Paste a job description and this pulls out what it actually asks for,
        weighted by how hard it asks, then checks each one against your resume.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-ink-muted">
        Gaps come back as suggestions anchored to a section. Apply one and the
        assistant makes the edit on the canvas &mdash; undoable in a single step,
        like anything else you change here.
      </p>
    </div>
  );
}

function LoadingLines() {
  return (
    <div className="space-y-3" aria-hidden>
      {[0, 1, 2, 3].map((index) => (
        <motion.div
          key={index}
          animate={{ opacity: [0.3, 0.7, 0.3] }}
          transition={{ duration: 1.4, repeat: Infinity, delay: index * 0.12, ease: "easeInOut" }}
          className="h-3 rounded bg-paper-sunken"
          style={{ width: `${88 - index * 12}%` }}
        />
      ))}
    </div>
  );
}

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

function CloseIcon() {
  return (
    <svg {...svg}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg {...svg} width={12} height={12}>
      <path d="M12 3l1.7 4.8L18.5 9.5 13.7 11.2 12 16l-1.7-4.8L5.5 9.5l4.8-1.7L12 3Z" />
    </svg>
  );
}
