import { prisma } from "@repo/db";
import { PLAN_DEFAULTS, type PlanKey } from "@repo/types";
import { badRequest } from "../middleware/errors.js";

/**
 * The write side of billing: granting, renewing and retiring memberships.
 *
 * Everything here is driven by a verified webhook, never by a browser. A client
 * that returns from Checkout tells us nothing we act on — it only triggers a
 * re-read. That is what "the webhook is the source of truth" means in practice:
 * the only code that can grant a paid allowance is code holding a Stripe
 * signature, so a user who replays the success redirect gets a page refresh.
 *
 * Reads and spending live in `entitlements.ts`. The split is deliberate: that
 * file is on the hot path of every AI request, this one runs a handful of times
 * per user per month.
 */

/** Stripe reports seconds; the database stores `DateTime`. */
export function fromUnixSeconds(seconds: number | null | undefined): Date | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000);
}

async function planByKey(key: PlanKey) {
  const plan = await prisma.plan.findUnique({ where: { key } });
  if (!plan) {
    // Reachable only if a webhook names a plan the database doesn't have, which
    // means the seed and the Stripe dashboard have drifted. Failing loudly beats
    // silently granting the wrong allowance.
    throw badRequest(`Plan "${key}" is not configured`);
  }
  return plan;
}

/**
 * Records that a Stripe event has been handled, returning false if it already had.
 *
 * Called before any grant. Stripe retries until it sees a 2xx and may deliver the
 * same event twice regardless, so "did I already do this" has to be a database
 * fact rather than an assumption — a replayed `invoice.paid` that slipped through
 * would be a free extra month of actions.
 */
export async function claimStripeEvent(eventId: string, type: string): Promise<boolean> {
  try {
    await prisma.stripeEvent.create({ data: { id: eventId, type } });
    return true;
  } catch {
    // The only expected failure is the primary-key conflict that means "seen".
    return false;
  }
}

/**
 * Grants a paid plan, retiring whatever the user was on.
 *
 * One transaction, because the intermediate state — old membership retired, new
 * one not yet written — is a state in which a concurrent AI request would resolve
 * no entitlement at all and be refused, in the seconds right after the user paid.
 *
 * The previous *paid* subscription is expired rather than deleted, and the free
 * row is left alone: it holds the remaining free grant, and a user whose pass
 * lapses should land back on whatever free actions they never spent rather than
 * on a fresh ten.
 */
export async function activatePaidPlan(params: {
  userId: string;
  planKey: PlanKey;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  /** From Stripe for a subscription; computed from `durationDays` for the pass. */
  currentPeriodEnd: Date | null;
}): Promise<void> {
  const plan = await planByKey(params.planKey);

  const periodEnd =
    params.currentPeriodEnd ??
    (plan.durationDays ? new Date(Date.now() + plan.durationDays * 86_400_000) : null);

  await prisma.$transaction(async (tx) => {
    await tx.subscription.updateMany({
      where: {
        userId: params.userId,
        status: { in: ["active", "canceled", "past_due"] },
        plan: { key: { not: "free" } },
      },
      data: { status: "expired" },
    });

    const subscription = await tx.subscription.create({
      data: {
        userId: params.userId,
        planId: plan.id,
        status: "active",
        currentPeriodEnd: periodEnd,
        stripeSubscriptionId: params.stripeSubscriptionId,
        stripeCustomerId: params.stripeCustomerId,
      },
    });

    await tx.userAiUsage.create({
      data: {
        userId: params.userId,
        subscriptionId: subscription.id,
        allowanceGranted: plan.aiActionAllowance,
        periodEnd,
      },
    });
  });
}

/**
 * The user's existing Stripe Customer, if they have ever bought anything.
 *
 * Read off subscription rows rather than kept on `User`: subscriptions are
 * expired, never deleted, so the id outlives the membership that introduced it
 * and there is no second copy to keep in step. `stripeCustomerId` is indexed on
 * that table for the webhook's benefit, so this costs nothing extra.
 */
export async function findCustomerId(userId: string): Promise<string | null> {
  const row = await prisma.subscription.findFirst({
    where: { userId, stripeCustomerId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { stripeCustomerId: true },
  });

  return row?.stripeCustomerId ?? null;
}

/**
 * Opens a fresh usage period on a renewal.
 *
 * A new `UserAiUsage` row, not a reset of the old one: unused actions do not roll
 * over, and the previous period stays readable as history. Only ever called for
 * a renewing plan — a replayed invoice for the one-time pass must not refill it.
 */
export async function renewSubscriptionPeriod(params: {
  stripeSubscriptionId: string;
  currentPeriodEnd: Date | null;
}): Promise<void> {
  const subscription = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: params.stripeSubscriptionId },
    include: { plan: true },
  });

  // Unknown subscription, or the first invoice of a subscription whose checkout
  // already granted the period. Either way there is nothing to renew.
  if (!subscription || !subscription.plan.isRenewing) return;

  await prisma.$transaction(async (tx) => {
    await tx.subscription.update({
      where: { id: subscription.id },
      data: {
        status: "active",
        currentPeriodEnd: params.currentPeriodEnd,
        // A successful payment clears a past_due state, but it must not clear a
        // pending cancellation: the user asked to stop, and Stripe is billing the
        // period they already committed to.
      },
    });

    await tx.userAiUsage.create({
      data: {
        userId: subscription.userId,
        subscriptionId: subscription.id,
        allowanceGranted: subscription.plan.aiActionAllowance,
        periodEnd: params.currentPeriodEnd,
      },
    });
  });
}

/**
 * Mirrors Stripe's view of a subscription onto our row.
 *
 * Used for `customer.subscription.updated`, which is how a cancellation arrives.
 * `cancel_at_period_end` is stored as intent and the status stays access-granting
 * until the period actually ends — the Definition of Done requires the user keep
 * what they paid for.
 */
export async function syncSubscriptionState(params: {
  stripeSubscriptionId: string;
  stripeStatus: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
}): Promise<void> {
  const status = mapStripeStatus(params.stripeStatus, params.cancelAtPeriodEnd);

  await prisma.subscription.updateMany({
    where: { stripeSubscriptionId: params.stripeSubscriptionId },
    data: {
      status,
      cancelAtPeriodEnd: params.cancelAtPeriodEnd,
      ...(params.currentPeriodEnd ? { currentPeriodEnd: params.currentPeriodEnd } : {}),
    },
  });
}

/**
 * Translates Stripe's subscription statuses into the four this app stores.
 *
 * `trialing` counts as active because a trial that can't use the product is not
 * a trial. `incomplete` and `unpaid` map to `past_due`, which still resolves an
 * entitlement — dunning is Stripe's job, and cutting access off at the first
 * failed charge punishes an expired card rather than a non-payer.
 */
function mapStripeStatus(stripeStatus: string, cancelAtPeriodEnd: boolean): string {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return cancelAtPeriodEnd ? "canceled" : "active";
    case "past_due":
    case "incomplete":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "expired";
    default:
      return "active";
  }
}

/** The period has genuinely ended — `customer.subscription.deleted`. */
export async function expireSubscription(stripeSubscriptionId: string): Promise<void> {
  await prisma.subscription.updateMany({
    where: { stripeSubscriptionId },
    data: { status: "expired", cancelAtPeriodEnd: false },
  });
}

/** The allowance a plan advertises, for the pricing page's copy. */
export function plannedAllowance(key: PlanKey): number {
  return PLAN_DEFAULTS[key].aiActionAllowance;
}
