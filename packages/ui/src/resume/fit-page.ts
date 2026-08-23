import type { Theme } from "@repo/types";
import { fillRatio, measureArgs, measureFlow, packBlocks } from "./paginate";
import { themeToCssVars } from "./resume-styles";

/**
 * Fitting a resume onto one page by adjusting its typography, never by cutting or
 * padding its content.
 *
 * A resume that runs six lines onto a second sheet is the most common thing wrong
 * with a first draft, and the fix is almost always presentational: a fraction less
 * line height, a millimetre off the margins, a hair off the type size. Doing that
 * by hand means dragging three sliders and watching the page count, which is a
 * search — so this expresses the search instead.
 *
 * It runs in both directions, because a page can be wrong in two ways. Too much
 * content overflows; too little leaves a band of dead space above the bottom
 * margin, which reads as an unfinished document rather than a brief one. The two
 * searches are mirror images: the same three knobs, the same step sizes, the same
 * ladder walked the other way.
 *
 * Deliberately *not* automatic, in either direction. Content the user wrote is
 * theirs, and so is the look they picked; this runs when they ask for it and
 * reports honestly when it can't succeed. The alternative — quietly resizing type
 * whenever a resume grows or shrinks — would mean a document that changes
 * appearance as it's edited.
 *
 * Only three knobs move. Fonts, colours, layout and page size are choices about
 * what the resume should look like, not about how much fits; changing those to win
 * or spend space would be answering a question nobody asked.
 */

/**
 * How far tightening may go, which is well short of what the theme schema allows.
 *
 * The schema's floors (line height 1, margin 8mm, scale 0.8) are the limits of what
 * the renderer can express, not of what a person should send to an employer. Body
 * text is 10pt, so scale 0.9 is 9pt — the smallest size that still reads as a
 * document rather than as an attempt to hide how much is on the page. Margins below
 * about 11mm start to look cramped and risk the unprintable edge on consumer
 * printers.
 *
 * Reaching these floors without fitting is a real answer: it means the resume has
 * more content than a page holds, and the honest fix is to cut something.
 */
export const FIT_FLOORS = {
  lineSpacing: 1.08,
  marginSize: 11,
  fontSizeScale: 0.9,
} as const;

/**
 * How far loosening may go, and likewise well short of the schema's ceilings
 * (line height 2, margin 30mm, scale 1.3).
 *
 * Body text is 10pt, so scale 1.1 is 11pt — the largest that still reads as a
 * resume rather than as large print. Leading much past 1.45 stops looking generous
 * and starts looking padded, which is the impression a half-empty page already
 * gives and the whole point of filling it is to avoid.
 *
 * `marginSize` gets the tightest ceiling of the three because it is the least
 * honest way to fill a page: it consumes space by shrinking the box rather than by
 * making the document better to read. It earns its place because wider side
 * margins genuinely suit a short resume — but it should be the knob that moves
 * least, and `resume-styles.ts` caps the *top* margin at 10mm regardless, so above
 * that only the sides and foot respond.
 *
 * Reaching these without filling is a real answer too: it means the resume has
 * less content than a page holds, and the honest fix is to write more.
 */
export const FIT_CEILINGS = {
  lineSpacing: 1.45,
  marginSize: 18,
  fontSizeScale: 1.1,
} as const;

/**
 * How full sheet one should end up — full enough to read as a finished document,
 * short of the edge.
 *
 * Not 100%, deliberately. A page grown until one more step would overflow is a
 * page where typing a single word tips the resume onto a second sheet and raises
 * the overflow warning; the user would have traded a cosmetic problem for a real
 * one. Eight per cent of a sheet is roughly a centimetre — indistinguishable from
 * an intentional bottom margin, and enough room to keep editing in.
 */
export const TARGET_FILL = 0.92;

/**
 * How empty a page has to look before it's worth saying so.
 *
 * A separate number from `TARGET_FILL`, because they answer different questions:
 * the target is what a fill aims *for*, this is how far short of it a page has to
 * fall before interrupting the user is justified. Using the target for both would
 * mean nagging every document that sits two lines under it — including brand new
 * ones, since a template's seeded theme is tuned against the longest sample that
 * shares it and every shorter sibling therefore opens a little below target.
 *
 * Six points is roughly three lines of body text: the point where the gap above the
 * bottom margin stops reading as a margin and starts reading as an unfinished page.
 * Below that it is slack, not a problem, and the honest thing is to say nothing.
 */
