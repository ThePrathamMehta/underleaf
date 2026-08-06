"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import type { ProfessionDto } from "@repo/types";
import { ProfessionIcon } from "@repo/ui/profession-icon";
import { api } from "../../lib/api";
import { SiteHeader } from "../../components/site-header";

/**
 * The one-question step between "Create your resume" and the gallery.
 *
 * Deliberately its own route rather than a modal over `/templates`: it needs to
 * be linkable from the landing page and the dashboard, survive a refresh, and
 * leave the back button meaning "undo my answer".
 *
 * Answering navigates to the pre-filtered gallery. Skipping navigates to the
 * same gallery unfiltered — the step narrows a starting point, it never gates
 * one, so nothing here can strand a user who doesn't see their profession.
 */
export default function StartPage() {
  const [professions, setProfessions] = useState<ProfessionDto[] | null>(null);

  useEffect(() => {
    api
      .professions()
      .then(({ professions: list }) => setProfessions(list))
      .catch(() => setProfessions([]));
  }, []);

  return (
    <>
      <SiteHeader />

      <main className="mx-auto max-w-5xl px-6 py-14 lg:py-20">
        <header className="max-w-[52ch]">
          <p className="mb-4 font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-ink-faint">
            Step 1 of 2
          </p>
          <h1 className="font-display text-[clamp(2rem,4.5vw,3rem)] leading-[1.05] tracking-tightest text-balance">
            What kind of work is this for?
          </h1>
          <p className="mt-5 leading-relaxed text-ink-muted text-pretty">
            We&rsquo;ll put the formats that read best in your field first. You can
            change it, or ignore it entirely, on the next screen.
          </p>
        </header>

        {professions === null && (
          <div className="mt-12 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                className="h-[7.25rem] animate-pulse rounded-xl bg-paper-raised ring-1 ring-inset ring-rule"
              />
            ))}
          </div>
        )}

        {professions !== null && professions.length > 0 && (
          <div className="mt-12 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {professions.map((profession, i) => (
              <motion.div
                key={profession.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.35,
                  // Capped so the last card in a nine-card grid isn't a third of
                  // a second behind the first.
                  delay: Math.min(i * 0.03, 0.18),
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <Link
                  href={`/templates?profession=${encodeURIComponent(profession.slug)}`}
                  className="group flex h-full flex-col rounded-xl bg-paper-raised p-5 text-left ring-1 ring-inset ring-rule transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card hover:ring-rule-strong"
                >
                  <span className="text-ink-faint transition-colors duration-200 group-hover:text-accent">
                    <ProfessionIcon iconKey={profession.iconKey} size={22} />
                  </span>
                  <span className="mt-3 font-medium">{profession.name}</span>
                  <span className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-muted text-pretty">
                    {profession.description}
                  </span>
                </Link>
              </motion.div>
            ))}
          </div>
        )}

        {/* Always rendered, including when the professions fetch fails — this is
            the escape hatch, so it can't depend on the thing it escapes from. */}
        <div className="mt-10 border-t border-rule pt-6">
          <Link
            href="/templates"
            className="group inline-flex items-center gap-1.5 text-sm text-ink-muted transition-colors hover:text-ink"
          >
            Browse all templates instead
            <span className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
          </Link>
        </div>
      </main>
    </>
  );
}
