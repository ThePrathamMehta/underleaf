"use client";

import { motion } from "framer-motion";
import type { PlanDto } from "@repo/types";
import { PLAN_EXTRAS, allowanceLine, cadence, price } from "../lib/plans";
import { Button, ButtonLink } from "./button";

/**
 * One plan, as it appears on both the landing page and `/pricing`.
 *
 * Shared rather than written twice on purpose. The two surfaces sell the same
 * offer, and the failure mode of two copies isn't that they look different — it's
 * that one of them keeps saying $9 after the other has been updated. Numbers come
 * from the API for the same reason; nothing about the price is written down in the
 * frontend at all.
 */

export function PlanCard({
  plan,
  index,
  current,
  signedIn,
  busy,
  disabled,
  onStart,
}: {
  plan: PlanDto;
  /** Position in the row, for the stagger only. */
  index: number;
  current: boolean;
  signedIn: boolean;
  busy: boolean;
  disabled: boolean;
  onStart: () => void;
}) {
  const featured = plan.key === "pro_monthly";
  const isFree = plan.priceCents === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.45, delay: index * 0.07, ease: [0.22, 1, 0.36, 1] }}
      className={`flex flex-col rounded-xl bg-paper-raised p-6 ring-1 ring-inset sm:p-7 ${
        featured ? "ring-2 ring-accent/40" : "ring-rule"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-xl tracking-tight">{plan.name}</h3>
        {featured && (
          <span className="rounded-full bg-accent-wash px-2 py-0.5 font-mono text-[0.625rem] uppercase tracking-[0.12em] text-accent">
            Most used
          </span>
        )}
        {current && !featured && (
          <span className="rounded-full bg-positive-wash px-2 py-0.5 font-mono text-[0.625rem] uppercase tracking-[0.12em] text-positive">
            Current
          </span>
        )}
      </div>

      <p className="mt-5 flex items-baseline gap-1.5">
        <span className="font-display text-[2.5rem] leading-none tracking-tightest">
          {price(plan.priceCents)}
        </span>
        <span className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-ink-faint">
          {cadence(plan)}
        </span>
      </p>

      <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-muted">{allowanceLine(plan)}</p>

      <ul className="mt-6 space-y-2.5 border-t border-rule pt-6">
        {(PLAN_EXTRAS[plan.key] ?? []).map((item) => (
          <Included key={item}>{item}</Included>
        ))}
      </ul>

      {/* Pushed to the bottom so three cards of unequal copy still line their
          buttons up — a ragged row of CTAs reads as three different offers. */}
      <div className="mt-auto pt-7">
        {current ? (
          <Button variant="secondary" className="w-full" disabled>
            Your current plan
          </Button>
        ) : isFree ? (
          <ButtonLink
            href={signedIn ? "/dashboard" : "/signup"}
            variant="secondary"
            className="w-full"
          >
            {signedIn ? "Included with your account" : "Start free"}
          </ButtonLink>
        ) : (
          <>
            <Button
              variant={featured ? "primary" : "secondary"}
              className="w-full"
              onClick={onStart}
              disabled={!plan.purchasable || disabled}
            >
              {busy ? "Opening checkout…" : `Get ${plan.name}`}
            </Button>
            {!plan.purchasable && (
              <p className="mt-2 text-center text-[0.75rem] text-ink-faint">
                Not available for purchase yet.
              </p>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}

/** A ticked line. Used for plan features and for the unlimited-everywhere list. */
export function Included({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 text-[0.875rem] leading-snug text-ink-muted">
      <span aria-hidden className="mt-[0.1875rem] shrink-0 text-positive">
        <CheckIcon />
      </span>
      <span>{children}</span>
    </li>
  );
}

export function PlanSkeletons() {
  return (
    <div className="grid gap-6 lg:grid-cols-3" aria-hidden>
      {[0, 1, 2].map((index) => (
        <motion.div
          key={index}
          animate={{ opacity: [0.4, 0.8, 0.4] }}
          transition={{ duration: 1.6, repeat: Infinity, delay: index * 0.12 }}
          className="h-[26rem] rounded-xl bg-paper-raised ring-1 ring-inset ring-rule"
        />
      ))}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      width={13}
      height={13}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m5 12 4.5 4.5L19 7" />
    </svg>
  );
}
