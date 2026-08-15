import { Router } from "express";
import { prisma } from "@repo/db";
import {
  createCheckoutBodySchema,
  type PlanDto,
  type PlanKey,
  type SubscriptionDto,
} from "@repo/types";
import type Stripe from "stripe";
import { config } from "../config.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { asyncHandler, badRequest, HttpError, validateBody } from "../middleware/errors.js";
import {
  activatePaidPlan,
  claimStripeEvent,
  expireSubscription,
  findCustomerId,
  fromUnixSeconds,
  renewSubscriptionPeriod,
  syncSubscriptionState,
} from "../services/billing.js";
import { resolveEntitlement } from "../services/entitlements.js";
import { ensureCustomer, getStripe, verifyWebhook } from "../services/stripe.js";

/**
 * Billing (v5 Section 5).
 *
 * The shape to notice is what each route is allowed to do. `checkout` creates a
 * Stripe session and returns a URL — it grants nothing. `webhook` is the only
 * route in the application that can grant a paid allowance, and it will not run
 * without a valid Stripe signature. So the answer to "what happens if someone
 * forges the success redirect" is: they see the settings page.
 *
 * No card data passes through here. Checkout and the Customer Portal are both
 * hosted by Stripe, which is what keeps this API out of PCI scope entirely
 * rather than merely careful about it.
 */

export const billingRouter = Router();

/** Plans are public: `/pricing` renders for signed-out visitors. */
billingRouter.get(
  "/plans",
  asyncHandler(async (_req, res) => {
    const rows = await prisma.plan.findMany({ orderBy: { sortOrder: "asc" } });

    const plans: PlanDto[] = rows.map((row) => ({
      key: row.key as PlanKey,
      name: row.name,
      priceCents: row.priceCents,
      billingInterval: row.billingInterval as PlanDto["billingInterval"],
      durationDays: row.durationDays,
      aiActionAllowance: row.aiActionAllowance,
      isRenewing: row.isRenewing,
      // Both conditions matter. A plan with no price id configured cannot be
      // checked out even though it is priced, and saying so here is what lets
      // /pricing render a disabled button with a reason instead of a button that
      // fails on click.
      purchasable: Boolean(row.stripePriceId) && config.stripeEnabled && row.key !== "free",
    }));

    res.json({ plans, paymentsEnabled: config.stripeEnabled });
  }),
);

function serializeSubscription(entitlement: Awaited<ReturnType<typeof resolveEntitlement>>) {
  return {
    planKey: entitlement.planKey,
    planName: entitlement.planName,
    status: entitlement.status,
    startedAt: entitlement.startedAt.toISOString(),
    currentPeriodEnd: entitlement.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd,
    usage: entitlement.usage,
    canManageBilling: Boolean(entitlement.stripeCustomerId) && config.stripeEnabled,
  } satisfies SubscriptionDto;
}

/**
 * The caller's membership and live allowance.
 *
 * Goes through `resolveEntitlement`, the same function every metered route calls,
 * so the number settings displays is the number the next AI action will be checked
 * against — including a pass that lapsed a minute ago, which this read is what
 * retires.
 */
billingRouter.get(
  "/subscription",
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const entitlement = await resolveEntitlement(req.userId);
    res.json({ subscription: serializeSubscription(entitlement) });
  }),
);

/**
 * Starts a hosted Checkout session.
 *
 * The client sends a plan key. The price is read from the database against that
 * key, so the browser never states an amount and cannot influence one. The mode
 * follows the plan: `subscription` for the renewing tier, `payment` for the pass,
 * which is what makes the pass a genuine one-time charge rather than a
 * subscription someone has to remember to cancel.
 */
