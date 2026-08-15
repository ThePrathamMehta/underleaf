import { prisma } from "@repo/db";
import { PLAN_DEFAULTS } from "@repo/types";
import {
  activatePaidPlan,
  claimStripeEvent,
  expireSubscription,
  renewSubscriptionPeriod,
  syncSubscriptionState,
} from "../src/services/billing.js";
import {
  checkAndConsumeAiAction,
  ensureFreeSubscription,
  resolveEntitlement,
} from "../src/services/entitlements.js";

/**
 * The membership lifecycle (v5 Definition of Done).
 *
 * Two claims are checked here that the metering script can't reach, because both
 * are about what a *webhook* does rather than what a request does:
 *
 *   1. Cancelling at period end preserves access until the period actually ends.
 *      The spec is explicit that a user keeps what they paid for, and the bug it
 *      guards against — treating `cancel_at_period_end` as "revoke now" — looks
 *      correct in every code review and is only visible in the resolved
 *      entitlement.
 *   2. A replayed Stripe event grants nothing twice. Stripe retries until it
 *      sees a 2xx and may deliver the same event regardless, so a second
 *      `invoice.paid` for one period would otherwise be a free month of actions.
 *
 *   bun run --cwd apps/api scripts/check-lifecycle.ts
 *
 * Expect `prisma:error` blocks around the replay check: a duplicate-key conflict
 * is how `claimStripeEvent` recognises an event it has already handled, and
 * Prisma logs it before the catch that handles it. The check lines are the
 * verdict, not the noise.
 *
 * Stripe is never called. Every function under test takes the values a verified
 * webhook would have carried, which is the whole point of `billing.ts` accepting
 * plain arguments rather than Stripe objects — the lifecycle stays testable
 * without a network or a test-mode key.
 */

