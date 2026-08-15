-- Repricing: Pro Monthly $9 -> $5, Job Search Pass $29 -> $10.
--
-- Prices live in the row, not in code. `PLAN_DEFAULTS` is what a plan is
-- *created* with, and `seedPlans` deliberately never overwrites `priceCents` on a
-- re-run so that tuning done from real usage isn't reset by the next deploy. That
-- is the right default and it means a live price change takes a migration. This
-- is that migration.
--
-- Guarded on the old amount, which makes it a no-op in two situations that both
-- matter: on a fresh database the table is still empty when this runs (the seed
-- comes afterwards and will create the rows at the new defaults), and on a
-- database where an operator has already tuned one of these by hand it leaves
-- that number alone rather than resetting it to one chosen weeks earlier.
--
-- What this does NOT change is what Stripe charges. The amount billed comes from
-- the Stripe Price object named by `stripePriceId`; `priceCents` is the number the
-- pricing page renders. The two have to move together — a new Price in Stripe and
-- its id in the environment — or the page quotes $5 while the checkout takes $9.

UPDATE "Plan" SET "priceCents" = 500  WHERE "key" = 'pro_monthly'     AND "priceCents" = 900;
UPDATE "Plan" SET "priceCents" = 1000 WHERE "key" = 'job_search_pass' AND "priceCents" = 2900;