export const FILL_OFFER_BELOW = 0.86;

/** Step sizes, small enough that the first candidate that fits barely differs. */
const STEPS = {
  lineSpacing: 0.02,
  marginSize: 0.5,
  fontSizeScale: 0.01,
} as const;

/** The knobs, in the order they give up space most invisibly. */
const KNOBS = ["lineSpacing", "marginSize", "fontSizeScale"] as const;

type Knob = (typeof KNOBS)[number];

/** Rounded to kill float drift, so a candidate is stable and comparable. */
const round = (value: number, knob: Knob) =>
  knob === "fontSizeScale" ? Number(value.toFixed(3)) : Number(value.toFixed(2));

/** Each knob in the words and units the toolbar's own sliders show it in. */
const NAMES: Record<Knob, string> = {
  lineSpacing: "line height",
  marginSize: "page margin",
  fontSizeScale: "text size",
};

const VALUE: Record<Knob, (theme: Theme) => string> = {
  lineSpacing: (t) => t.lineSpacing.toFixed(2),
  marginSize: (t) => `${t.marginSize}mm`,
  fontSizeScale: (t) => `${Math.round(t.fontSizeScale * 100)}%`,
};

/**
 * Every theme worth trying, tightest-last, each one a single small step past its
 * predecessor. The caller measures them in order and keeps the first that fits, so
 * the change a user ends up with is the least one that worked.
 *
 * Two phases, because they mean different things:
 *
 *  1. **Back toward the template's own values.** A resume whose line height was
 *     loosened past what its template asked for is a resume with space it never
 *     meant to spend. Undoing that isn't a compromise — it restores the design the
 *     user picked, so it's tried before anything that goes further.
 *  2. **Below the template's values**, round-robin across the three knobs. Cycling
 *     rather than exhausting one knob at a time is what keeps the result balanced:
 *     a page that is slightly tighter everywhere reads as a deliberate setting,
 *     while one with crushed leading and untouched margins reads as a mistake.
 *
 * `templateDefault` is optional. Without it phase 1 is skipped, which costs only
 * the chance to fit by reverting drift.
 */
export function fitCandidates(theme: Theme, templateDefault?: Theme): Theme[] {
  const candidates: Theme[] = [];
  let current = { ...theme };

  const push = (next: Theme) => {
    current = next;
    candidates.push(next);
  };

  // Phase 1: only knobs the user loosened past the template. A knob already
  // tighter than the template is left alone — loosening it back up would cost
  // space, which is the opposite of the point.
  if (templateDefault) {
    for (const knob of KNOBS) {
      const target = templateDefault[knob];
      while (current[knob] > target) {
        const value = round(Math.max(target, current[knob] - STEPS[knob]), knob);
        if (value === current[knob]) break;
        push({ ...current, [knob]: value });
      }
    }
  }

  // Phase 2: below the template, cycling, until every knob is on its floor.
  for (;;) {
    let moved = false;

    for (const knob of KNOBS) {
      const floor = FIT_FLOORS[knob];
      if (current[knob] <= floor) continue;

      const value = round(Math.max(floor, current[knob] - STEPS[knob]), knob);
      if (value === current[knob]) continue;

      push({ ...current, [knob]: value });
      moved = true;
    }

    if (!moved) break;
  }

  return candidates;
}

/**
 * Whether a theme still has room to tighten. Drives whether the fit action is
 * offered at all — a resume already on every floor cannot be fitted by styling,
 * and offering a button that does nothing is worse than not offering one.
 */
export function canTighten(theme: Theme, templateDefault?: Theme): boolean {
  return fitCandidates(theme, templateDefault).length > 0;
}

/**
 * The mirror of `fitCandidates`: every theme worth trying to *fill* a page with,
 * loosest-last, each one a single small step past its predecessor.
 *
 * Same two phases, both reversed:
 *
 *  1. **Back toward the template's own values.** A resume whose line height was
 *     tightened below what its template asked for has space it is not spending.
 *     Returning it isn't padding — it restores the design the user picked, so it's
 *     tried before anything that goes further.
 *  2. **Above the template's values**, round-robin across the three knobs. Cycling
 *     is what keeps the result balanced: a page loosened slightly everywhere reads
 *     as a deliberate setting, while one with airy leading and unchanged margins
 *     reads as a mistake.
 *
 * The caller measures in order and keeps the **last** candidate that still fits the
 * page, which is the opposite of the tightening search — there, the least change
 * that works is the right one; here, the most growth that still fits is.
 */