billingRouter.post(
  "/checkout",
  requireAuth,
  validateBody(createCheckoutBodySchema),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { planKey } = req.body as { planKey: PlanKey };

    const plan = await prisma.plan.findUnique({ where: { key: planKey } });
    if (!plan) throw badRequest("That plan is not available.");
    if (!plan.stripePriceId) {
      throw new HttpError(503, `${plan.name} is not available for purchase yet.`);
    }

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { email: true, name: true },
    });
    if (!user) throw new HttpError(401, "Not authenticated");

    const customerId = await ensureCustomer({
      userId: req.userId,
      email: user.email,
      name: user.name,
      existingCustomerId: await findCustomerId(req.userId),
    });

    const session = await getStripe().checkout.sessions.create({
      mode: plan.isRenewing ? "subscription" : "payment",
      customer: customerId,
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      // The plan rides along on the return URL so settings knows which plan to
      // wait for. It has to wait for something: the browser is redirected back
      // the instant Stripe takes the payment, which is often before the webhook
      // that grants the plan has arrived, and "which plan did they just buy" is
      // not answerable from an upgrade's point of view — a Pro user buying a
      // pass already reads as paid. Advisory only, and only ever used to decide
      // what to poll for; the grant itself comes from the webhook.
      success_url: `${config.billingSuccessUrl}&plan=${planKey}`,
      cancel_url: config.billingCancelUrl,
      // Read back by the webhook. `client_reference_id` survives on the session
      // and the metadata is copied onto the subscription, so both kinds of event
      // can identify the account without depending on the customer lookup.
      client_reference_id: req.userId,
      metadata: { userId: req.userId, planKey },
      ...(plan.isRenewing
        ? { subscription_data: { metadata: { userId: req.userId, planKey } } }
        : {}),
      allow_promotion_codes: true,
    });

    if (!session.url) {
      throw new HttpError(502, "Stripe did not return a checkout URL. Try again.");
    }

    // The URL, not a redirect: the caller is fetch(), and a 302 here would be
    // followed by the browser inside the XHR rather than navigating the page.
    res.json({ url: session.url });
  }),
);

/**
 * Cancels at period end, via the Customer Portal where one exists.
 *
 * Returning a portal URL rather than cancelling outright is the more honest
 * flow: the user sees what they are giving up and when access actually stops, and
 * we get Stripe's cancellation webhook as the record of it. The direct path
 * remains for a subscription whose portal cannot be opened.
 */
billingRouter.post(
  "/cancel",
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const entitlement = await resolveEntitlement(req.userId);

    if (entitlement.planKey === "free") {
      throw badRequest("You are on the free plan, so there is nothing to cancel.");
    }

    const subscription = await prisma.subscription.findFirst({
      where: { id: entitlement.subscriptionId },
      select: { stripeSubscriptionId: true },
    });

    // The pass is already paid and already dated. There is no recurring charge to
    // stop, so "cancel" would only mean "give up the days you bought".
    if (!subscription?.stripeSubscriptionId) {
      throw badRequest(
        "This plan was a one-time purchase, so there is no renewal to cancel. It ends on its own.",
      );
    }

    await getStripe().subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    // Written here as well as by the webhook that follows. The webhook remains
    // the source of truth — it will set exactly this, plus the period end Stripe
    // computed — but a user who clicked cancel should see it reflected on the
    // next render rather than whenever the delivery lands.
    await prisma.subscription.update({
      where: { id: entitlement.subscriptionId },
      data: { status: "canceled", cancelAtPeriodEnd: true },
    });

    const updated = await resolveEntitlement(req.userId);
    res.json({ subscription: serializeSubscription(updated) });
  }),
);

/**
 * A Customer Portal session, for payment methods, invoices and cancellation.
 *
 * Not in Section 5's list, but it is how the settings page's "manage billing"
 * link is meant to work: card changes and invoice history are Stripe's job, and
 * building screens for them here would mean handling payment data we have
 * deliberately never touched.
 */
