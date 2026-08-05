import { LeafMark } from "./logo";

/**
 * First-run splash.
 *
 * Deliberately not a React-controlled overlay. The markup below is static and
 * server-rendered on every page; whether it's *visible* is decided by the
 * inline script in app/layout.tsx, which sets data-splash on <html> before the
 * first paint. That ordering is the whole point:
 *
 *   - a first-time visitor sees the splash in the very first painted frame,
 *     with no flash of the page underneath while React hydrates;
 *   - a returning visitor never sees a single frame of it, because the CSS
 *     keeps it at display:none without the attribute;
 *   - React never adds or removes the node, so there's no hydration mismatch.
 *
 * The animation itself is CSS (see the .splash rules in globals.css) and runs
 * to completion without JS; the script only clears the attribute afterwards to
 * take the node out of the layout and unlock scrolling.
 */
export function Splash() {
  return (
    <div className="splash" aria-hidden="true">
      <LeafMark
        size={64}
        className="splash-leaf"
        bladeClassName="splash-blade"
        stemClassName="splash-stem"
      />

      <div className="flex flex-col items-center gap-3">
        <span className="splash-word font-display text-[2rem] leading-none tracking-tight text-ink">
          Underleaf
        </span>
        <span
          className="splash-rule h-px w-24 origin-center bg-rule-strong"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
