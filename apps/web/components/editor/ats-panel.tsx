"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { AiUsageDto } from "@repo/types";
import {
  ATS_CATEGORIES,
  ATS_CATEGORY_BLURBS,
  ATS_CATEGORY_LABELS,
  type AtsCategory,
  type AtsHistoryEntry,
  type AtsIssue,
  type AtsScoreResultDto,
  type AtsSeverity,
} from "@repo/types";
import { api, ApiError } from "../../lib/api";
import { useUsage } from "../../lib/usage";
import { AllowanceMeter, AllowanceWall } from "../allowance";
import { Button } from "../button";
import { FieldLabel, IconButton } from "./controls";

/**
 * The ATS panel.
 *
 * Scoring is an explicit action, never a side effect of typing: it costs a
 * provider call, and a number that moves while you're mid-sentence teaches you
 * nothing. So the panel opens showing the last run — or an empty state if there
 * has never been one — and only re-scores when asked.
 *
 * Two things it refuses to hide. When the AI half fails the score still appears,
 * labelled as the deterministic checks alone with the specific reason attached,
 * because a 78 from six checks and a 78 from ten checks are different claims.
 * And every issue that names a section is a button that scrolls the canvas to it,
 * so "fix this" always has somewhere to go.
 */

const SEVERITY_LABELS: Record<AtsSeverity, string> = {
  critical: "Critical",
  warning: "Worth fixing",
  suggestion: "Nice to have",
};

/** Severity → token. There's no amber token, so warning borrows the accent. */
const SEVERITY_TONE: Record<AtsSeverity, { dot: string; text: string }> = {
  critical: { dot: "bg-danger", text: "text-danger" },
  warning: { dot: "bg-accent", text: "text-accent" },
  suggestion: { dot: "bg-ink-faint", text: "text-ink-faint" },
};

function scoreTone(score: number): string {
  if (score >= 80) return "text-positive";
  if (score >= 60) return "text-accent";
  return "text-danger";
}

function scoreStroke(score: number): string {
  if (score >= 80) return "var(--positive)";
  if (score >= 60) return "var(--accent)";
  return "var(--danger)";
}

