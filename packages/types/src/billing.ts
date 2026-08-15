import { z } from "zod";

/**
 * Wire types for v5 membership and metering.
 *
 * The values here are the single source of truth for both ends: the API meters
 * against them, `/pricing` renders from them, and every metered panel reads the
 * same usage shape. A plan added here is a plan both sides understand.
 */

// --- Plans ---

/**
 * The three tiers, in the order `/pricing` lists them.
 *
 * A closed set in code while prices and allowances live in the database: the
 * *shape* of the offer is a product decision that ships with a deploy, the
 * numbers are meant to be tuned from real usage without one.
 */
export const PLAN_KEYS = ["free", "pro_monthly", "job_search_pass"] as const;

export const planKeySchema = z.enum(PLAN_KEYS);
export type PlanKey = z.infer<typeof planKeySchema>;

export const BILLING_INTERVALS = ["month", "one_time"] as const;

export const billingIntervalSchema = z.enum(BILLING_INTERVALS);
export type BillingInterval = z.infer<typeof billingIntervalSchema>;

/**
 * `canceled` is not the same as "no longer has access".
 *
 * Cancel-at-period-end sets the intent immediately while the already-paid period
 * runs on, so access is decided by `currentPeriodEnd`, never by this field
 * alone. Only `expired` and `past_due` withdraw it.
 */
export const SUBSCRIPTION_STATUSES = ["active", "canceled", "expired", "past_due"] as const;

export const subscriptionStatusSchema = z.enum(SUBSCRIPTION_STATUSES);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

/** Human labels, so the API, `/pricing`, and settings can't drift on wording. */
export const PLAN_LABELS: Record<PlanKey, string> = {
  free: "Free",
  pro_monthly: "Pro Monthly",
  job_search_pass: "Job Search Pass",
};

/**
 * The offer as shipped, and the seed's input.
 *
 * These are the values the `Plan` table is created *with*, not the values it is
 * read *by* — every read goes to the row, so an operator can tune a price or an
 * allowance with one UPDATE and no deploy. Keeping the initial numbers here
 * rather than inline in the seed gives the API a definition to fall back on when
 * it has to create the free plan on a database nobody has seeded yet, which is
 * the difference between a fresh checkout signing up and a fresh checkout 500ing.
 *
 * `stripePriceEnv` names the variable holding the Stripe Price id, because test
 * and live mode do not share one. Same reasoning as `apiKeySecretRef`: the
 * environment holds the account-specific string, the database holds the shape.
 */
export type PlanDefaults = {
  name: string;
  priceCents: number;
  billingInterval: BillingInterval | null;
  durationDays: number | null;
  aiActionAllowance: number;
  isRenewing: boolean;
  sortOrder: number;
  stripePriceEnv: string | null;
};

export const PLAN_DEFAULTS: Record<PlanKey, PlanDefaults> = {
  free: {
    name: PLAN_LABELS.free,
    priceCents: 0,
    billingInterval: null,
    durationDays: null,
    // One-time, not monthly: enough to feel all four AI features once, and
    // deliberately not enough to run a job search on.
    aiActionAllowance: 10,
    isRenewing: false,
    sortOrder: 0,
    stripePriceEnv: null,
  },
  pro_monthly: {
    name: PLAN_LABELS.pro_monthly,
    priceCents: 500,
    billingInterval: "month",
    durationDays: null,
    aiActionAllowance: 250,
    isRenewing: true,
    sortOrder: 1,
    stripePriceEnv: "STRIPE_PRICE_PRO_MONTHLY",
  },
  job_search_pass: {
    name: PLAN_LABELS.job_search_pass,
    priceCents: 1000,
    billingInterval: "one_time",
    // Expires by date whether or not the allowance is spent — a job search is a
    // season, and the pass is priced as one.
    durationDays: 60,
    aiActionAllowance: 400,
    isRenewing: false,
    sortOrder: 2,
    stripePriceEnv: "STRIPE_PRICE_JOB_SEARCH_PASS",
  },
};

// --- DTOs ---

/**
 * One plan as the browser sees it.
 *
 * Note what is absent: `stripePriceId`. The client names a plan by its `key`
 * when starting checkout and the server looks up the price id, so the browser
 * never holds a value that identifies what it is about to be charged — the same
 * reasoning that keeps `apiKeySecretRef` off `AiProviderConfigDto`.
 */
export const planSchema = z.object({
  key: planKeySchema,
  name: z.string(),
  priceCents: z.number().int().min(0),
  billingInterval: billingIntervalSchema.nullable(),
  durationDays: z.number().int().positive().nullable(),
  aiActionAllowance: z.number().int().min(0),
  isRenewing: z.boolean(),
  /** False for the free plan, and for any plan with no Stripe price configured. */
  purchasable: z.boolean(),
});

export type PlanDto = z.infer<typeof planSchema>;

/**
 * The allowance counter every metered surface displays.
 *
 * `remaining` is sent rather than left to the client to subtract: four panels
 * show this number, and four subtractions are four chances to disagree with the
 * server about whether the next click will be refused.
 */
export const aiUsageSchema = z.object({
  granted: z.number().int().min(0),
  consumed: z.number().int().min(0),
  remaining: z.number().int().min(0),
  /** When this grant lapses. Null for the free plan, which never expires. */
  periodEnd: z.string().nullable(),
});

export type AiUsageDto = z.infer<typeof aiUsageSchema>;

export const subscriptionSchema = z.object({
  planKey: planKeySchema,
  planName: z.string(),
  status: subscriptionStatusSchema,
  startedAt: z.string(),
  /** Renewal date for Pro Monthly, expiry for the pass, null for free. */
  currentPeriodEnd: z.string().nullable(),
  /** Access continues to `currentPeriodEnd`, then stops. */
  cancelAtPeriodEnd: z.boolean(),
  usage: aiUsageSchema,
  /** Whether a Stripe customer exists to open the portal for. */
  canManageBilling: z.boolean(),
});

export type SubscriptionDto = z.infer<typeof subscriptionSchema>;

// --- Request bodies ---

/**
 * Checkout names a plan, not a price.
 *
 * The amount to charge is read from the database against this key. A body that
 * carried a price id — or worse, an amount — would be a client telling the
 * server what to bill, and no amount of validation makes that the right shape.
 */
export const createCheckoutBodySchema = z.object({
  planKey: planKeySchema.refine((key) => key !== "free", {
    message: "The free plan is not purchasable",
  }),
});

export type CreateCheckoutBody = z.infer<typeof createCheckoutBodySchema>;

// --- Errors ---

/**
 * The code a blocked metered request answers with, alongside HTTP 402.
 *
 * A specific code rather than a bare status: every metered panel maps this to
 * its own inline upgrade message, and matching on a string is what lets them do
 * that without parsing prose that might be reworded.
 */
export const ALLOWANCE_EXHAUSTED = "allowance_exhausted" as const;

export const allowanceErrorSchema = z.object({
  error: z.string(),
  code: z.literal(ALLOWANCE_EXHAUSTED),
  usage: aiUsageSchema,
});

export type AllowanceErrorResponse = z.infer<typeof allowanceErrorSchema>;