const PRO = PLAN_DEFAULTS.pro_monthly.aiActionAllowance;
const PASS = PLAN_DEFAULTS.job_search_pass.aiActionAllowance;

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label} — got ${actual}, expected ${expected}`);
}

async function makeUser(tag: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `lifecycle-${tag}-${process.pid}-${performance.now().toString(36)}@example.invalid`,
      name: "Lifecycle probe",
      passwordHash: null,
    },
    select: { id: true },
  });

  await ensureFreeSubscription(user.id);
  return user.id;
}

async function destroyUser(userId: string): Promise<void> {
  await prisma.user.delete({ where: { id: userId } }).catch(() => {
    // The cascade may already have taken it; nothing here is worth failing over.
  });
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

/** A fake Stripe id, unique per run so reruns don't collide on the unique column. */
function stripeId(kind: string): string {
  return `${kind}_probe_${process.pid}_${performance.now().toString(36).replace(".", "")}`;
}

/**
 * Every id this run invented, so the replay check can clean up after itself.
 *
 * `StripeEvent` rows are keyed by Stripe's event id and hang off nothing — no
 * user, no subscription — so deleting the throwaway user doesn't take them with
 * it, and a script run daily would slowly fill the table with `evt_probe_…`.
 */
const claimedEvents: string[] = [];

function eventId(): string {
  const id = stripeId("evt");
  claimedEvents.push(id);
  return id;
}

/**
 * Cancel-at-period-end keeps access, and the period ending takes it away.
 *
 * The interesting moment is the middle one: cancelled, but not yet ended. That
 * is the state the spec cares about and the one a naive implementation gets
 * wrong, so it is asserted on the resolved entitlement — what a metered route
 * would actually see — rather than on the row.
 */
async function testCancelPreservesAccess(): Promise<void> {
  console.log("\nCancel at period end");
  const userId = await makeUser("cancel");
  const subscriptionId = stripeId("sub");

  try {
    await activatePaidPlan({
      userId,
      planKey: "pro_monthly",
      stripeCustomerId: stripeId("cus"),
      stripeSubscriptionId: subscriptionId,
      currentPeriodEnd: daysFromNow(20),
    });

    const paid = await resolveEntitlement(userId);
    check("on pro after checkout", paid.planKey, "pro_monthly");
    check("granted the pro allowance", paid.usage.granted, PRO);

    // customer.subscription.updated with cancel_at_period_end: the user clicked
    // cancel, Stripe agreed, the period has 20 days left on it.
    await syncSubscriptionState({
      stripeSubscriptionId: subscriptionId,
      stripeStatus: "active",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: daysFromNow(20),
    });

    const cancelled = await resolveEntitlement(userId);
    check("still on pro", cancelled.planKey, "pro_monthly");
    check("marked as cancelling", cancelled.cancelAtPeriodEnd, true);
    check("keeps the allowance", cancelled.usage.remaining, PRO);

    // And the actions still spend — the assertion that matters, since a status
    // the entitlement reports but the meter refuses would be a worse bug than
    // either alone.
    const spent = await checkAndConsumeAiAction(userId, "chat");
    check("can still spend", spent.usage.remaining, PRO - 1);
    check("still routed as pro", spent.planKey, "pro_monthly");

    // The period ends: customer.subscription.deleted.
    await expireSubscription(subscriptionId);

    const lapsed = await resolveEntitlement(userId);
    check("falls back to free", lapsed.planKey, "free");
    // The free grant they never spent, not a fresh one: they were moved onto pro
    // before spending any of it.
    check("keeps unspent free actions", lapsed.usage.remaining, PLAN_DEFAULTS.free.aiActionAllowance);
  } finally {
    await destroyUser(userId);
  }
}

/**
 * A pass that runs out of days, rather than out of actions.
 *
 * Expiry is applied on read, so the check is that a past `currentPeriodEnd`
 * retires the plan the next time anyone asks — without a scheduled job having
 * run, because there isn't one.
 */
async function testPassExpiresByDate(): Promise<void> {
  console.log("\nJob Search Pass expiry");
  const userId = await makeUser("pass");

  try {
    await activatePaidPlan({
      userId,
      planKey: "job_search_pass",
      stripeCustomerId: stripeId("cus"),
      stripeSubscriptionId: null,
      currentPeriodEnd: daysFromNow(60),
    });

    const active = await resolveEntitlement(userId);
    check("on the pass", active.planKey, "job_search_pass");
    check("granted the pass allowance", active.usage.granted, PASS);

    // Backdate rather than wait 60 days. Both the subscription and its grant get
    // the past date, because a real expiry has both.
    const past = daysFromNow(-1);
    await prisma.subscription.updateMany({
      where: { userId, status: "active", plan: { key: "job_search_pass" } },
      data: { currentPeriodEnd: past },
    });
    await prisma.userAiUsage.updateMany({ where: { userId }, data: { periodEnd: past } });

    const expired = await resolveEntitlement(userId);
    check("falls back to free", expired.planKey, "free");

    const row = await prisma.subscription.findFirst({
      where: { userId, plan: { key: "job_search_pass" } },
      select: { status: true },
    });
    check("pass row retired", row?.status, "expired");
  } finally {
    await destroyUser(userId);
  }
}

/**
 * The same event delivered twice must grant one period, not two.
 *
 * `claimStripeEvent` is the guard, and it is checked against a renewal because
 * that is the replay that would actually pay out: a duplicated `invoice.paid`
 * opening a second usage period is a free month of actions.
 */
async function testReplayedWebhook(): Promise<void> {
  console.log("\nReplayed Stripe event");
  const userId = await makeUser("replay");
  const subscriptionId = stripeId("sub");
  const replayed = eventId();

  try {
    await activatePaidPlan({
      userId,
      planKey: "pro_monthly",
      stripeCustomerId: stripeId("cus"),
      stripeSubscriptionId: subscriptionId,
      currentPeriodEnd: daysFromNow(30),
    });

    check("first delivery claims", await claimStripeEvent(replayed, "invoice.paid"), true);
    check("replay is refused", await claimStripeEvent(replayed, "invoice.paid"), false);

    // Two simultaneous deliveries — Stripe does this — must resolve the same way.
    const concurrent = await Promise.all([
      claimStripeEvent(eventId(), "invoice.paid"),
      claimStripeEvent(replayed, "invoice.paid"),
    ]);
    check("concurrent replay refused", concurrent[1], false);

    // The renewal itself, applied once as the route would.
    await renewSubscriptionPeriod({
      stripeSubscriptionId: subscriptionId,
      currentPeriodEnd: daysFromNow(60),
    });

    const periods = await prisma.userAiUsage.count({ where: { userId } });
    // Three: the free grant from signup, the checkout's period, the renewal's.
    check("usage periods opened", periods, 3);

    const renewed = await resolveEntitlement(userId);
    check("renewed to a full allowance", renewed.usage.remaining, PRO);
  } finally {
    await destroyUser(userId);
    await prisma.stripeEvent.deleteMany({ where: { id: { in: claimedEvents } } });
  }
}

/**
 * Buying the pass while on Pro doesn't leave two paid memberships standing.
 *
 * `activatePaidPlan` expires the previous paid row in the same transaction, which
 * is also what keeps the new partial unique index satisfiable — and the free row
 * has to survive it, because a lapsing pass lands back on whatever free actions
 * were never spent.
 */
async function testUpgradeRetiresPrevious(): Promise<void> {
  console.log("\nSwitching plans");
  const userId = await makeUser("switch");

  try {
    await activatePaidPlan({
      userId,
      planKey: "pro_monthly",
      stripeCustomerId: stripeId("cus"),
      stripeSubscriptionId: stripeId("sub"),
      currentPeriodEnd: daysFromNow(30),
    });

    await activatePaidPlan({
      userId,
      planKey: "job_search_pass",
      stripeCustomerId: stripeId("cus"),
      stripeSubscriptionId: null,
      currentPeriodEnd: daysFromNow(60),
    });

    const active = await prisma.subscription.findMany({
      where: { userId, status: "active" },
      include: { plan: true },
    });

    check("active memberships", active.length, 2);
    check(
      "the paid one is the pass",
      active.filter((row) => row.plan.key !== "free")[0]?.plan.key,
      "job_search_pass",
    );
    check("free row survives", active.some((row) => row.plan.key === "free"), true);

    const entitlement = await resolveEntitlement(userId);
    check("resolves to the pass", entitlement.planKey, "job_search_pass");
  } finally {
    await destroyUser(userId);
  }
}

async function main(): Promise<void> {
  console.log("Membership lifecycle checks · no Stripe calls");

  await testCancelPreservesAccess();
  await testPassExpiresByDate();
  await testReplayedWebhook();
  await testUpgradeRetiresPrevious();

  console.log(failures === 0 ? "\nAll lifecycle checks passed." : `\n${failures} check(s) failed.`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

await main();
