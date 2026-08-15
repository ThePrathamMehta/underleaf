import { prisma, type Plan, type Subscription, type UserAiUsage } from "@repo/db";
import {
  ALLOWANCE_EXHAUSTED,
  PLAN_DEFAULTS,
  type AiPurpose,
  type AiUsageDto,
  type PlanKey,
  type SubscriptionStatus,
} from "@repo/types";
import { HttpError } from "../middleware/errors.js";

/**
 * Membership entitlement: which plan a user is on, and whether they may spend an
 * AI action.
 *
 * One module, because there is exactly one question here and four surfaces ask
 * it. Everything that costs tokens calls `checkAndConsumeAiAction` before it
 * calls `@repo/ai`; everything deterministic — editing, PDF work, export, the
 * rule-based ATS score, the keyword diff — never imports this file at all. That
 * asymmetry is the product decision in Section 0, and keeping it visible as an
 * import boundary is how it stays true as features get added.
 */

const FREE = "free" as const;

/** What every metered route and `GET /billing/subscription` need to know. */
export type Entitlement = {
  planKey: PlanKey;
  planName: string;
  status: SubscriptionStatus;
  startedAt: Date;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  usage: AiUsageDto;
  stripeCustomerId: string | null;
  subscriptionId: string;
};

type UsageRow = Pick<UserAiUsage, "allowanceGranted" | "allowanceConsumed" | "periodEnd">;

/**
 * A usage row as the browser sees it.
 *
 * `remaining` is computed here and sent, rather than left to the four panels
 * that display it: four subtractions are four chances to disagree with the
 * server about whether the next click will be refused. Clamped at zero because
 * a refund racing a consume can, briefly, read as over-spent.
 */
export function toUsageDto(row: UsageRow | null): AiUsageDto {
  if (!row) return { granted: 0, consumed: 0, remaining: 0, periodEnd: null };

  return {
    granted: row.allowanceGranted,
    consumed: row.allowanceConsumed,
    remaining: Math.max(0, row.allowanceGranted - row.allowanceConsumed),
    periodEnd: row.periodEnd?.toISOString() ?? null,
  };
}

/**
 * True when a paid period has run out.
 *
 * `currentPeriodEnd` is the authority and `periodEnd` on the grant is the
 * backstop: the pass sets both, Pro Monthly tracks Stripe's period on the
 * subscription, and free sets neither. Checking both means a grant can lapse
 * without the subscription having to be rewritten first.
 */
function hasLapsed(
  subscription: Pick<Subscription, "currentPeriodEnd">,
  usage: Pick<UserAiUsage, "periodEnd"> | null,
  now: Date,
): boolean {
  if (subscription.currentPeriodEnd && subscription.currentPeriodEnd <= now) return true;
  return Boolean(usage?.periodEnd && usage.periodEnd <= now);
}

/**
 * The free plan row, created if this database has never been seeded.
 *
 * Signup calls this, and a signup that 500s because an operator hasn't run
 * `db:seed` is a worse failure than a plan row with the shipped defaults in it.
 * The seed's own upsert brings the row back in line on the next run, and the
 * numbers live in one place (`PLAN_DEFAULTS`) either way.
 */
async function freePlan(): Promise<Plan> {
  const existing = await prisma.plan.findUnique({ where: { key: FREE } });
  if (existing) return existing;

  const defaults = PLAN_DEFAULTS.free;
  return prisma.plan.upsert({
    where: { key: FREE },
    create: {
      key: FREE,
      name: defaults.name,
      priceCents: defaults.priceCents,
      billingInterval: defaults.billingInterval,
      durationDays: defaults.durationDays,
      aiActionAllowance: defaults.aiActionAllowance,
      isRenewing: defaults.isRenewing,
      sortOrder: defaults.sortOrder,
    },
    update: {},
  });
}

