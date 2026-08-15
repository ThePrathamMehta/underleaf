"use client";

import Link from "next/link";
import type { AiUsageDto, PlanKey } from "@repo/types";
import { useUsage } from "../lib/usage";

/**
 * The two allowance surfaces, shared by every metered feature.
 *
 * `AllowanceMeter` is the always-visible count; `AllowanceWall` is what replaces
 * the action once the count reaches zero. Both are inline by construction —
 * they render where they are placed, in the flow of the panel that owns them.
 * No modal, no toast: an upgrade prompt that interrupts the page is an
 * advertisement, and one that appears next to the button you just pressed is an
 * explanation. The spec asks for the second, so neither of these can float.
 */

/** Below this many actions the count stops being neutral and starts warning. */
const LOW_WATER = 3;

/** "3 Nov" — enough to plan around, without a year nobody needed. */
function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function tone(remaining: number): string {
  if (remaining === 0) return "text-danger";
  if (remaining <= LOW_WATER) return "text-accent";
  return "text-ink-faint";
}

/**
 * "7 of 10 AI actions left".
 *
 * Renders nothing at all when there is no counter to show — signed out, still
 * loading, or a failed fetch. An empty space is better than a wrong number in a
 * place the user will use to decide whether to start something.
 */
export function AllowanceMeter({ className = "" }: { className?: string }) {
  const { usage } = useUsage();
  if (!usage) return null;

  const renews = shortDate(usage.periodEnd);

  return (
    <p
      className={`font-mono text-[0.625rem] uppercase tracking-[0.12em] tabular-nums ${tone(
        usage.remaining,
      )} ${className}`}
      title={
        renews
          ? `${usage.consumed} of ${usage.granted} used · resets ${renews}`
          : `${usage.consumed} of ${usage.granted} used`
      }
    >
      {usage.remaining} of {usage.granted} AI actions left
      {usage.remaining <= LOW_WATER && (
        <>
          {" · "}
          <Link
            href="/pricing"
            className="underline underline-offset-2 transition-opacity hover:opacity-70"
          >
            {usage.remaining === 0 ? "Get more" : "Top up"}
          </Link>
        </>
      )}
    </p>
  );
}

/**
 * What each plan's exhaustion actually means.
 *
 * The three are genuinely different situations and deserve different sentences:
 * the free grant is spent for good, a monthly cycle refills on a date, and a
 * pass has a ceiling that no waiting will lift. Telling a Pro user to "upgrade"
 * on the day before their reset would be both useless and slightly insulting.
 */
function exhaustedCopy(planKey: PlanKey | null, usage: AiUsageDto): {
  title: string;
  body: string;
  cta: string;
} {
  const resets = shortDate(usage.periodEnd);

  if (planKey === "pro_monthly") {
    return {
      title: "You've used this month's AI actions",
      body: resets
        ? `All ${usage.granted} of them. They come back on ${resets} — or a Job Search Pass adds a separate allowance you can start on now.`
        : `All ${usage.granted} of them. A Job Search Pass adds a separate allowance you can start on now.`,
      cta: "See the pass",
    };
  }

  if (planKey === "job_search_pass") {
    return {
      title: "Your pass is out of AI actions",
      body: `All ${usage.granted} are spent. Everything else keeps working — editing, exporting, and the automated ATS checks are unlimited on every plan.`,
      cta: "See plans",
    };
  }

  return {
    title: "You've used your free AI actions",
    body: `That's all ${usage.granted}. Editing, exporting, and the automated ATS checks stay unlimited — it's only the AI features that need more.`,
    cta: "See plans",
  };
}

/**
 * The inline block that stands in for a refused action.
 *
 * Shown after a 402, in place of the thing the user asked for. It carries the
 * count the server actually saw, so it can't disagree with the meter above it,
 * and it names what still works — because "out of actions" on a resume editor
 * reads like the whole product stopped, and on this product almost none of it
 * did.
 */
export function AllowanceWall({
  usage,
  className = "",
}: {
  usage: AiUsageDto;
  className?: string;
}) {
  const { subscription } = useUsage();
  const copy = exhaustedCopy(subscription?.planKey ?? null, usage);

  return (
    <div
      role="status"
      className={`rounded-lg bg-paper-sunken px-3 py-3 ring-1 ring-inset ring-rule ${className}`}
    >
      <p className="font-display text-[0.9375rem] tracking-tight text-ink">{copy.title}</p>
      <p className="mt-1 text-[0.8125rem] leading-snug text-ink-muted text-pretty">{copy.body}</p>
      <Link
        href="/pricing"
        className="mt-2 inline-flex items-center gap-1 font-mono text-[0.625rem] uppercase tracking-[0.12em] text-accent underline underline-offset-2 transition-opacity hover:opacity-70"
      >
        {copy.cta}
        <span aria-hidden>&rarr;</span>
      </Link>
    </div>
  );
}
