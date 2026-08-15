import { prisma } from "@repo/db";
import { PLAN_DEFAULTS } from "@repo/types";
import {
  checkAndConsumeAiAction,
  ensureFreeSubscription,
  refundAiAction,
  resolveEntitlement,
} from "../src/services/entitlements.js";

/**
 * Metering under concurrency (v5 Definition of Done).
 *
 * The claim being tested is narrow and worth stating precisely: N simultaneous
 * requests against an allowance of K must let exactly min(N, K) through. The
 * naive read-decide-write passes a single-threaded test and fails this one, so
 * it is the only test worth writing here — a sequential check would confirm
 * arithmetic nobody doubted.
 *
 *   bun run --cwd apps/api scripts/check-metering.ts
 *
 * Expect `prisma:error` blocks in the output — a unique violation on the grant
 * and a transaction timeout under the 30-caller burst are both outcomes this
 * script provokes on purpose, and Prisma logs them before the code that handles
 * them ever sees them. The check lines below are the verdict, not the noise.
 *
 * Runs against the configured DATABASE_URL and cleans up after itself: every
 * row it creates hangs off one throwaway user, deleted in `finally` whether the
 * assertions pass or not.
 */

const FREE_ALLOWANCE = PLAN_DEFAULTS.free.aiActionAllowance;

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label} — got ${actual}, expected ${expected}`);
}

async function makeUser(tag: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `metering-${tag}-${process.pid}-${performance.now().toString(36)}@example.invalid`,
      name: "Metering probe",
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

type Burst = {
  allowed: number;
  /** Refused with 402 — the deliberate outcome. */
  refused: number;
  /** Anything else: a transaction that timed out contending for the row. */
  errored: number;
};

/**
 * Spends `n` actions at once and classifies every outcome.
 *
 * Errors are counted rather than lumped in with refusals because they mean
 * different things. A 402 is the guard working; a transaction timeout is the
 * connection pool buckling under a burst this artificial, and it must not be
 * read as evidence that the allowance held.
 */
async function spendConcurrently(userId: string, n: number): Promise<Burst> {
  const results = await Promise.allSettled(
    Array.from({ length: n }, () => checkAndConsumeAiAction(userId, "chat")),
  );

  const burst: Burst = { allowed: 0, refused: 0, errored: 0 };

  for (const result of results) {
    if (result.status === "fulfilled") burst.allowed += 1;
    else if ((result.reason as { status?: number })?.status === 402) burst.refused += 1;
    else burst.errored += 1;
  }

  return burst;
}

/**
 * The double-spend case: far more callers than actions, all at once.
 *
 * The assertion that matters is the ceiling, not the exact number. Overselling
 * is the bug this exists to catch and it can only ever show up as `allowed >
 * granted`; a caller whose transaction timed out under the burst was never
 * charged, so `allowed` can legitimately land short. `granted` is read back from
 * the row rather than assumed, because comparing against a constant would pass
 * even if the grant itself had been written wrong.
 */
async function testOverSubscribed(): Promise<void> {
  console.log(`\nConcurrent spend, ${FREE_ALLOWANCE * 3} callers against ${FREE_ALLOWANCE} actions`);
  const userId = await makeUser("burst");

  try {
    const burst = await spendConcurrently(userId, FREE_ALLOWANCE * 3);
    console.log(
      `       ${burst.allowed} allowed · ${burst.refused} refused · ${burst.errored} errored`,
    );

    check("never oversells", burst.allowed <= FREE_ALLOWANCE, true);
    check("refuses the rest", burst.allowed + burst.refused + burst.errored, FREE_ALLOWANCE * 3);

    const row = await prisma.userAiUsage.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    check("consumed matches allowed", row?.allowanceConsumed, burst.allowed);
    check("never exceeds grant", (row?.allowanceConsumed ?? 0) <= (row?.allowanceGranted ?? 0), true);

    // Spend whatever the timeouts left, so the exhausted state below is reached
    // regardless of how the burst landed.
    while ((await resolveEntitlement(userId)).usage.remaining > 0) {
      await checkAndConsumeAiAction(userId, "chat");
    }

    const entitlement = await resolveEntitlement(userId);
    check("remaining reported", entitlement.usage.remaining, 0);

    // The next one is refused, which is the state the four panels render a wall
    // for. Checked here rather than inferred from the count above, because the
    // status code is part of the contract.
    const refused = await checkAndConsumeAiAction(userId, "chat").then(
      () => null,
      (error: { status?: number; body?: { code?: string } }) => error,
    );
    check("refusal status", refused?.status, 402);
    check("refusal code", refused?.body?.code, "allowance_exhausted");
  } finally {
    await destroyUser(userId);
  }
}

/** Fewer callers than actions: everyone through, counter exact. */
async function testUnderSubscribed(): Promise<void> {
  const callers = Math.max(1, FREE_ALLOWANCE - 4);
  console.log(`\nConcurrent spend, ${callers} callers against ${FREE_ALLOWANCE} actions`);
  const userId = await makeUser("partial");

  try {
    const burst = await spendConcurrently(userId, callers);
    check("none refused", burst.refused, 0);
    check("none errored", burst.errored, 0);
    check("actions allowed", burst.allowed, callers);

    const entitlement = await resolveEntitlement(userId);
    check("remaining reported", entitlement.usage.remaining, FREE_ALLOWANCE - callers);
  } finally {
    await destroyUser(userId);
  }
}

/**
 * Refunds race too.
 *
 * ATS and JD consume up front and refund when the AI half didn't run, so two
 * refunds landing together must not drive the counter below zero — the same
 * guard as the consume, in the other direction.
 */
async function testConcurrentRefunds(): Promise<void> {
  console.log("\nConcurrent refunds against a counter at 1");
  const userId = await makeUser("refund");

  try {
    await checkAndConsumeAiAction(userId, "ats");

    await Promise.all([refundAiAction(userId), refundAiAction(userId), refundAiAction(userId)]);

    const row = await prisma.userAiUsage.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    check("consumed floors at zero", row?.allowanceConsumed, 0);

    const entitlement = await resolveEntitlement(userId);
    check("remaining restored", entitlement.usage.remaining, FREE_ALLOWANCE);
  } finally {
    await destroyUser(userId);
  }
}

/** Two signups for one account must not grant the allowance twice. */
async function testIdempotentGrant(): Promise<void> {
  console.log("\nConcurrent free-plan grants for one account");

  const user = await prisma.user.create({
    data: {
      email: `metering-grant-${process.pid}-${performance.now().toString(36)}@example.invalid`,
      name: "Metering probe",
      passwordHash: null,
    },
    select: { id: true },
  });

  try {
    await Promise.allSettled([
      ensureFreeSubscription(user.id),
      ensureFreeSubscription(user.id),
      ensureFreeSubscription(user.id),
    ]);

    const subscriptions = await prisma.subscription.count({
      where: { userId: user.id, status: "active" },
    });
    check("active subscriptions", subscriptions, 1);

    const entitlement = await resolveEntitlement(user.id);
    check("granted once", entitlement.usage.granted, FREE_ALLOWANCE);
  } finally {
    await destroyUser(user.id);
  }
}

async function main(): Promise<void> {
  console.log(`Metering checks · free allowance is ${FREE_ALLOWANCE} actions`);

  await testOverSubscribed();
  await testUnderSubscribed();
  await testConcurrentRefunds();
  await testIdempotentGrant();

  console.log(failures === 0 ? "\nAll metering checks passed." : `\n${failures} check(s) failed.`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

await main();