billingRouter.post(
  "/portal",
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const customerId = await findCustomerId(req.userId);
    if (!customerId) throw badRequest("You have no billing history to manage yet.");

    const session = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${config.webOrigin}/settings`,
    });

    res.json({ url: session.url });
  }),
);

// --- Webhook ---

/**
 * Resolves the account a Stripe object belongs to.
 *
 * Metadata first, because we put it there and it survives; the customer index is
 * the fallback for events that carry no metadata of ours — a subscription created
 * from the dashboard, for instance.
 */
async function resolveUserId(params: {
  metadataUserId?: string | null;
  customerId?: string | null;
}): Promise<string | null> {
  if (params.metadataUserId) return params.metadataUserId;
  if (!params.customerId) return null;

  const row = await prisma.subscription.findFirst({
    where: { stripeCustomerId: params.customerId },
    orderBy: { createdAt: "desc" },
    select: { userId: true },
  });

  return row?.userId ?? null;
}

function asId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * A completed checkout: the moment access is granted.
 *
 * `payment_status` is checked rather than assumed. A session can complete with
 * payment still pending — some bank-debit methods settle days later — and
 * granting 400 actions against an unsettled charge is exactly the hole a webhook
 * handler is supposed to close.
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  if (session.payment_status === "unpaid") return;

  const planKey = session.metadata?.planKey as PlanKey | undefined;
  const customerId = asId(session.customer);
  const userId = await resolveUserId({
    metadataUserId: session.client_reference_id ?? session.metadata?.userId,
    customerId,
  });

  if (!userId || !planKey || !customerId) {
    console.error("checkout.session.completed without an identifiable user or plan", {
      sessionId: session.id,
    });
    return;
  }

  const subscriptionId = asId(session.subscription);

  // For a subscription the authoritative period end lives on the subscription
  // object, not the session. For the pass there is none, and `activatePaidPlan`
  // computes it from the plan's `durationDays`.
  let currentPeriodEnd: Date | null = null;
  if (subscriptionId) {
    const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
    currentPeriodEnd = subscriptionPeriodEnd(subscription);
  }

  await activatePaidPlan({
    userId,
    planKey,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    currentPeriodEnd,
  });
}

/**
 * The current period's end, wherever this API version keeps it.
 *
 * Stripe moved `current_period_end` from the subscription onto its items in the
 * 2025 versions. Reading the item first and falling back keeps this correct
 * across both rather than silently returning null — which would have been read as
 * "never expires" and handed out a permanent membership.
 */
function subscriptionPeriodEnd(subscription: Stripe.Subscription): Date | null {
  const item = subscription.items?.data?.[0];
  const fromItem = fromUnixSeconds(item?.current_period_end);
  if (fromItem) return fromItem;

  const legacy = (subscription as unknown as { current_period_end?: number }).current_period_end;
  return fromUnixSeconds(legacy);
}

/** A renewal payment. The first invoice of a subscription is not one. */
async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const billingReason = invoice.billing_reason;
  if (billingReason !== "subscription_cycle") return;

  const parent = invoice.parent as { subscription_details?: { subscription?: unknown } } | null;
  const subscriptionId =
    asId(parent?.subscription_details?.subscription as string | { id: string } | null) ??
    asId((invoice as unknown as { subscription?: string | { id: string } }).subscription);

  if (!subscriptionId) return;

  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);

  await renewSubscriptionPeriod({
    stripeSubscriptionId: subscriptionId,
    currentPeriodEnd: subscriptionPeriodEnd(subscription),
  });
}

/**
 * `POST /billing/webhook` — the source of truth.
 *
 * Mounted with a raw body parser in `index.ts`, ahead of the global JSON one:
 * the signature covers the bytes Stripe sent, and a parse-then-restringify does
 * not reproduce them.
 *
 * Unrecognised events return 200. Stripe retries anything else, and an endpoint
 * that 400s on an event type it was never interested in trains a retry storm and
 * eventually gets itself disabled.
 */
billingRouter.post(
  "/webhook",
  asyncHandler(async (req, res) => {
    // `raw()` leaves a Buffer here. Anything else means the mount order in
    // index.ts changed, and verification would fail confusingly rather than
    // loudly, so it is checked.
    if (!Buffer.isBuffer(req.body)) {
      throw new HttpError(500, "Webhook body was parsed before verification.");
    }

    const event = verifyWebhook(req.body, req.headers["stripe-signature"] as string | undefined);

    // Claimed before handling, so a retry of an event we already applied is a
    // no-op rather than a second grant.
    const fresh = await claimStripeEvent(event.id, event.type);
    if (!fresh) {
      res.json({ received: true, duplicate: true });
      return;
    }

    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object);
        break;

      // The delayed settlement of the case above: the session completed while
      // payment was pending, and this is the confirmation.
      case "checkout.session.async_payment_succeeded":
        await handleCheckoutCompleted(event.data.object);
        break;

      case "invoice.paid":
        await handleInvoicePaid(event.data.object);
        break;

      case "customer.subscription.updated": {
        const subscription = event.data.object;
        await syncSubscriptionState({
          stripeSubscriptionId: subscription.id,
          stripeStatus: subscription.status,
          cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
          currentPeriodEnd: subscriptionPeriodEnd(subscription),
        });
        break;
      }

      case "customer.subscription.deleted":
        await expireSubscription(event.data.object.id);
        break;

      default:
        // Deliberately ignored, deliberately 200.
        break;
    }

    res.json({ received: true });
  }),
);
