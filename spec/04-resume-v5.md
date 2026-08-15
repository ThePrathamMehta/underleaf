# CLAUDE.md — Underleaf v5: Membership, Billing & AI Usage Metering

This is a follow-up spec to v1 (initial build), v2 (bug fixes, editor overhaul, OAuth), v3 (profession-based templates, PDF upload & edit), and v4 (AI chat assistant, ATS scoring, JD matching, cover letters). It assumes v1–v4 are in place, including the shared `packages/ai` provider layer, admin-configurable `AiProviderConfig` (scoped by `purpose`: `chat | ats | jdMatch | coverLetter`), and `AiUsageLog` recording tokens per call per user per purpose.

v5 adds membership tiers and meters the parts of the product that cost real money to run. **Do not change fonts or the app's visual design language** — the pricing/billing surfaces are new pages, not a redesign, and should look like the same product (v1 Section 6), not a bolted-on SaaS pricing table.

---

## 0. The pricing decision this spec is built on

This section exists so the "why" isn't lost — read it before touching the schema.

- **Monthly subscription is the primary paid vehicle, not a one-time/lifetime purchase.** Every paid feature in Underleaf (chat, AI-assisted ATS suggestions, "Apply with AI," cover letters) has a recurring per-call cost to us. A lifetime price only works when the thing you're selling has near-zero marginal cost; ours doesn't, so a lifetime buyer with heavy usage is a permanent liability with nothing fixed-cost in the paid tier to offset it.
- **The free tier is drawn along the same line the codebase already draws:** free wherever a feature costs us nothing (deterministic, no AI call), paid wherever it burns tokens.
  - **Free, unlimited:** resume creation/editing, PDF upload & edit, PDF export, rule-based ATS score (v4 Section 2.2's deterministic checks), JD keyword match/diff (v4 Section 3.3's deterministic part).
  - **Metered:** chat assistant turns, AI-assisted ATS suggestions, "Apply with AI," cover letter generation.
- **Free AI usage is a one-time allowance (~10 actions), not a monthly refill.** Résumé writing is bursty — people job-hunt hard for a few weeks and disappear for a year or two. A monthly refill lets a patient burst user simply wait it out across allowance resets; a one-time grant forces the upgrade decision at the moment willingness to pay is highest, and it's honest to label as a trial.
- **A secondary, fixed-term prepaid option — a "Job Search Pass" — exists alongside the monthly plan** to capture users who want the "one payment, no cancel-anxiety" feeling without the unbounded cost exposure of true lifetime access. It's paid once, has a generous but finite AI allowance, and expires on a fixed date regardless of usage.
- **Meter in actions, not tokens.** "1 chat turn," "1 cover letter" is something a user can reason about; a token balance creates constant meter-anxiety mid-task. Token cost is still tracked internally via the existing `AiUsageLog` — that's an operating-cost concern, not a user-facing one.
- **All numbers below (prices, allowance counts) are provisional starting points, not final.** Ship with a reasonable guess, watch the real per-user token distribution in `AiUsageLog` for a few weeks, then tune the caps from data rather than intuition.

---

## 1. New infrastructure requirement: a payment provider

v1–v4 never touched money. Recommend **Stripe** — native support for recurring subscriptions, one-time fixed-term purchases, webhooks, and a hosted customer portal for self-serve cancellation/payment-method changes, which avoids building billing UI by hand. Flag as a new dependency to confirm with the user before starting, same as the blob-storage addition in v3.

