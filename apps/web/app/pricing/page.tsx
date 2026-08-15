"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import type { PlanDto } from "@repo/types";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { useCheckout, useCheckoutResume } from "../../lib/checkout";
import { INCLUDED_EVERYWHERE, METERED_ACTIONS } from "../../lib/plans";
import { useUsage } from "../../lib/usage";
import { ButtonLink } from "../../components/button";
import { Included, PlanCard, PlanSkeletons } from "../../components/plan-card";
import { SiteHeader } from "../../components/site-header";

/**
 * Pricing (v5 Section 6).
 *
 * The page has one argument to make, and it is mostly about what *isn't* metered.
 * Everything deterministic — editing, the PDF work, export, the rule-based ATS
 * checks, the keyword diff — is unlimited on every plan, because none of it costs
 * anything per use. Only the four things that call a model are counted, and they
 * are counted in actions rather than tokens, so the number on the button means
 * something to the person reading it.
 *
 * Plans come from the API rather than from a constant here. The shape of the
 * offer ships with a deploy; the numbers are meant to be tuned from real usage
 * without one, and a page that hardcoded "$9" would quietly start lying the first
 * time somebody did.
 *
 * This is also where a purchase started elsewhere comes back to land: the landing
 * page sends signed-out visitors through signup with the plan in tow, and
 * `useCheckoutResume` reopens it here.
 */

const RISE = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
};