/**
 * Gives a user their free-plan subscription and its one-time grant.
 *
 * Called at signup — password and OAuth both — and again, harmlessly, by
 * `resolveEntitlement` for any account that predates v5. Idempotent by
 * construction: it looks for an existing active subscription first, so a
 * double-submitted signup or two concurrent requests for a migrated account
 * converge on one row rather than granting the allowance twice.
 *
 * The lookup is a read-then-write and therefore racy, so the backstop is the
 * partial unique index added in `20260811140000_one_active_subscription_per_plan`
 * (UNIQUE "userId" + "planId" WHERE status = 'active'): whichever request wins
 * the insert, the other fails on the index, and the loser still counts as done
 * because the winner's subscription is exactly the one this call exists to
 * guarantee. In the vanishing case of no index present — an old database that
 * skipped the migration — the catch re-throws rather than swallowing.
 */
export async function ensureFreeSubscription(userId: string): Promise<void> {
  const existing = await prisma.subscription.findFirst({
    where: { userId, status: "active" },
    select: { id: true },
  });
  if (existing) return;

  const plan = await freePlan();

  try {
    await prisma.subscription.create({
      data: {
        userId,
        planId: plan.id,
        status: "active",
        // Null: the free grant is one-time and never lapses. A free user who spent
        // 3 of 10 actions last year still has 7 today.
        currentPeriodEnd: null,
        usagePeriods: {
          create: { userId, allowanceGranted: plan.aiActionAllowance, periodEnd: null },
        },
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
}

/**
 * Prisma surfaces unique-violation errors differently per driver, so the check
 * is "does this failure look like the index we rely on". Broader than an exact
 * code match on purpose: any uniqueness conflict on this insert means another
 * request already created the free subscription, and that is the outcome we
 * wanted anyway.
 */
function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; meta?: unknown };
  return (
    candidate.code === "P2002" ||
    (typeof candidate.code === "string" && candidate.code.startsWith("23"))
  );
}

type LoadedSubscription = Subscription & { plan: Plan; usagePeriods: UserAiUsage[] };

/** The newest active-or-recently-ended subscription, with its current grant. */
async function loadSubscription(userId: string): Promise<LoadedSubscription | null> {
  return prisma.subscription.findFirst({
    where: { userId, status: { in: ["active", "canceled", "past_due"] } },
    orderBy: { createdAt: "desc" },
    include: {
      plan: true,
      // The current grant only. History stays in the table for tuning the
      // allowance numbers later, but nothing reads it per request.
      usagePeriods: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
}

/**
 * The caller's entitlement right now, with lapsed plans already retired.
 *
 * Expiry is applied on read rather than by a scheduled job: the pass expires by
 * date, and the only moment the answer matters is when someone asks. A user
 * whose pass ran out lands back on free — with whatever remains of the free
 * grant they were given at signup, which is the same allowance they'd have had
 * if they'd never bought anything.
 */
export async function resolveEntitlement(userId: string): Promise<Entitlement> {
  const now = new Date();
  let subscription = await loadSubscription(userId);

  if (!subscription) {
    await ensureFreeSubscription(userId);
    subscription = await loadSubscription(userId);
    if (!subscription) {
      // Unreachable short of the row being deleted between the two statements.
      throw new HttpError(500, "Could not resolve your membership. Try again.");
    }
  }

  const usage = subscription.usagePeriods[0] ?? null;

  if (subscription.plan.key !== FREE && hasLapsed(subscription, usage, now)) {
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: "expired" },
    });

    // Fall through to the free subscription this user still has, instead of
    // recursing — the recursion's own second load and second read of `now` are
    // exactly the code a reviewer will blink at, and falling through is one
    // fewer re-entry point to reason about. `expired` is excluded from
    // `loadSubscription`, so the paid row can't be picked on a later request
    // either.
    subscription = await loadSubscription(userId);
    if (!subscription) {
      await ensureFreeSubscription(userId);
      subscription = await loadSubscription(userId);
      if (!subscription) {
        throw new HttpError(500, "Could not resolve your membership. Try again.");
      }
    }
  }

  const currentUsage = subscription.usagePeriods[0] ?? null;

  return {
    planKey: subscription.plan.key as PlanKey,
    planName: subscription.plan.name,
    status: subscription.status as SubscriptionStatus,
    startedAt: subscription.startedAt,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    usage: toUsageDto(currentUsage),
    stripeCustomerId: subscription.stripeCustomerId,
    subscriptionId: subscription.id,
  };
}

/** 402 with a code and the live counter, so a panel can say exactly what's left. */
function exhausted(usage: AiUsageDto, planKey: PlanKey): HttpError {
  const message =
    planKey === FREE
      ? "You've used all of your free AI actions. Upgrade to keep going."
      : "You've used every AI action in this plan.";

  return new HttpError(402, message, { code: ALLOWANCE_EXHAUSTED, usage });
}

export type ConsumedAction = {
  /** Picks the model for this caller's tier — passed to `@repo/ai` as context. */
  planKey: PlanKey;
  /** The counter *after* this action, which is what the response should carry. */
  usage: AiUsageDto;
};

/**
 * Spends one AI action, or refuses.
 *
 * The whole point of this function is the transaction. Read-decide-write on a
 * counter is the textbook double-spend: two requests both read "1 remaining",
 * both decide yes, both write 10 of 10, and one action is given away. Prisma's
 * interactive transaction plus an `updateMany` whose WHERE re-checks the
 * headroom closes it — the update either matches a row that still has room, or
 * matches nothing, and Postgres serializes the two writes against the same row.
 * The conditional WHERE is doing the real work here, not the isolation level:
 * the loser of the race sees `count === 0` and is refused, rather than reading a
 * stale count and trusting it.
 *
 * `purpose` is not metered differently — Section 0 is explicit that a chat turn
 * and a cover letter cost the user the same one action even though they cost us
 * differently. It's taken so the signature reads as the spec writes it, and so a
 * per-purpose weight later is a change inside this function.
 */
export async function checkAndConsumeAiAction(
  userId: string,
  purpose: AiPurpose,
): Promise<ConsumedAction> {
  void purpose;

  const entitlement = await resolveEntitlement(userId);

  const consumed = await prisma.$transaction(async (tx) => {
    const usage = await tx.userAiUsage.findFirst({
      where: { subscriptionId: entitlement.subscriptionId },
      orderBy: { createdAt: "desc" },
    });

    if (!usage) return null;

    const { count } = await tx.userAiUsage.updateMany({
      where: {
        id: usage.id,
        // The guard. Without it this is a blind increment and the counter can
        // exceed the grant under concurrency.
        allowanceConsumed: { lt: usage.allowanceGranted },
      },
      data: { allowanceConsumed: { increment: 1 } },
    });

    if (count === 0) return null;

    return {
      allowanceGranted: usage.allowanceGranted,
      allowanceConsumed: usage.allowanceConsumed + 1,
      periodEnd: usage.periodEnd,
    };
  });

  if (!consumed) throw exhausted(entitlement.usage, entitlement.planKey);

  return { planKey: entitlement.planKey, usage: toUsageDto(consumed) };
}

/**
 * Gives back an action that was charged for work that then didn't happen, and
 * returns the restored counter.
 *
 * Two of the four metered features are hybrids: ATS scoring and JD matching both
 * have a deterministic half that always runs and an AI half that may not. Those
 * routes consume up front — the check has to precede the call, or the provider
 * is already paid by the time we notice the user was out — and refund when the
 * AI half turns out not to have run. Charging for a provider outage is the kind
 * of small unfairness that costs more trust than the action is worth.
 *
 * Returns the usage so the caller can send the corrected number back rather than
 * doing the subtraction itself; two routes doing that arithmetic is two places
 * for the displayed count to disagree with the database.
 *
 * Best-effort: a failed refund must not convert a successful response into an
 * error. The user keeps their result, we're out one action we shouldn't have
 * taken, and the response reports whatever the row actually says.
 */
export async function refundAiAction(userId: string): Promise<AiUsageDto> {
  try {
    const usage = await prisma.userAiUsage.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    if (!usage) return toUsageDto(null);
    if (usage.allowanceConsumed <= 0) return toUsageDto(usage);

    // Guarded rather than a blind decrement, for the same reason the consume is:
    // the floor has to hold even when two refunds race.
    const { count } = await prisma.userAiUsage.updateMany({
      where: { id: usage.id, allowanceConsumed: { gt: 0 } },
      data: { allowanceConsumed: { decrement: 1 } },
    });

    return toUsageDto(
      count === 0 ? usage : { ...usage, allowanceConsumed: usage.allowanceConsumed - 1 },
    );
  } catch (error) {
    console.error("Failed to refund an AI action:", error);
    return toUsageDto(null);
  }
}
