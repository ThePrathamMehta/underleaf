"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { AiUsageDto, SubscriptionDto } from "@repo/types";
import { api } from "./api";
import { useAuth } from "./auth-context";

/**
 * The AI allowance, held once for the whole app.
 *
 * Four surfaces spend from the same counter — chat, ATS, job match, cover
 * letters — and three of them can be open at once. If each fetched and tracked
 * its own copy they would drift the moment one of them spent an action, and the
 * user would be reading two different answers to "how many do I have left".
 *
 * So there is one number here, and two ways it moves. Metered responses carry
 * the counter the server just wrote, and `applyUsage` folds it in without a
 * round trip; `refresh` re-reads when something happened out of band — a
 * checkout returning, a cancellation, a tab left open across a renewal.
 *
 * Nothing here decides whether an action is allowed. That is the server's call,
 * made atomically at the point of spending; this is only what the interface
 * shows, and it is deliberately allowed to be a moment stale rather than to
 * gate a click on a number the browser guessed.
 */

type UsageState = {
  subscription: SubscriptionDto | null;
  /** The live counter. Null while loading, or when signed out. */
  usage: AiUsageDto | null;
  loading: boolean;
  /** Folds in the counter a metered response returned. Ignores undefined. */
  applyUsage: (usage: AiUsageDto | null | undefined) => void;
  /**
   * Re-reads membership and allowance from the server, and hands back what it
   * read. The return value matters for one caller: settings, returning from
   * Checkout, has to decide whether the webhook has landed yet, and reading
   * `subscription` from context right after awaiting this would read the render
   * that has not happened.
   */
  refresh: () => Promise<SubscriptionDto | null>;
  /** Replaces the whole subscription, after a cancel returns the new one. */
  setSubscription: (subscription: SubscriptionDto) => void;
};

const UsageContext = createContext<UsageState | null>(null);

export function UsageProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [subscription, setSubscriptionState] = useState<SubscriptionDto | null>(null);
  const [usage, setUsage] = useState<AiUsageDto | null>(null);
  const [loading, setLoading] = useState(false);

  const userId = user?.id ?? null;

  // Keyed on the id rather than the object: settings replaces the cached user
  // on every profile save, and re-fetching the allowance because someone
  // renamed themselves would be a request per keystroke-ish save.
  useEffect(() => {
    if (!userId) {
      setSubscriptionState(null);
      setUsage(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    api
      .subscription(controller.signal)
      .then(({ subscription: current }) => {
        setSubscriptionState(current);
        setUsage(current.usage);
      })
      .catch(() => {
        // Left null. A counter that failed to load renders as nothing at all,
        // which is honest; showing "0 left" for a fetch error would tell the
        // user they are out of actions when they are not.
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [userId]);

  const applyUsage = useCallback((next: AiUsageDto | null | undefined) => {
    if (next) setUsage(next);
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) return null;
    try {
      const { subscription: current } = await api.subscription();
      setSubscriptionState(current);
      setUsage(current.usage);
      return current;
    } catch {
      // Same reasoning as the initial load: keep the last known good number.
      return null;
    }
  }, [userId]);

  const setSubscription = useCallback((next: SubscriptionDto) => {
    setSubscriptionState(next);
    setUsage(next.usage);
  }, []);

  return (
    <UsageContext.Provider
      value={{ subscription, usage, loading, applyUsage, refresh, setSubscription }}
    >
      {children}
    </UsageContext.Provider>
  );
}

export function useUsage(): UsageState {
  const context = useContext(UsageContext);
  if (!context) throw new Error("useUsage must be used within a UsageProvider");
  return context;
}