export default function PricingPage() {
  const { user } = useAuth();
  const { subscription, usage, refresh } = useUsage();

  const [plans, setPlans] = useState<PlanDto[]>([]);
  const [paymentsEnabled, setPaymentsEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [abandoned, setAbandoned] = useState(false);

  const { start, starting, error: checkoutError } = useCheckout();
  const resuming = useCheckoutResume(plans, start);

  const error = loadError ?? checkoutError;

  useEffect(() => {
    const controller = new AbortController();

    api
      .plans(controller.signal)
      .then((response) => {
        setPlans(response.plans);
        setPaymentsEnabled(response.paymentsEnabled);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setLoadError(caught instanceof ApiError ? caught.message : "Could not load the plans.");
        setLoading(false);
      });

    return () => controller.abort();
  }, []);

  // Cancelling is the exit Stripe sends back here, and it is not a failure — it
  // is acknowledged rather than alarmed about, mostly to confirm that nothing was
  // charged, with the cards still on screen to pick up from. Success goes to
  // settings, which waits out the webhook properly; the branch for it here is a
  // cheap safety net for a hand-typed or older link, not the real return path.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("checkout");
    if (outcome === "success" && user) void refresh();
    if (outcome === "cancelled") setAbandoned(true);
  }, [refresh, user]);

  return (
    <>
      <SiteHeader />

      <main>
        <section className="relative overflow-hidden border-b border-rule">
          <div className="pointer-events-none absolute inset-0 opacity-[0.55] paper-lines" aria-hidden />

          <div className="relative mx-auto max-w-6xl px-6 pb-16 pt-20">
            <motion.p
              {...RISE}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="mb-6 font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-ink-faint"
            >
              Pricing · Pay for the AI, not the editor
            </motion.p>

            <motion.h1
              {...RISE}
              transition={{ duration: 0.6, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
              className="max-w-[18ch] font-display text-[clamp(2.5rem,6vw,4rem)] leading-[0.98] tracking-tightest text-balance"
            >
              The resume part is <em className="italic text-accent">free</em>.
            </motion.h1>

            <motion.p
              {...RISE}
              transition={{ duration: 0.6, delay: 0.14, ease: [0.22, 1, 0.36, 1] }}
              className="mt-7 max-w-[54ch] text-[1.0625rem] leading-relaxed text-ink-muted text-pretty"
            >
              Building, editing and exporting cost us nothing per use, so they cost you
              nothing — no page limits, no watermark, no export cap. What&rsquo;s metered is
              the handful of features that call a model on your behalf, counted in actions
              you can see rather than tokens you can&rsquo;t.
            </motion.p>

            {usage && (
              <motion.p
                {...RISE}
                transition={{ duration: 0.6, delay: 0.2 }}
                className="mt-6 inline-flex items-center gap-2 rounded-full bg-paper-raised px-3 py-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-ink-muted ring-1 ring-inset ring-rule"
              >
                <span className="text-ink-faint">Your plan</span>
                <span className="text-ink">{subscription?.planName ?? "Free"}</span>
                <span aria-hidden className="text-ink-faint">
                  ·
                </span>
                <span className="tabular-nums">{usage.remaining} actions left</span>
              </motion.p>
            )}
          </div>
        </section>

        <section className="border-b border-rule">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <h2 className="sr-only">Plans</h2>

            {resuming && !error && (
              <p
                role="status"
                className="mb-8 rounded-lg bg-accent-wash px-4 py-3 text-sm text-accent"
              >
                Your account is ready — taking you to checkout&hellip;
              </p>
            )}

            {abandoned && !resuming && (
              <p
                role="status"
                className="mb-8 rounded-lg bg-paper-sunken px-4 py-3 text-sm text-ink-muted ring-1 ring-inset ring-rule"
              >
                Checkout was cancelled and nothing was charged. Pick a plan below whenever
                you&rsquo;re ready.
              </p>
            )}

            {error && (
              <p
                role="alert"
                className="mb-8 rounded-lg bg-danger-wash px-4 py-3 text-sm text-danger"
              >
                {error}
              </p>
            )}

            {!paymentsEnabled && !loading && (
              <p
                role="status"
                className="mb-8 rounded-lg bg-accent-wash px-4 py-3 text-sm text-accent"
              >
                Checkout isn&rsquo;t switched on in this environment yet, so the paid plans
                can&rsquo;t be bought here. Everything on the free plan works as described.
              </p>
            )}

            {loading ? (
              <PlanSkeletons />
            ) : (
              // Three-up only at lg, matching the dashboard and template grids.
              // Three cards at md is ~224px each, which crowds the price and its
              // badge onto two lines; there's no two-column step because three
              // plans in two columns leaves an orphan.
              <div className="grid gap-6 lg:grid-cols-3">
                {plans.map((plan, index) => (
                  <PlanCard
                    key={plan.key}
                    plan={plan}
                    index={index}
                    current={subscription?.planKey === plan.key}
                    signedIn={Boolean(user)}
                    busy={starting === plan.key}
                    disabled={starting !== null}
                    onStart={() => void start(plan)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <WhatCounts />

        <section className="border-b border-rule">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="grid gap-12 lg:grid-cols-[0.4fr_0.6fr] lg:gap-20">
              <h2 className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-ink-faint">
                Questions
              </h2>
              <dl className="space-y-8">
                <Faq question="What exactly is one AI action?">
                  One thing you asked a model to do: a message to the assistant, one
                  AI-reviewed ATS score, one &ldquo;Apply with AI&rdquo;, or one cover letter.
                  Length doesn&rsquo;t change the count — a two-word question and a full
                  rewrite both cost one.
                </Faq>
                <Faq question="Does the free allowance refill?">
                  No. It&rsquo;s a one-time grant, not a monthly one — enough to see what the
                  AI features do on your own resume before deciding whether they&rsquo;re
                  worth paying for. The rest of the product stays free regardless, forever.
                </Faq>
                <Faq question="What happens when I run out?">
                  The AI features stop and say so, and nothing else changes. You keep every
                  resume, every edit, and unlimited exports — an empty allowance never locks
                  you out of your own documents.
                </Faq>
                <Faq question="Is the pass a subscription?">
                  No. It&rsquo;s a single payment with a fixed allowance and a fixed expiry,
                  meant for the few weeks you&rsquo;re actively applying. There&rsquo;s
                  nothing to cancel — it ends by itself.
                </Faq>
                <Faq question="Can I cancel Pro?">
                  Any time, from settings. Cancelling stops the renewal; you keep the
                  actions you&rsquo;ve already paid for until the end of the period
                  you&rsquo;re in.
                </Faq>
              </dl>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-20 text-center">
          <p className="mx-auto max-w-[34ch] font-display text-[clamp(1.5rem,3vw,2.125rem)] leading-[1.2] tracking-tight text-balance">
            Start on the free plan. It doesn&rsquo;t ask for a card.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <ButtonLink href={user ? "/dashboard" : "/signup"} size="lg">
              {user ? "Back to my resumes" : "Create your resume"}
            </ButtonLink>
            <Link
              href="/templates"
              className="group inline-flex h-12 items-center gap-1.5 px-2 text-sm text-ink-muted transition-colors hover:text-ink"
            >
              Browse templates
              <span className="transition-transform duration-200 group-hover:translate-x-0.5">
                →
              </span>
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}

/**
 * The honest half of the page: which four things cost an action, and the much
 * longer list of things that never will. Stated as a table rather than as
 * marketing, because the whole pricing model only makes sense once you can see
 * where the line is drawn.
 */
function WhatCounts() {
  return (
    <section className="border-b border-rule bg-paper-raised">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-ink-faint">
          What counts as an AI action
        </h2>

        <div className="mt-10 grid gap-12 md:grid-cols-2 md:gap-16">
          <div>
            <p className="font-display text-[1.375rem] tracking-tight">Metered — 1 action each</p>
            <ul className="mt-5 space-y-3">
              {METERED_ACTIONS.map(([label, detail]) => (
                <li key={label} className="border-b border-rule pb-3 last:border-0">
                  <p className="text-[0.9375rem] text-ink">{label}</p>
                  <p className="mt-0.5 text-[0.8125rem] leading-snug text-ink-faint">{detail}</p>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="font-display text-[1.375rem] tracking-tight">
              Unlimited on every plan, including free
            </p>
            <ul className="mt-5 space-y-2.5">
              {INCLUDED_EVERYWHERE.map((item) => (
                <Included key={item}>{item}</Included>
              ))}
            </ul>
            <p className="mt-6 max-w-[46ch] text-[0.8125rem] leading-relaxed text-ink-faint text-pretty">
              If a feature runs entirely on your own machine or ours without calling a
              model, it isn&rsquo;t counted. That includes the ATS checks that look at
              structure, dates and headings, and the keyword diff against a posting — both
              of which run before any AI is involved, and both of which keep working when
              your allowance is gone.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Faq({ question, children }: { question: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-rule pb-8 last:border-0 last:pb-0">
      <dt className="font-display text-lg tracking-tight">{question}</dt>
      <dd className="mt-2 max-w-[58ch] leading-relaxed text-ink-muted text-pretty">{children}</dd>
    </div>
  );
}