export function fillCandidates(theme: Theme, templateDefault?: Theme): Theme[] {
  const candidates: Theme[] = [];
  let current = { ...theme };

  const push = (next: Theme) => {
    current = next;
    candidates.push(next);
  };

  /**
   * The highest this knob may go.
   *
   * Clamped up to wherever the theme and the template already sit, so the ladder
   * can never propose a *decrease*. The ceilings here are well inside the schema's
   * — it permits margins to 30mm and leading to 2.0 — so a user who set generous
   * margins by hand is already above one. Without this clamp, asking to fill their
   * page would narrow those margins: a change to how the resume looks, made in the
   * name of how much of the sheet it uses. Growth only, or nothing.
   */
  const ceiling = (knob: Knob) =>
    Math.max(FIT_CEILINGS[knob], theme[knob], templateDefault?.[knob] ?? 0);

  // Phase 1: only knobs the user tightened past the template. A knob already
  // looser than the template is left alone — tightening it back down would cost
  // space, which is the opposite of the point.
  if (templateDefault) {
    for (const knob of KNOBS) {
      const target = templateDefault[knob];
      while (current[knob] < target) {
        const value = round(Math.min(target, current[knob] + STEPS[knob]), knob);
        if (value === current[knob]) break;
        push({ ...current, [knob]: value });
      }
    }
  }

  // Phase 2: above the template, cycling, until every knob is on its ceiling.
  for (;;) {
    let moved = false;

    for (const knob of KNOBS) {
      const limit = ceiling(knob);
      if (current[knob] >= limit) continue;

      const value = round(Math.min(limit, current[knob] + STEPS[knob]), knob);
      if (value === current[knob]) continue;

      push({ ...current, [knob]: value });
      moved = true;
    }

    if (!moved) break;
  }

  return candidates;
}

/**
 * Whether a theme still has room to loosen. Drives whether the fill action is
 * offered at all — a resume already on every ceiling cannot be filled by styling,
 * and offering a button that does nothing is worse than not offering one.
 */
export function canFill(theme: Theme, templateDefault?: Theme): boolean {
  return fillCandidates(theme, templateDefault).length > 0;
}

/** The knobs a fit changed, and by how much, for explaining what just happened. */
export function describeFit(before: Theme, after: Theme): string[] {
  return KNOBS.filter((knob) => before[knob] !== after[knob]).map(
    (knob) => `${NAMES[knob]} ${VALUE[knob](before)} → ${VALUE[knob](after)}`,
  );
}

/**
 * The knobs set looser than the template asked for, named for a warning.
 *
 * Only looser ones: a resume that overflows while its margins are *tighter* than
 * the template's didn't overflow because of the margins, and saying so would send
 * the user to the wrong slider. When this comes back empty the honest answer is
 * that there's simply more content than a page holds.
 */
export function describeDrift(theme: Theme, templateDefault: Theme): string[] {
  return KNOBS.filter((knob) => theme[knob] > templateDefault[knob]).map(
    (knob) =>
      `${NAMES[knob]} is ${VALUE[knob](theme)}, where this template sets ${VALUE[knob](templateDefault)}`,
  );
}

/** What one candidate costs: sheets needed, and how full the first one is. */
type Probe = { sheets: number; fill: number };

/**
 * Runs `search` with a function that measures any candidate theme against the live
 * mirror, then puts the mirror back exactly as it was found.
 *
 * Runs in the browser, against the same hidden mirror the pagination pass reads —
 * which is what makes a search of thirty-odd candidates cheap. Every knob it
 * moves is a CSS custom property on `.rd-root`, so a candidate can be tried by
 * writing variables and re-reading the flow: no React render, no font reload, no
 * awaiting a frame. `getBoundingClientRect` inside `measureFlow` forces the
 * pending layout itself, so each step measures the candidate and not its
 * predecessor.
 *
 * The mirror's variables are restored before returning, including on an early
 * return or a throw. React owns that style attribute and would rewrite it on the
 * next render, but "the next render" is not guaranteed to come — a search that
 * found nothing changes no state at all.
 *
 * A probe returns null when the mirror measured nothing, which happens before it
 * has been laid out. That is "no answer", not "a document that fits" — the
 * distinction matters, because the second would let a search succeed against an
 * empty measurement and write a theme nobody asked for.
 */
