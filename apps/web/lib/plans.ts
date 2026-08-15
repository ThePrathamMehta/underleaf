import type { PlanDto } from "@repo/types";

/**
 * How a plan is worded, wherever it appears.
 *
 * The landing page and `/pricing` describe the same offer, so they read from
 * this rather than each holding their own copy. A price that says one thing on
 * the home page and another on the pricing page is a trust problem, and two
 * copies of the formatting is exactly how that happens — the numbers themselves
 * come from the API for the same reason (see `PlanCard`).
 */

/** "$5", not "$5.00" — whole-dollar prices don't need the cents. */
export function price(cents: number): string {
  if (cents === 0) return "Free";
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}

export function cadence(plan: PlanDto): string {
  if (plan.priceCents === 0) return "forever";
  return plan.billingInterval === "month" ? "per month" : "once";
}

/** The one line under the price that says what you actually get. */
export function allowanceLine(plan: PlanDto): string {
  if (plan.isRenewing) return `${plan.aiActionAllowance} AI actions a month`;
  if (plan.durationDays) {
    return `${plan.aiActionAllowance} AI actions, good for ${plan.durationDays} days`;
  }
  return `${plan.aiActionAllowance} AI actions to start with`;
}

/**
 * What every plan includes, free one too.
 *
 * The longer list on purpose. Metering four AI features on a resume editor
 * invites the assumption that the editor is metered as well, and the only cure
 * is naming what isn't.
 */
export const INCLUDED_EVERYWHERE = [
  "Every template, and the full editor",
  "Unlimited resumes, edits and PDF exports",
  "Upload and edit existing PDFs",
  "The automated ATS checks",
  "Job-description keyword matching",
];

/** The two lines that distinguish each plan from the one beside it. */
export const PLAN_EXTRAS: Record<string, string[]> = {
  free: [
    "Enough AI to try all four features",
    "No card, no expiry — the allowance is simply yours",
  ],
  pro_monthly: [
    "The assistant, AI-reviewed ATS scoring, Apply with AI and cover letters",
    "Refills every month, cancel any time",
  ],
  job_search_pass: [
    "A bigger allowance for the weeks you're actually applying",
    "One payment — nothing to remember to cancel",
  ],
};

/** The four metered features, and what one action buys in each. */
export const METERED_ACTIONS: Array<[string, string]> = [
  ["A message to the assistant", "Each turn you send in the chat panel."],
  ["An AI-reviewed ATS score", "The writing review on top of the automated checks."],
  ["Apply with AI", "Closing one job-match gap on the canvas."],
  ["A cover letter", "Generating or regenerating one."],
];
