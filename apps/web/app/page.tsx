'use client';

import { useRef } from 'react';
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion';
import Link from 'next/link';
import { ButtonLink } from '../components/button';
import { LeafMark, Logo } from '../components/logo';
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
                Résumés that look <em className="italic text-accent">considered</em>.
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
            <HeroPreview />
          </div>
        </section>

        {/* A quiet band of facts between the hero and the argument, so the
            claims above land before the prose starts. The hairlines are the
            grid's own background showing through a 1px gap, which gets the
            rules right at both breakpoints without per-cell border variants. */}
        <section className="border-b border-rule bg-paper-raised">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px bg-rule px-6 sm:grid-cols-4">
            {[
              { figure: 'Five', label: 'typeset templates' },
              { figure: '1:1', label: 'screen to PDF' },
              { figure: 'Zero', label: 'LaTeX to learn' },
              { figure: '~20 min', label: 'to a finished draft' },
            ].map((fact, i) => (
              <motion.div
                key={fact.figure}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.45, delay: i * 0.07, ease: [0.22, 1, 0.36, 1] }}
                className="bg-paper-raised py-8 pr-6 sm:pl-6 sm:first:pl-0"
              >
                <div className="font-display text-[1.75rem] leading-none tracking-tight">
                  {fact.figure}
                </div>
                <div className="mt-2 text-[0.8125rem] text-ink-muted">{fact.label}</div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* The problem, stated plainly — an editorial pull-quote, not feature cards. */}
        <section className="border-b border-rule">
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
        <section className="border-b border-rule bg-paper-raised">
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

        {/* The detail work — the things you only notice when they're missing. */}
        <section className="border-b border-rule">
          <div className="mx-auto max-w-6xl px-6 py-20 lg:py-24">
            <div className="grid gap-12 lg:grid-cols-[0.4fr_0.6fr] lg:gap-20">
              <div>
                <h2 className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-ink-faint">
                  In the editor
                </h2>
                <p className="mt-6 max-w-[32ch] font-display text-[clamp(1.375rem,2.4vw,1.75rem)] leading-[1.25] tracking-tight text-balance">
                  The small things you only notice when they&rsquo;re missing.
                </p>
              </div>

              <dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
                {[
                  {
                    term: 'Format a single word',
                    detail:
                      'Select any run and set bold, italic, colour, highlight or typeface on that run alone — or change the whole document from the toolbar.',
                  },
                  {
                    term: 'Real links',
                    detail:
                      'Add a link to any phrase and it stays clickable in the exported PDF, not just underlined blue text.',
                  },
                  {
                    term: 'Nothing to save',
                    detail:
                      'Edits autosave as you type, with full undo and redo across the whole document.',
                  },
                  {
                    term: 'Pages that behave',
                    detail:
                      'Add a second page when you need one. Margins, spacing and page size are measured in millimetres, the same units the PDF uses.',
                  },
                ].map((feature, i) => (
                  <motion.div
                    key={feature.term}
                    initial={{ opacity: 0, y: 14 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '-60px' }}
                    transition={{ duration: 0.5, delay: i * 0.07, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <dt className="flex items-baseline gap-2.5 font-display text-xl tracking-tight">
                      <span aria-hidden className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                      {feature.term}
                    </dt>
                    <dd className="mt-2 pl-[1rem] leading-relaxed text-ink-muted text-pretty">
                      {feature.detail}
                    </dd>
                  </motion.div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="relative overflow-hidden bg-paper-raised">
          {/* An oversized leaf bleeding off the corner, as a watermark. */}
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-16 -right-10 text-accent/[0.06]"
          >
            <LeafMark size={280} />
          </div>

          <div className="relative mx-auto flex max-w-6xl flex-col items-start gap-8 px-6 py-20 md:flex-row md:items-center md:justify-between lg:py-24">
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

/**
 * Hero illustration — a scaled-down page using the real type hierarchy, that
 * assembles itself on load and parallaxes gently on mouse move. All motion is
 * transform/opacity only (GPU-friendly) and collapses to a static card when the
 * visitor prefers reduced motion.
 */
function HeroPreview() {
  const reduceMotion = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);

  // Pointer position, normalised to [-0.5, 0.5] over the card, smoothed by a
  // spring so the parallax trails the cursor rather than snapping.
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 120, damping: 18, mass: 0.6 });
  const sy = useSpring(py, { stiffness: 120, damping: 18, mass: 0.6 });
  const rotateY = useTransform(sx, [-0.5, 0.5], [6, -6]);
  const rotateX = useTransform(sy, [-0.5, 0.5], [-5, 5]);
  const translateX = useTransform(sx, [-0.5, 0.5], [-10, 10]);

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (reduceMotion) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    px.set((event.clientX - rect.left) / rect.width - 0.5);
    py.set((event.clientY - rect.top) / rect.height - 0.5);
  }

  function resetPointer() {
    px.set(0);
    py.set(0);
  }

  return (
    <motion.div
      ref={wrapRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetPointer}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="relative mx-auto w-full max-w-[26rem] lg:max-w-none"
      style={{ perspective: 1000 }}
    >
      {/* Warm light behind the sheet, so it sits in the page rather than on it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-16 -inset-y-16"
        style={{
          background:
            'radial-gradient(58% 46% at 55% 42%, var(--accent-wash) 0%, transparent 72%)',
        }}
      />

      <motion.div
        className="relative"
        style={
          reduceMotion
            ? { rotate: -1.2 }
            : { rotate: -1.2, rotateX, rotateY, x: translateX, transformStyle: 'preserve-3d' }
        }
      >
        {/* A second sheet, just visible behind the first: this is a document
            with more than one page, and it gives the stack real depth. */}
        <motion.div
          aria-hidden
          initial={{ opacity: 0, x: 0, y: 0, rotate: -1.2 }}
          animate={{ opacity: 1, x: 14, y: 16, rotate: 2.4 }}
          transition={{ duration: 0.9, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-0 rounded-[3px] bg-white shadow-page ring-1 ring-black/5"
        />

        <PaperPreview stagger={!reduceMotion} />

        {/* Chrome floating off the page. `z` only bites inside the preserve-3d
            parent above; without it the value is inert. It has to go through
            Framer rather than an inline style, since Framer composes the whole
            transform itself and would drop a translateZ set alongside it. */}
        <FloatingChip className="-left-4 top-8 sm:-left-8" delay={1.05} z={45}>
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-positive" />
          </span>
          Saved
        </FloatingChip>

        <FloatingChip className="-right-3 bottom-10 sm:-right-7" delay={1.2} z={60}>
          <PdfGlyph />
          resume.pdf · fonts embedded
        </FloatingChip>
      </motion.div>
    </motion.div>
  );
}

/** A small pill of app chrome that hovers off the paper. */
function FloatingChip({
  children,
  className = '',
  delay,
  z,
}: {
  children: React.ReactNode;
  className?: string;
  delay: number;
  z: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.96, z }}
      animate={{ opacity: 1, y: 0, scale: 1, z }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      className={`absolute inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-paper-raised px-3 py-1.5 text-[0.6875rem] text-ink-muted shadow-lift ring-1 ring-rule ${className}`}
    >
      {children}
    </motion.div>
  );
}

/**
 * The paper card itself — a real resume at a quarter size, not a wireframe.
 *
 * Set in the app's own sans at true relative proportions, so the miniature is
 * an honest preview of the type hierarchy rather than a stack of grey bars.
 * Deep bullet lines stay as rules: at this scale they'd be a texture of noise
 * either way, and leaving them abstract keeps the eye on the structure. Rows
 * stagger into place on load when `stagger`.
 */
function PaperPreview({ stagger }: { stagger: boolean }) {
  // With stagger off (reduced motion), children render at their final state.
  const container = stagger
    ? { hidden: {}, shown: { transition: { staggerChildren: 0.08, delayChildren: 0.35 } } }
    : undefined;
  const item = stagger
    ? {
        hidden: { opacity: 0, y: 8 },
        shown: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
      }
    : undefined;

  return (
    <motion.div
      variants={container}
      initial={stagger ? 'hidden' : false}
      animate={stagger ? 'shown' : false}
      className="relative rounded-[3px] bg-white shadow-page ring-1 ring-black/5"
    >
      <div className="px-8 py-7 font-sans text-neutral-800">
        <motion.div variants={item} className="text-center">
          <div className="text-[1.3rem] font-bold leading-none tracking-tight text-neutral-900">
            Avery Chen
          </div>
          <div className="mt-2 text-[0.48rem] leading-none text-neutral-500">
            avery.chen@example.com · (415) 555-0138 · San Francisco, CA ·{' '}
            <span className="text-[#1e3a5f] underline decoration-[0.4px] underline-offset-[1.5px]">
              averychen.dev
            </span>
          </div>
        </motion.div>

        <motion.div variants={item} className="mt-5">
          <SectionRule>Experience</SectionRule>

          <Entry
            org="Stripe"
            role="Senior Software Engineer, Payments"
            when="May 2022 — Present"
            where="San Francisco, CA"
          >
            <Bullet>
              Rebuilt ledger reconciliation as a streaming pipeline, cutting month-end close from
              nine hours to forty minutes.
            </Bullet>
            <BulletRule width="94%" />
            <BulletRule width="71%" />
          </Entry>

          <Entry
            org="Figma"
            role="Software Engineer"
            when="2020 — 2022"
            where="Remote"
            className="mt-2.5"
          >
            {/* The selected run, with the floating format bar above it — the
                editor's per-word formatting, shown rather than described. */}
            <Bullet>
              Shipped multiplayer presence for{' '}
              <span className="relative rounded-[1px] bg-[#fde3d2] px-[1px] font-semibold">
                two million
                <FormatBar />
              </span>
              <span
                aria-hidden
                className="caret-blink ml-px inline-block h-[0.55rem] w-[1px] translate-y-[1px] bg-[#c2410c] align-middle"
              />{' '}
              weekly editors.
            </Bullet>
            <BulletRule width="88%" />
          </Entry>
        </motion.div>

        <motion.div variants={item} className="mt-5">
          <SectionRule>Projects</SectionRule>
          <Entry org="Underleaf" role="TypeScript · Next.js · Postgres" when="2025" where="">
            <BulletRule width="96%" />
            <BulletRule width="79%" />
          </Entry>
        </motion.div>

        <motion.div variants={item} className="mt-5">
          <SectionRule>Education</SectionRule>
          <Entry
            org="UC Berkeley"
            role="B.S. Electrical Engineering & Computer Science"
            when="2016 — 2020"
            where="Berkeley, CA"
          />
        </motion.div>

        <motion.div variants={item} className="mt-5">
          <SectionRule>Skills</SectionRule>
          <dl className="mt-1.5 space-y-[3px] text-[0.5rem] leading-[1.5]">
            <div className="flex gap-1">
              <dt className="font-semibold text-neutral-900">Languages:</dt>
              <dd className="text-neutral-600">TypeScript, Go, Python, SQL</dd>
            </div>
            <div className="flex gap-1">
              <dt className="font-semibold text-neutral-900">Tools:</dt>
              <dd className="text-neutral-600">React, Postgres, Kafka, Docker, AWS</dd>
            </div>
          </dl>
        </motion.div>
      </div>
    </motion.div>
  );
}

function SectionRule({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="text-[0.5rem] font-bold uppercase leading-none tracking-[0.09em] text-neutral-900">
        {children}
      </div>
      <div className="mt-[3px] h-[0.5px] bg-neutral-400" />
    </>
  );
}

function Entry({
  org,
  role,
  when,
  where,
  className = '',
  children,
}: {
  org: string;
  role: string;
  when: string;
  where: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`mt-2 ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[0.55rem] font-bold leading-none text-neutral-900">{org}</span>
        <span className="shrink-0 text-[0.48rem] leading-none text-neutral-600">{when}</span>
      </div>
      <div className="mt-[3px] flex items-baseline justify-between gap-2">
        <span className="text-[0.5rem] italic leading-none text-neutral-700">{role}</span>
        {where && (
          <span className="shrink-0 text-[0.48rem] italic leading-none text-neutral-500">
            {where}
          </span>
        )}
      </div>
      {children && <div className="mt-1.5 space-y-[3px] pl-2">{children}</div>}
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative pl-2 text-[0.5rem] leading-[1.5] text-neutral-700">
      <span aria-hidden className="absolute left-0 top-0 text-neutral-400">
        ·
      </span>
      {children}
    </div>
  );
}

/** A bullet that's past the point of legibility at this size. */
function BulletRule({ width }: { width: string }) {
  return (
    <div className="flex h-[0.75rem] items-center pl-2">
      <div className="h-[2px] rounded-full bg-neutral-200" style={{ width }} />
    </div>
  );
}

/** The selection toolbar, in miniature, floating over the highlighted words. */
function FormatBar() {
  return (
    <motion.span
      initial={{ opacity: 0, y: -4, scale: 0.94, x: '-50%' }}
      animate={{ opacity: 1, y: 0, scale: 1, x: '-50%' }}
      transition={{ duration: 0.4, delay: 1.4, ease: [0.22, 1, 0.36, 1] }}
      // Centring goes through Framer, not a -translate-x-1/2 class: Framer
      // composes the whole transform inline and would override the class.
      //
      // Below the run rather than above it: at this scale the bar is taller
      // than a line, and above it would sit across the entry's role line. The
      // line below is a decorative rule, so covering part of it costs nothing.
      className="absolute left-1/2 top-full z-10 mt-1 flex items-center gap-px rounded-md bg-[#221d19] px-1 py-0.5 shadow-lift"
    >
      <FormatKey className="font-bold">B</FormatKey>
      <FormatKey className="font-serif italic">I</FormatKey>
      <FormatKey className="underline underline-offset-1">U</FormatKey>
      <span className="mx-px h-2 w-px bg-white/20" />
      <FormatKey>
        <span className="block h-[5px] w-[5px] rounded-full bg-[#f2743a]" />
      </FormatKey>
      <FormatKey>
        <LinkGlyph />
      </FormatKey>
    </motion.span>
  );
}

function FormatKey({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`flex h-3 w-3 items-center justify-center rounded-[2px] text-[0.4rem] leading-none text-white/85 ${className}`}
    >
      {children}
    </span>
  );
}

function LinkGlyph() {
  return (
    <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
      <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </svg>
  );
}

function PdfGlyph() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-accent"
      aria-hidden
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}