function withMirror(
  measureRoot: string,
  theme: Theme,
  forcedBreaks: Set<string>,
  search: (probe: (candidate: Theme) => Probe | null) => Theme | null,
): Theme | null {
  const root = document.querySelector(measureRoot)?.querySelector<HTMLElement>(".rd-root");
  if (!root) return null;

  const apply = (candidate: Theme) => {
    for (const [name, value] of Object.entries(themeToCssVars(candidate))) {
      root.style.setProperty(name, value);
    }
  };

  const probe = (candidate: Theme): Probe | null => {
    apply(candidate);
    const flow = measureFlow(measureArgs(measureRoot));
    if (flow.usableHeight <= 0) return null;
    return { sheets: packBlocks({ ...flow, forcedBreaks }).length, fill: fillRatio(flow) };
  };

  try {
    return search(probe);
  } finally {
    apply(theme);
  }
}

/**
 * Tries the tightening ladder against the mirror and returns the first theme that
 * fits, or null when none does.
 *
 * The *first* that fits, so the change the user ends up with is the least one that
 * worked.
 *
 * `targetPages` is normally 1. It's a parameter because a resume with manual page
 * breaks is *meant* to be longer, and what it should be fitted back to is the
 * number of sheets its own breaks ask for, not one.
 */
export function searchFit({
  measureRoot,
  theme,
  templateDefault,
  forcedBreaks,
  targetPages = 1,
}: {
  /** Selector for the mirror host, as passed to `measureArgs`. */
  measureRoot: string;
  theme: Theme;
  templateDefault?: Theme;
  forcedBreaks: Set<string>;
  targetPages?: number;
}): Theme | null {
  return withMirror(measureRoot, theme, forcedBreaks, (probe) => {
    const fits = (candidate: Theme) => {
      const result = probe(candidate);
      return result !== null && result.sheets <= targetPages;
    };
    return fitCandidates(theme, templateDefault).find(fits) ?? null;
  });
}

/**
 * Tries the loosening ladder against the mirror and returns the theme that lands
 * sheet one closest to `targetFill` without needing another sheet — or null when
 * the theme it was given is already the closest.
 *
 * Where `searchFit` takes the first candidate that works, this compares. Fill rises
 * monotonically along the ladder, so the walk can stop at the first candidate that
 * overshoots the target: nothing past it gets closer. The winner is then whichever
 * of the two neighbours straddling the target is nearer to it, which is what stops a
 * document whose steps are coarse — one tall unbreakable block, say — from being
 * left at 70% merely because the next step would reach 95%.
 *
 * Returning null is a real answer, and the common one for a resume that is already
 * full. The caller should leave the theme alone rather than treat it as a failure.
 */
export function searchFill({
  measureRoot,
  theme,
  templateDefault,
  forcedBreaks,
  targetPages = 1,
  targetFill = TARGET_FILL,
}: {
  /** Selector for the mirror host, as passed to `measureArgs`. */
  measureRoot: string;
  theme: Theme;
  templateDefault?: Theme;
  forcedBreaks: Set<string>;
  targetPages?: number;
  targetFill?: number;
}): Theme | null {
  return withMirror(measureRoot, theme, forcedBreaks, (probe) => {
    // The theme as it stands is the baseline to beat: if no candidate lands nearer
    // the target than this, the honest result is to change nothing.
    const start = probe(theme);
    if (!start) return null;

    let best: Theme | null = null;
    let bestDistance = Math.abs(targetFill - start.fill);

    for (const candidate of fillCandidates(theme, templateDefault)) {
      const result = probe(candidate);
      // A candidate that needs another sheet has left the page, and so has
      // everything looser than it.
      if (!result || result.sheets > targetPages) break;

      const distance = Math.abs(targetFill - result.fill);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }

      // Past the target, and fill only rises from here.
      if (result.fill >= targetFill) break;
    }

    return best;
  });
}