- Env vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY` (exposed to `apps/web` for Checkout redirect only — no card data ever touches our servers).
- Use Stripe Checkout (hosted) for the initial purchase flow and the Stripe Customer Portal for plan management, rather than building custom card-collection UI — matches the "don't build billing infra you don't have to" spirit of keeping v5 scoped.

---

## 2. Data model (`packages/db`)

- **`Plan`** — `id`, `key` (`'free' | 'pro_monthly' | 'job_search_pass'`), `name`, `priceCents`, `billingInterval` (`'month' | 'one_time' | null` for free), `durationDays` (nullable — set for `job_search_pass`, defines its fixed expiry), `aiActionAllowance` (int — the number of metered actions the plan grants per period, or once for free/pass plans), `isRenewing` (bool — true only for `pro_monthly`), `stripePriceId` (nullable, null for free).
- **`Subscription`** — `id`, `userId`, `planId`, `status` (`'active' | 'canceled' | 'expired' | 'past_due'`), `startedAt`, `currentPeriodEnd` (nullable — null for the free plan, which doesn't expire), `stripeSubscriptionId` (nullable), `stripeCustomerId`. Every user has exactly one `active` `Subscription` at a time; a new signup gets an explicit `free`-plan row created immediately (simpler downstream lookups than treating "no subscription" as an implicit free state).
- **`UserAiUsage`** — `id`, `userId`, `subscriptionId`, `allowanceGranted`, `allowanceConsumed`, `periodStart`, `periodEnd` (nullable — null for the free plan's one-time grant, which never refills), `updatedAt`. One row represents the currently active grant; a new row is created on each monthly renewal (via webhook) or on any new paid purchase, so historical usage per period is preserved rather than overwritten.

---

## 3. Metering & enforcement

### 3.1 What counts as one billable "action"
One chat turn (a user message plus the assistant's full response, regardless of how many tool calls happen within it), one AI-assisted ATS check, one "Apply with AI" application, one cover letter generation or regeneration. The deterministic rule-based ATS score and the deterministic JD keyword diff (v4 Sections 2.2 and 3.3) are never metered — unlimited on every plan, including free.

### 3.2 Enforcement point
A single shared helper, `checkAndConsumeAiAction(userId, purpose)`, called at the top of every route that invokes `packages/ai`: `POST /resumes/:id/chat`, the AI-assisted ATS pass, the JD "Apply with AI" action, and cover letter generation. It:
1. Loads the user's active `UserAiUsage` row.
2. If `allowanceConsumed >= allowanceGranted`, rejects with a specific error code (not a generic 500) that the frontend maps to an upgrade prompt.
3. Otherwise increments `allowanceConsumed` and lets the request proceed — inside a transaction/row lock, so two concurrent requests can't both read "1 remaining" and both succeed, double-spending the last action.

### 3.3 Renewal and expiry
- **Pro Monthly:** a Stripe `invoice.payment_succeeded` webhook creates a new `UserAiUsage` row for the new period on each renewal; a lapsed/failed payment (`past_due`/`canceled` webhook events) downgrades the user's effective plan resolution back to `free` until resolved.
- **Free:** the one-time grant is created once, at signup, and never refreshed.
- **Job Search Pass:** a single `UserAiUsage` row created at purchase, `periodEnd = startedAt + durationDays`. It expires by date, independent of how much of the allowance was actually used — that's the tradeoff the user is buying by prepaying, and it should be stated plainly on the pricing page.

---

## 4. Plan-aware AI model routing

Extend v4 Section 0's `resolveModel(purpose)` in `packages/ai` to `resolveModel(purpose, planKey)`. Add an optional `planKey` field to `AiProviderConfig` (`null` = applies to all plans) so the admin can, for example, route free-tier chat to a smaller/cheaper model and paid-tier chat to a stronger one — same product behavior to the metering logic above, lower real cost on the tier that doesn't pay. This is a small, additive extension of existing admin config, not a new system.

Pair this with **prompt caching** for the parts of every AI call that are identical turn-to-turn (system prompt, tool schemas from v4 Section 1.2) — a straightforward backend win that reduces per-action cost regardless of plan, and makes the free tier's fixed allowance cheaper to give away.

---

## 5. API (`apps/api`)

- `GET /billing/plans` — public, lists purchasable plans (excludes internal fields like `stripePriceId`).
- `POST /billing/checkout` — body: `planId`; creates a Stripe Checkout session, returns the redirect URL.
- `POST /billing/webhook` — Stripe webhook endpoint (subscription created/updated/canceled, invoice payment succeeded/failed, checkout session completed); this is what actually creates/updates `Subscription` and `UserAiUsage` rows — never trust the client-side redirect alone to mean payment succeeded.
- `GET /billing/subscription` — current user's active plan, usage this period (`allowanceConsumed`/`allowanceGranted`), and renewal or expiry date.
- `POST /billing/cancel` — cancels at period end (Stripe `cancel_at_period_end: true`), so a Pro Monthly subscriber keeps access through what they already paid for.
- All existing resume/chat/ATS/JD/cover-letter routes are unchanged in shape; the metering middleware from Section 3.2 wraps only the AI-calling ones.

---

## 6. Frontend (`apps/web`)

- **New `/pricing` page:** a plan comparison (Free / Pro Monthly / Job Search Pass) in the app's existing editorial design language — not a generic three-column SaaS pricing table with checkmark icons and a "Most Popular" ribbon. State the Job Search Pass's fixed-expiry tradeoff plainly, not in fine print.
- **Visible usage indicator** wherever a metered action lives (chat panel, AI-ATS panel, JD "Apply with AI," cover letter flow): "X of Y AI actions left." Shown continuously, not hidden until the wall is hit — a burst user should see it coming rather than be surprised mid-task.
- **Contextual upgrade prompt on block:** when `checkAndConsumeAiAction` rejects a request, the relevant panel shows a specific inline message in context (e.g., the chat panel's message area reads "You've used all your free AI actions — upgrade to keep going," linking to `/pricing`) — not a global interrupting modal or a generic toast.
- **Account/settings area:** current plan, renewal or expiry date, "Manage billing" (links to the Stripe Customer Portal), cancel action.
- **Signup:** every new user gets an explicit `free`-plan `Subscription` row created at account creation (Section 2), so `getActivePlan(userId)` never has to special-case "no subscription found."

---

## 7. Non-goals for v5

- No annual plan in this pass — a reasonable addition once a few months of Pro Monthly usage data exist to price it against.
- No team/organization billing — single-user plans only.
- No usage-based overage billing (pay-per-extra-action past the cap) — hitting the cap means upgrading to a different plan, not an à la carte top-up, to keep the mental model simple.
- No regional/localized pricing in this pass — flagged in the original discussion as a bigger conversion lever than monthly-vs-one-time, but it's separate scope from standing up billing at all.
- No proration edge cases beyond what Stripe Checkout/Billing handles by default.
- No separate "free trial of Pro" flow — the free plan's one-time AI allowance already serves that purpose, and running both would blur why a user is being asked to upgrade.

---

## Suggested Execution Order

1. Stripe account/keys set up, confirm plan pricing/allowance numbers with the user (Section 0's numbers are placeholders).
2. Data model: `Plan`, `Subscription`, `UserAiUsage`, seed the three plans.
3. `checkAndConsumeAiAction` + wire it into all four metered routes from v4 (chat, AI-ATS, Apply with AI, cover letter) — this is the only backend change that touches existing v4 code paths.
4. Billing API: checkout, webhook handler, subscription status, cancel.
5. `resolveModel(purpose, planKey)` extension + prompt caching (Section 4) — cost optimization, can ship slightly after the metering logic itself is correct.
6. Frontend: `/pricing`, usage indicators, contextual upgrade prompts, account/settings billing section.
7. Watch `AiUsageLog` for a few weeks post-launch, then revisit the allowance/price numbers from real data.

---

## Definition of Done

- New signups get a `free` plan automatically, with unlimited resume/editing/PDF/export access and unlimited deterministic ATS + JD-match, per Section 0.
- The free plan's AI allowance is granted once and never silently refills.
- Every metered AI action (chat turn, AI-ATS check, Apply with AI, cover letter generation) is blocked correctly and exactly once the allowance is exhausted — verified under concurrent requests, not just sequential ones.
- Stripe webhook handling is the source of truth for subscription state — a client-side "success" redirect alone never grants access.
- Pro Monthly renews correctly and creates a fresh usage period; a failed/lapsed payment correctly downgrades access.
- Job Search Pass expires by date regardless of remaining unused allowance, and this is clearly communicated on `/pricing` before purchase.
- Cancel-at-period-end preserves access through the already-paid period.
- No raw payment data (card numbers, etc.) ever touches `apps/api` — Stripe Checkout/Portal only.
- Usage indicators and upgrade prompts are visible and contextual, not hidden or generic, per Section 6.
- No new console errors/warnings; `/pricing` and account/billing pages responsive at tablet width, consistent with the rest of the app's existing responsive scope.