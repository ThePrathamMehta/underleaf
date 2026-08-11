import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "../components/button";
import { SiteHeader } from "../components/site-header";

export const metadata: Metadata = {
  title: "Page not found — Underleaf",
  description: "That page isn't here. Head back home or pick up where you left off.",
};

/**
 * Mirrors the landing hero's asymmetric two-column layout rather than the
 * usual centered-stack 404, so a wrong URL still lands somewhere that looks
 * like the rest of the app. Kept a server component: it needs no state, and an
 * error page is the last place worth shipping a motion library to.
 */
export default function NotFound() {
  return (
    <>
      <SiteHeader />

      <main className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 paper-lines opacity-[0.55]"
          aria-hidden
        />

        <div className="relative mx-auto grid min-h-[calc(100dvh-4rem)] max-w-6xl items-center gap-16 px-6 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12 lg:py-20">
          <div>
            <p className="mb-6 font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-ink-faint">
              Error 404 · Page not found
            </p>

            <h1 className="max-w-[19ch] font-display text-[clamp(2.5rem,6.5vw,4.25rem)] leading-[0.98] tracking-tightest text-balance">
              This page isn&apos;t in the <em className="italic text-accent">document</em>.
            </h1>

            <p className="mt-7 max-w-[46ch] text-[1.0625rem] leading-relaxed text-ink-muted text-pretty">
              The link may be out of date, or the résumé it pointed at was renamed or deleted.
              Nothing you&apos;ve saved is affected.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-3">
              <ButtonLink href="/" size="lg">
                Back to home
              </ButtonLink>
              <Link
                href="/dashboard"
                className="group inline-flex h-12 items-center gap-1.5 px-2 text-sm text-ink-muted transition-colors hover:text-ink"
              >
                Go to your résumés
                <span className="transition-transform duration-200 group-hover:translate-x-0.5">
                  →
                </span>
              </Link>
            </div>
          </div>

          <MissingPage />
        </div>
      </main>
    </>
  );
}

/**
 * A résumé sheet with its content missing — the literal reading of "page not
 * found", which is a better fit here than a broken-robot illustration. The
 * skeleton rules fade down the page so the eye reads them as absent content
 * rather than as something still loading.
 */
function MissingPage() {
  const lines = [
    { width: "72%", opacity: 0.5 },
    { width: "88%", opacity: 0.38 },
    { width: "61%", opacity: 0.28 },
    { width: "80%", opacity: 0.18 },
    { width: "44%", opacity: 0.1 },
  ];

  return (
    <div className="relative mx-auto w-full max-w-[20rem] lg:max-w-[23rem]" aria-hidden>
      {/* A second sheet behind it, so the stack reads as a document rather than a single card. */}
      <div className="absolute inset-0 -rotate-[3deg] rounded-sm bg-paper-raised shadow-lift ring-1 ring-rule" />

      <div className="relative aspect-[1/1.294] rotate-[1.5deg] rounded-sm bg-paper-raised p-8 shadow-lift ring-1 ring-rule">
        <p className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-ink-faint">
          Page
        </p>

        <p className="mt-1 font-display text-[clamp(3.5rem,11vw,5rem)] leading-none tracking-tightest">
          404
        </p>

        <div className="mt-2 h-px w-16 bg-rule-strong" />

        <div className="mt-8 space-y-3.5">
          {lines.map((line) => (
            <div
              key={line.width + line.opacity}
              className="h-2 rounded-full bg-ink"
              style={{ width: line.width, opacity: line.opacity }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
