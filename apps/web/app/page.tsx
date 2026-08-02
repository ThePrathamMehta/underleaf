'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { ButtonLink } from '../components/button';
import { Logo } from '../components/logo';
import { SiteHeader } from '../components/site-header';

const RISE = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
};

export default function LandingPage() {
  return (
    <>
      <SiteHeader />

      <main>
        {/* Hero — asymmetric two-column, not a centered stack. */}
        <section className="relative overflow-hidden border-b border-rule">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.55] paper-lines"
            aria-hidden
          />

          <div className="relative mx-auto grid max-w-6xl gap-16 px-6 pb-24 pt-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-12 lg:pb-28 lg:pt-24">
            <div>
              <motion.p
                {...RISE}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="mb-6 font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-ink-faint"
              >
                Résumé builder · No LaTeX, no code
              </motion.p>

              <motion.h1
                {...RISE}
                transition={{ duration: 0.6, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
                className="max-w-[19ch] font-display text-[clamp(2.75rem,7vw,4.75rem)] leading-[0.98] tracking-tightest text-balance"
              >
                Résumés that look <em className="text-accent not-italic italic">considered</em>.
              </motion.h1>

              <motion.p
                {...RISE}
                transition={{ duration: 0.6, delay: 0.14, ease: [0.22, 1, 0.36, 1] }}
                className="mt-7 max-w-[46ch] text-[1.0625rem] leading-relaxed text-ink-muted text-pretty"
              >
                Start from a properly typeset template — the same formats that get read at Google,
                Stripe and Jane Street. Edit it like a document. Export a PDF that matches the
                screen exactly.
              </motion.p>

              <motion.div
                {...RISE}
                transition={{ duration: 0.6, delay: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="mt-10 flex flex-wrap items-center gap-3"
              >
                <ButtonLink href="/templates" size="lg">
                  Create your resume
                </ButtonLink>
                <Link
                  href="/templates"
                  className="group inline-flex h-12 items-center gap-1.5 px-2 text-sm text-ink-muted transition-colors hover:text-ink"
                >
                  Browse the five templates
                  <span className="transition-transform duration-200 group-hover:translate-x-0.5">
                    →
                  </span>
                </Link>
              </motion.div>

              <motion.p
                {...RISE}
                transition={{ duration: 0.6, delay: 0.3 }}
                className="mt-8 text-[0.8125rem] text-ink-faint"
              >
                Free while in beta. No card, no watermark on your PDF.
              </motion.p>
            </div>

            {/* A miniature of the real thing, built from the same type scale. */}
            <motion.div
              initial={{ opacity: 0, y: 24, rotate: -1.2 }}
              animate={{ opacity: 1, y: 0, rotate: -1.2 }}
              transition={{ duration: 0.8, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="relative mx-auto w-full max-w-[26rem] lg:max-w-none"
            >
              <PaperPreview />
            </motion.div>
          </div>
        </section>

        {/* The problem, stated plainly — an editorial pull-quote, not feature cards. */}
        <section className="border-b border-rule bg-paper-raised">
          <div className="mx-auto max-w-6xl px-6 py-20 lg:py-24">
            <div className="grid gap-12 lg:grid-cols-[0.4fr_0.6fr] lg:gap-20">
              <h2 className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-ink-faint">
                Why it exists
              </h2>
              <div>
                <p className="max-w-[52ch] font-display text-[clamp(1.5rem,3vw,2.125rem)] leading-[1.25] tracking-tight text-balance">
                  The best-looking resumes are LaTeX templates. Editing them means fighting a
                  compiler over a misplaced ampersand.
                </p>
                <p className="mt-7 max-w-[54ch] leading-relaxed text-ink-muted text-pretty">
                  Underleaf keeps the typography and throws away the toolchain. Every template here
                  is rebuilt as real HTML and CSS, driven by structured data — so you get the layout
                  discipline of a typeset document with the directness of editing a Word file.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Numbered editorial list rather than three icon cards. */}
        <section className="border-b border-rule">
          <div className="mx-auto max-w-6xl px-6 py-20 lg:py-24">
            <h2 className="mb-14 font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-ink-faint">
              How it works
            </h2>

            <ol className="grid gap-x-12 gap-y-12 md:grid-cols-3">
              {[
                {
                  n: '01',
                  title: 'Pick a format',
                  body: 'Five templates, each modelled on a resume format that recruiters already recognise — from the dense single-column engineering standard to a two-column sidebar.',
                },
                {
                  n: '02',
                  title: 'Edit on the page',
                  body: 'Click any line and type. Drag sections to reorder them. Change the typeface, spacing and accent colour and watch the page reflow underneath you.',
                },
                {
                  n: '03',
                  title: 'Export the PDF',
                  body: 'The exporter renders the exact component you were editing, at print resolution with embedded fonts. What you saw is what lands in the file.',
                },
              ].map((step, i) => (
                <motion.li
                  key={step.n}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-80px' }}
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

        {/* Closing CTA */}
        <section className="bg-paper-raised">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-8 px-6 py-20 md:flex-row md:items-center md:justify-between lg:py-24">
            <div>
              <h2 className="max-w-[24ch] font-display text-[clamp(1.75rem,4vw,2.75rem)] leading-[1.1] tracking-tight text-balance">
                Your next resume is twenty minutes away.
              </h2>
              <p className="mt-4 max-w-[44ch] text-ink-muted text-pretty">
                Start from a template, keep what fits, cut what doesn&rsquo;t.
              </p>
            </div>
            <ButtonLink href="/templates" size="lg" className="shrink-0">
              Create your resume
            </ButtonLink>
          </div>
        </section>
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-10 text-sm text-ink-faint sm:flex-row sm:items-center sm:justify-between">
          <Logo />
          <p>Built with Next.js, Express and Postgres.</p>
        </div>
      </footer>
    </>
  );
}

/** Static hero illustration — a scaled-down page using the real type hierarchy. */
function PaperPreview() {
  return (
    <div className="rounded-[3px] bg-white shadow-page ring-1 ring-black/5">
      <div className="px-9 py-8">
        <div className="text-center">
          <div className="font-sans text-[1.35rem] font-bold leading-tight tracking-tight text-neutral-900">
            Avery Chen
          </div>
          <div className="mt-1.5 text-[0.5rem] text-neutral-500">
            avery.chen@example.com · (415) 555-0138 · San Francisco, CA
          </div>
        </div>

        {[
          { title: 'Experience', rows: 4 },
          { title: 'Projects', rows: 2 },
          { title: 'Skills', rows: 2 },
        ].map((section) => (
          <div key={section.title} className="mt-5">
            <div className="text-[0.5rem] font-bold uppercase tracking-[0.09em] text-neutral-900">
              {section.title}
            </div>
            <div className="mt-1 h-[0.5px] bg-neutral-300" />

            <div className="mt-2.5 space-y-2.5">
              {Array.from({ length: section.rows }).map((_, r) => (
                <div key={r}>
                  <div className="flex items-baseline justify-between gap-3">
                    <div
                      className="h-[3px] rounded-full bg-neutral-800"
                      style={{ width: `${38 + r * 9}%` }}
                    />
                    <div className="h-[3px] w-[14%] rounded-full bg-neutral-300" />
                  </div>
                  <div className="mt-1.5 space-y-1 pl-2">
                    <div className="h-[2px] w-[92%] rounded-full bg-neutral-200" />
                    <div className="h-[2px] w-[80%] rounded-full bg-neutral-200" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
