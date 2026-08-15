"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PlanDto, PlanKey } from "@repo/types";
import { api, ApiError } from "./api";
import { useAuth } from "./auth-context";

/**
 * Starting a purchase, from wherever the plan was clicked.
 *
 * Two surfaces sell the same three plans — the landing page and `/pricing` — and
 * the sequence a click has to run through is identical on both: no account means
 * sign up first, the free plan has no checkout to open, and a paid plan means ask
 * the server for a hosted Checkout URL and hand the browser over to Stripe. That
 * sequence lives here rather than twice, because the half of it that's easy to
 * forget is the signed-out branch.
 *
 * Note what never appears in this file: an amount, a price id, or anything else
 * describing what is about to be charged. The request names a plan by key and the
 * server decides the rest, so the browser holds no value that could be tampered
 * with into a cheaper purchase.
 */

/**
 * Where a signed-out visitor goes, and what brings them back mid-purchase.
 *
 * Signing up used to land on `/pricing` and leave the visitor to find the button
 * again — the flow forgot what they had clicked. Carrying the plan through the
 * `next` parameter means the pricing page can pick the purchase back up (see
 * `useCheckoutResume`), so one click, an account, and a card is the whole path.
 */
export function signupPathForPlan(planKey: PlanKey): string {
  return `/signup?next=${encodeURIComponent(`/pricing?plan=${planKey}`)}`;
}

export type Checkout = {
  /** The plan whose checkout is opening, so only its own button spins. */
  starting: PlanKey | null;
  error: string | null;
  clearError: () => void;
  start: (plan: PlanDto) => Promise<void>;
};

export function useCheckout(): Checkout {
  const { user } = useAuth();
  const router = useRouter();

  const [starting, setStarting] = useState<PlanKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(
    async (plan: PlanDto) => {
      // The free plan's card renders a link to the dashboard instead of a button
      // that reaches this. Stated rather than assumed: the request body type
      // excludes "free" too, and the server refuses it a third time.
      if (plan.key === "free") return;

      // Checkout is per-account — there is nobody to bill until there is a user,
      // and no way to attach the purchase to anything if it succeeded anyway.
      if (!user) {
        router.push(signupPathForPlan(plan.key));
        return;
      }

      setStarting(plan.key);
      setError(null);

      try {
        const { url } = await api.checkout({ planKey: plan.key });
        // A full navigation, not a router push: the destination is Stripe. This
        // is also the last line of ours that runs in the purchase — card details
        // are entered on Stripe's page and confirmed to us by webhook.
        window.location.href = url;
      } catch (caught: unknown) {
        setError(
          caught instanceof ApiError ? caught.message : "Could not start checkout. Try again.",
        );
        setStarting(null);
      }
    },
    [router, user],
  );

  const clearError = useCallback(() => setError(null), []);

  return { starting, error, clearError, start };
}

/**
 * Picks a purchase back up after the signup detour.
 *
 * Fires once, only for a plan that is actually purchasable, and strips the
 * parameter from the URL before opening Checkout so that coming back with the
 * browser's back button doesn't send the visitor straight out again.
 *
 * Returns whether a resume is in flight, so the page can say what it's doing
 * rather than appearing to hang on its own for a moment. It stays true once set:
 * the successful ending is a full navigation to Stripe, and clearing the flag
 * when `start` resolves would blank the message while the browser is still on its
 * way. The caller hides it if `error` fills in instead.
 */
export function useCheckoutResume(plans: PlanDto[], start: (plan: PlanDto) => Promise<void>) {
  const { user } = useAuth();
  const [resuming, setResuming] = useState(false);
  const fired = useRef(false);

  useEffect(() => {
    // Waits for both: the plan is named in the URL but its price and
    // purchasability come from the API, and neither is worth guessing.
    if (fired.current || !user || plans.length === 0) return;

    const requested = new URLSearchParams(window.location.search).get("plan");
    if (!requested) return;

    fired.current = true;

    const plan = plans.find((candidate) => candidate.key === requested);
    // Silently dropped when the plan is unknown, free, or not for sale: the
    // visitor is on the pricing page with the cards in front of them, and an
    // error about a URL they didn't type would explain nothing.
    if (!plan || plan.key === "free" || !plan.purchasable) return;

    window.history.replaceState({}, "", "/pricing");
    setResuming(true);
    void start(plan);
  }, [plans, start, user]);

  return resuming;
}
