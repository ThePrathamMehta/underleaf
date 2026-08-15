import Stripe from "stripe";
import { config } from "../config.js";
import { HttpError } from "../middleware/errors.js";

/**
 * The Stripe client, and the one place this codebase knows Stripe exists.
 *
 * Everything about the integration is hosted: Checkout collects the card, the
 * Customer Portal manages it, and webhooks report what happened. No card number,
 * expiry, CVC or bank detail is ever posted to this API, present in a request
 * body, or written to a column — the Definition of Done requires that, and the
 * way to keep a rule like that true is to leave no route that could break it
 * rather than to remember not to write one.
 *
 * The client is created lazily. A deployment with no Stripe account boots, lists
 * plans, and meters the free tier exactly as it would with one; only checkout
 * itself reports that payments aren't configured.
 */

let client: Stripe | null = null;

/** 503 rather than 500: unconfigured is an operator state, not a bug. */
function notConfigured(): HttpError {
  return new HttpError(503, "Payments are not configured on this deployment.");
}

export function stripeEnabled(): boolean {
  return config.stripeEnabled;
}

export function getStripe(): Stripe {
  if (!config.stripe) throw notConfigured();

  client ??= new Stripe(config.stripe.secretKey, {
    // Pinned deliberately. Stripe changes response shapes between versions, and
    // an SDK upgrade silently moving this would change what the webhook handler
    // reads at exactly the moment nobody is looking at it.
    apiVersion: "2025-08-27.basil",
    typescript: true,
    appInfo: { name: "Underleaf", version: "5.0.0" },
  });

  return client;
}

/**
 * Verifies a webhook signature and returns the parsed event.
 *
 * Takes the raw body as a Buffer, not a parsed object: the signature covers the
 * exact bytes Stripe sent, and `JSON.parse` followed by `JSON.stringify` does not
 * reliably reproduce them. That is why the webhook route is mounted with a raw
 * body parser ahead of the global JSON one.
 *
 * A missing webhook secret rejects rather than skips. An unverified webhook is
 * an unauthenticated POST that grants paid access — the one request in this API
 * where "trust it for now" would be the whole vulnerability.
 */
export function verifyWebhook(rawBody: Buffer, signature: string | undefined): Stripe.Event {
  if (!config.stripe) throw notConfigured();
  if (!config.stripe.webhookSecret) {
    throw new HttpError(503, "Webhook verification is not configured on this deployment.");
  }
  if (!signature) throw new HttpError(400, "Missing Stripe signature");

  try {
    return getStripe().webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret);
  } catch (error) {
    // The message is Stripe's ("no signatures found matching the expected
    // signature"), which is what an operator debugging a misconfigured endpoint
    // needs to see. It reveals nothing: the caller already knows the payload.
    const detail = error instanceof Error ? error.message : "Signature verification failed";
    throw new HttpError(400, `Webhook signature verification failed: ${detail}`);
  }
}

/**
 * Finds or creates the Stripe Customer for a user.
 *
 * Reusing one customer across purchases is what makes the portal useful: a buyer
 * who takes the pass and later subscribes sees one payment history and one saved
 * card, rather than two unrelated records that happen to share an email.
 *
 * `userId` goes into metadata so a webhook that arrives with only a customer id —
 * which is most of them — can still be traced back to an account without a
 * lookup depending on email uniqueness at Stripe's end.
 */
export async function ensureCustomer(params: {
  userId: string;
  email: string;
  name: string | null;
  existingCustomerId: string | null;
}): Promise<string> {
  const stripe = getStripe();

  if (params.existingCustomerId) {
    // A customer can be deleted from the dashboard; reusing a dead id fails the
    // checkout rather than the lookup, which is a far more confusing failure.
    const existing = await stripe.customers.retrieve(params.existingCustomerId).catch(() => null);
    if (existing && !existing.deleted) return existing.id;
  }

  const created = await stripe.customers.create({
    email: params.email,
    name: params.name ?? undefined,
    metadata: { userId: params.userId },
  });

  return created.id;
}