/** "just now" / "6 min ago" / a date once it stops being about this session. */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) {
    const hours = Math.round(minutes / 60);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function AtsPanel({
  resumeId,
  onClose,
  onBeforeCheck,
  onFocusSection,
}: {
  resumeId: string;
  onClose: () => void;
  /** Flushes autosave — the server scores the *saved* document. */
  onBeforeCheck: () => Promise<void>;
  onFocusSection: (sectionId: string) => void;
}) {
  const [result, setResult] = useState<AtsScoreResultDto | null>(null);
  const [history, setHistory] = useState<AtsHistoryEntry[]>([]);
  const [aiError, setAiError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when the AI review was refused for want of allowance. */
  const [blocked, setBlocked] = useState<AiUsageDto | null>(null);
  const { applyUsage } = useUsage();

  const aborter = useRef<AbortController | null>(null);

  // Loads the last run and the trend together: either the panel opens with a
  // whole picture or it opens empty, never with a score and a blank chart.
  useEffect(() => {
    const controller = new AbortController();

    Promise.all([
      api.latestAtsScore(resumeId, controller.signal),
      api.atsHistory(resumeId, controller.signal),
    ])
      .then(([latest, past]) => {
        if (latest?.result) setResult(latest.result);
        setHistory(past.history);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof ApiError ? caught.message : "Could not load your last score.");
        setLoading(false);
      });

    return () => controller.abort();
  }, [resumeId]);

  // A check in flight when the panel closes is abandoned with it.
  useEffect(() => () => aborter.current?.abort(), []);

  const check = useCallback(async () => {
    if (checking) return;

    setChecking(true);
    setError(null);
    setBlocked(null);

    try {
      await onBeforeCheck();
    } catch {
      // Non-fatal: the server falls back to the last saved document, the same
      // guarantee export and the assistant already make.
    }

    const controller = new AbortController();
    aborter.current = controller;

    try {
      const response = await api.scoreAts(resumeId, controller.signal);
      setResult(response.result);
      setAiError(response.aiError);
      // Present whether or not the AI half ran: the route refunds the action
      // when it didn't, and this is the refunded number.
      applyUsage(response.usage);
      setHistory((current) => [
        ...current,
        {
          id: response.result.id,
          overallScore: response.result.overallScore,
          createdAt: response.result.createdAt,
        },
      ]);
    } catch (caught: unknown) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;

      // The deterministic checks would have run for free, but the route meters
      // before it scores at all, so an exhausted allowance means no score came
      // back. Say that inline rather than as a failure.
      if (caught instanceof ApiError && caught.isAllowanceExhausted && caught.usage) {
        applyUsage(caught.usage);
        setBlocked(caught.usage);
        return;
      }

      setError(
        caught instanceof ApiError ? caught.message : "The check couldn't finish. Try again.",
      );
    } finally {
      aborter.current = null;
      setChecking(false);
    }
  }, [applyUsage, checking, onBeforeCheck, resumeId]);

  const previous = history.length > 1 ? history[history.length - 2] : undefined;
  const delta = result && previous ? result.overallScore - previous.overallScore : null;

  return (
    <aside
      className="fixed inset-0 z-40 flex flex-col bg-paper md:relative md:inset-auto md:z-auto md:w-[22rem] md:shrink-0 md:border-l md:border-rule"
      aria-label="ATS score"
    >
      <div className="flex h-12 items-center justify-between border-b border-rule px-4">
        <FieldLabel>ATS score</FieldLabel>
        <IconButton label="Close ATS panel" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {loading && <LoadingLines />}

        {error && (
          <p role="alert" className="mb-4 rounded-lg bg-danger-wash px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        {blocked && <AllowanceWall usage={blocked} className="mb-4" />}

        {!loading && !result && <EmptyState checking={checking} />}

        {result && (
          <div className="space-y-6">
            <Gauge score={result.overallScore} delta={delta} checkedAt={result.createdAt} />

            {!result.aiAssisted && (
              <PartialNotice reason={aiError} />
            )}

            <Trend history={history} />

            <section>
              <FieldLabel>Breakdown</FieldLabel>
              <div className="mt-3 space-y-3">
                {ATS_CATEGORIES.map((category) => (
                  <CategoryBar
                    key={category}
                    category={category}
                    value={result.categoryScores[category]}
                  />
                ))}
              </div>
            </section>

            <IssueList issues={result.issues} onFocusSection={onFocusSection} />
          </div>
        )}
      </div>

      <div className="border-t border-rule p-3">
        <Button
          size="sm"
          className="w-full"
          onClick={() => void check()}
          disabled={checking || loading}
        >
          {checking ? "Checking…" : result ? "Check again" : "Check my score"}
        </Button>
        <p className="mt-2 text-center text-[0.75rem] text-ink-faint">
          {checking
            ? "Reading your resume the way a scanner would."
            : "Runs on demand — never while you type."}
        </p>
        <AllowanceMeter className="mt-2 text-center" />
      </div>
    </aside>
  );
}

// --- Score display ---

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function Gauge({
  score,
  delta,
  checkedAt,
}: {
  score: number;
  delta: number | null;
  checkedAt: string;
}) {
  return (
    <div className="flex flex-col items-center">
      <div className="relative h-[7.5rem] w-[7.5rem]">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            stroke="var(--rule)"
            strokeWidth="7"
          />
          <motion.circle
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            stroke={scoreStroke(score)}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            initial={{ strokeDashoffset: CIRCUMFERENCE }}
            animate={{ strokeDashoffset: CIRCUMFERENCE * (1 - score / 100) }}
            transition={{ duration: 0.7, ease: "easeOut" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`font-display text-3xl tabular-nums tracking-tight ${scoreTone(score)}`}>
            {score}
          </span>
          <span className="font-mono text-[0.625rem] uppercase tracking-[0.14em] text-ink-faint">
            out of 100
          </span>
        </div>
      </div>

      <p className="mt-2 flex items-center gap-2 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-ink-faint">
        <span>Checked {timeAgo(checkedAt)}</span>
        {delta !== null && delta !== 0 && (
          <span className={delta > 0 ? "text-positive" : "text-danger"}>
            {delta > 0 ? "+" : ""}
            {delta}
          </span>
        )}
      </p>
    </div>
  );
}

/**
 * Shown when the provider half didn't run.
 *
 * It names the reason rather than saying the check failed, because the two
 * halves fail for different reasons and only one of them is worth retrying.
 */
function PartialNotice({ reason }: { reason: string | null }) {
  return (
    <div role="status" className="rounded-lg bg-accent-wash px-3 py-2">
      <p className="text-[0.8125rem] text-accent">
        This score is the automated checks only — the writing review didn&rsquo;t run.
      </p>
      {reason && <p className="mt-1 text-[0.75rem] text-ink-muted">{reason}</p>}
    </div>
  );
}

function CategoryBar({ category, value }: { category: AtsCategory; value: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[0.8125rem] text-ink" title={ATS_CATEGORY_BLURBS[category]}>
          {ATS_CATEGORY_LABELS[category]}
        </span>
        <span className={`font-mono text-[0.6875rem] tabular-nums ${scoreTone(value)}`}>
          {value}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-paper-sunken">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="h-full rounded-full"
          style={{ background: scoreStroke(value) }}
        />
      </div>
      <p className="mt-1 text-[0.75rem] leading-snug text-ink-faint">
        {ATS_CATEGORY_BLURBS[category]}
      </p>
    </div>
  );
}

/**
 * Score over time.
 *
 * The spec asks for history rather than a single latest number precisely so
 * improvement is visible — a lone 71 says nothing about whether the last twenty
 * minutes of editing helped.
 */
function Trend({ history }: { history: AtsHistoryEntry[] }) {
  if (history.length < 2) return null;

  const points = history.slice(-12);
  const width = 100;
  const height = 28;
  const step = points.length > 1 ? width / (points.length - 1) : 0;

  const path = points
    .map((entry, index) => {
      const x = index * step;
      const y = height - (entry.overallScore / 100) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  const first = points[0]!.overallScore;
  const last = points[points.length - 1]!.overallScore;

  return (
    <section>
      <div className="flex items-baseline justify-between">
        <FieldLabel>Since you started</FieldLabel>
        <span
          className={`font-mono text-[0.6875rem] tabular-nums ${
            last >= first ? "text-positive" : "text-danger"
          }`}
        >
          {last > first ? "+" : ""}
          {last - first}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Score over the last ${points.length} checks, ${first} to ${last}`}
        className="mt-2 h-8 w-full"
      >
        <path
          d={path}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </section>
  );
}

// --- Issues ---

function IssueList({
  issues,
  onFocusSection,
}: {
  issues: AtsIssue[];
  onFocusSection: (sectionId: string) => void;
}) {
  if (issues.length === 0) {
    return (
      <p className="rounded-lg bg-positive-wash px-3 py-2 text-sm text-positive">
        Nothing flagged. Every check this resume can fail, it passed.
      </p>
    );
  }

  return (
    <section>
      <div className="flex items-baseline justify-between">
        <FieldLabel>What to fix</FieldLabel>
        <span className="font-mono text-[0.625rem] tabular-nums text-ink-faint">
          {issues.length}
        </span>
      </div>
      {/* Already sorted critical-first by the API, so the order the user reads is
          the order worth working in. */}
      <ul className="mt-3 space-y-2">
        {issues.map((issue) => (
          <IssueRow key={issue.id} issue={issue} onFocusSection={onFocusSection} />
        ))}
      </ul>
    </section>
  );
}

function IssueRow({
  issue,
  onFocusSection,
}: {
  issue: AtsIssue;
  onFocusSection: (sectionId: string) => void;
}) {
  const tone = SEVERITY_TONE[issue.severity];

  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="rounded-lg px-3 py-2 ring-1 ring-inset ring-rule"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
        <span className={`font-mono text-[0.625rem] uppercase tracking-[0.12em] ${tone.text}`}>
          {SEVERITY_LABELS[issue.severity]}
        </span>
        <span className="ml-auto font-mono text-[0.625rem] uppercase tracking-[0.12em] text-ink-faint">
          {ATS_CATEGORY_LABELS[issue.category]}
        </span>
      </div>

      <p className="mt-1.5 text-[0.8125rem] leading-snug text-ink">{issue.message}</p>
      {/* The fix is the point of the row. An issue without one is a complaint,
          which is why the schema requires it. */}
      <p className="mt-1 text-[0.8125rem] leading-snug text-ink-muted">{issue.fix}</p>

      {issue.sectionRef && (
        <button
          type="button"
          onClick={() => onFocusSection(issue.sectionRef!)}
          className="mt-1.5 font-mono text-[0.625rem] uppercase tracking-[0.12em] text-accent underline underline-offset-2 transition-opacity hover:opacity-70"
        >
          Show me
        </button>
      )}
    </motion.li>
  );
}

// --- Empty and loading states ---

function EmptyState({ checking }: { checking: boolean }) {
  return (
    <div className="px-1 py-6">
      <p className="font-display text-lg tracking-tight">
        {checking ? "Reading your resume…" : "See how a scanner reads this"}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        Most applications pass through an applicant tracking system before a person
        sees them. This checks the things that trip one up — unparseable contact
        details, headings it won&rsquo;t recognize, dates in two formats — and the
        things a recruiter notices after: whether your bullets describe outcomes or
        duties.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-ink-muted">
        Nothing runs until you ask.
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
