-- At most one active subscription per user per plan.
--
-- `ensureFreeSubscription` looks for an existing active row before it creates
-- one, which is a read-then-write and therefore racy: a double-submitted signup
-- granted the free allowance twice, and a concurrency check caught it doing so —
-- including once on a real account, whose two free rows were created 153ms
-- apart. The guard belongs in the database, because that is the only place two
-- requests can be ordered against each other.
--
-- Scoped to (userId, planId) rather than (userId) on purpose. A paid user keeps
-- their free row alive alongside the paid one — it holds whatever free actions
-- they never spent, and they land back on it when a pass lapses — so "one active
-- subscription per user" is not the invariant. "One active subscription per user
-- per plan" is. Re-purchasing the same plan still works: activatePaidPlan expires
-- the previous paid row in the same transaction before inserting the new one.

-- Retire the duplicates the race already created, keeping one row per group.
--
-- Expired rather than deleted: the usage rows hang off these subscriptions and
-- are what a later pass at tuning the allowance numbers reads, so throwing them
-- away would discard evidence to fix a bookkeeping error. `expired` is excluded
-- from every entitlement lookup, so a retired row grants nothing.
--
-- The survivor is the most-spent row, tie-broken by age. Keeping the emptiest
-- would hand anyone caught by this bug a fresh allowance on top of the one they
-- had already partly used; keeping the fullest costs them nothing they hadn't
-- already spent.

-- The two statements below must land together, and they do without an explicit
-- BEGIN: Prisma wraps each migration file in a transaction on Postgres, and
-- `db:deploy:neon` does the same so the DDL and its bookkeeping row commit as
-- one. An explicit COMMIT here would close that outer transaction early.

UPDATE "Subscription" AS s
SET "status" = 'expired'
WHERE s."status" = 'active'
  AND s."id" NOT IN (
    SELECT DISTINCT ON (keep."userId", keep."planId") keep."id"
    FROM "Subscription" AS keep
    LEFT JOIN LATERAL (
      SELECT COALESCE(MAX(u."allowanceConsumed"), 0) AS spent
      FROM "UserAiUsage" AS u
      WHERE u."subscriptionId" = keep."id"
    ) AS usage ON TRUE
    WHERE keep."status" = 'active'
    ORDER BY keep."userId", keep."planId", usage.spent DESC, keep."createdAt" ASC
  );

-- Partial, so the expired and canceled history stays unconstrained.
CREATE UNIQUE INDEX "Subscription_userId_planId_active_key"
    ON "Subscription"("userId", "planId")
    WHERE "status" = 'active';
