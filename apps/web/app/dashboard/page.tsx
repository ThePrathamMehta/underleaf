"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import type { ResumeWithTemplateDto } from "@repo/types";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { Button, ButtonLink } from "../../components/button";
import { SiteHeader } from "../../components/site-header";
import { ResumeThumbnail } from "../../components/resume-thumbnail";

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [resumes, setResumes] = useState<ResumeWithTemplateDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login?next=/dashboard");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!user) return;

    api
      .resumes()
      .then(({ resumes: list }) => setResumes(list))
      .catch((caught) =>
        setError(caught instanceof ApiError ? caught.message : "Could not load your resumes."),
      );
  }, [user]);

  async function duplicate(id: string) {
    setBusyId(id);
    try {
      const { resume } = await api.duplicateResume(id);
      setResumes((current) => (current ? [resume, ...current] : [resume]));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not duplicate that resume.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    try {
      await api.deleteResume(id);
      setResumes((current) => current?.filter((r) => r.id !== id) ?? null);
      setConfirmDeleteId(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not delete that resume.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-6 py-14">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-3 font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-ink-faint">
              {user ? user.name : " "}
            </p>
            <h1 className="font-display text-[clamp(2rem,4vw,2.75rem)] leading-[1.05] tracking-tightest">
              Your resumes
            </h1>
          </div>

          <ButtonLink href="/start" size="md">
            New resume
          </ButtonLink>
        </header>

        {error && (
          <p
            role="alert"
            className="mt-8 rounded-lg bg-danger-wash px-4 py-3 text-sm text-danger ring-1 ring-inset ring-danger/15"
          >
            {error}
          </p>
        )}

        {resumes === null && !error && <SkeletonGrid />}

        {resumes !== null && resumes.length === 0 && <EmptyState />}

        {resumes !== null && resumes.length > 0 && (
          <motion.div layout className="mt-10 grid gap-x-7 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            <AnimatePresence mode="popLayout">
              {resumes.map((resume, index) => (
                <motion.article
                  key={resume.id}
                  layout
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{
                    duration: 0.4,
                    delay: Math.min(index * 0.05, 0.25),
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className="group relative"
                >
                  <Link
                    href={`/editor/${resume.id}`}
                    className="block overflow-hidden rounded-lg ring-1 ring-rule transition-all duration-300 group-hover:shadow-lift group-hover:ring-rule-strong"
                  >
                    <ResumeThumbnail
                      templateSlug={resume.template.slug}
                      content={resume.content}
                      theme={resume.theme}
                      className="transition-transform duration-500 ease-out group-hover:scale-[1.015]"
                    />
                  </Link>

                  <div className="mt-3.5 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/editor/${resume.id}`}
                        className="block truncate font-display text-lg tracking-tight transition-colors hover:text-accent"
                      >
                        {resume.title}
                      </Link>
                      <p className="mt-0.5 text-[0.8125rem] text-ink-faint">
                        {resume.template.name} · edited {relativeTime(resume.updatedAt)}
                      </p>
                    </div>

                    <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100">
                      <RowAction
                        label="Duplicate"
                        disabled={busyId === resume.id}
                        onClick={() => void duplicate(resume.id)}
                      >
                        <CopyIcon />
                      </RowAction>
                      <RowAction
                        label="Delete"
                        danger
                        disabled={busyId === resume.id}
                        onClick={() => setConfirmDeleteId(resume.id)}
                      >
                        <TrashIcon />
                      </RowAction>
                    </div>
                  </div>

                  <AnimatePresence>
                    {confirmDeleteId === resume.id && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-lg bg-paper/95 p-6 text-center backdrop-blur-sm"
                      >
                        <p className="max-w-[26ch] text-sm text-ink-muted">
                          Delete <span className="text-ink">{resume.title}</span>? This can&rsquo;t be
                          undone.
                        </p>
                        <div className="flex gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Cancel
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={busyId === resume.id}
                            onClick={() => void remove(resume.id)}
                          >
                            {busyId === resume.id ? "Deleting…" : "Delete"}
                          </Button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.article>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </main>
    </>
  );
}

function RowAction({
  label,
  danger = false,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; danger?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition-colors disabled:opacity-40 ${
        danger ? "hover:bg-danger-wash hover:text-danger" : "hover:bg-paper-sunken hover:text-ink"
      }`}
      {...props}
    >
      {children}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="mt-16 flex flex-col items-center gap-6 text-center">
      {/* A blank sheet with ruled lines, rather than an icon in a circle. */}
      <div
        aria-hidden
        className="relative h-40 w-[7.75rem] rounded-sm bg-white shadow-page ring-1 ring-black/5"
      >
        <div className="absolute inset-x-5 top-7 space-y-2.5">
          <div className="h-1.5 w-2/3 rounded-full bg-paper-sunken" />
          <div className="h-1 w-full rounded-full bg-paper-sunken/70" />
          <div className="h-1 w-full rounded-full bg-paper-sunken/70" />
          <div className="h-1 w-3/4 rounded-full bg-paper-sunken/70" />
        </div>
      </div>

      <div className="max-w-[40ch]">
        <h2 className="font-display text-xl tracking-tight">Nothing here yet</h2>
        <p className="mt-1.5 text-ink-muted text-pretty">
          Pick a template and you&rsquo;ll have something editable in a couple of seconds.
        </p>
      </div>

      <ButtonLink href="/templates" size="md">
        Browse templates
      </ButtonLink>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="mt-10 grid gap-x-7 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="animate-pulse">
          <div
            className="rounded-lg bg-paper-sunken ring-1 ring-rule"
            style={{ aspectRatio: "215.9 / 279.4" }}
          />
          <div className="mt-3.5 h-5 w-1/2 rounded bg-paper-sunken" />
          <div className="mt-2 h-3.5 w-2/3 rounded bg-paper-sunken" />
        </div>
      ))}
    </div>
  );
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000_000],
  ["month", 2_592_000_000],
  ["week", 604_800_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

function relativeTime(iso: string): string {
  const elapsed = Date.now() - new Date(iso).getTime();
  if (elapsed < 60_000) return "just now";

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, ms] of UNITS) {
    if (elapsed >= ms) return formatter.format(-Math.round(elapsed / ms), unit);
  }
  return "just now";
}

const svg = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function CopyIcon() {
  return (
    <svg {...svg}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h8" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg {...svg}>
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
    </svg>
  );
}
