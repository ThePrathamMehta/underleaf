import { describe, expect, test } from "bun:test";
import { DEFAULT_THEME, themeSchema, type Theme } from "@repo/types";
import {
  canFill,
  canTighten,
  describeDrift,
  describeFit,
  FILL_OFFER_BELOW,
  FIT_CEILINGS,
  FIT_FLOORS,
  fillCandidates,
  fitCandidates,
  TARGET_FILL,
} from "./fit-page";

/**
 * The fit ladder decides what a user's resume looks like after they press one
 * button, so the properties that matter are the ones about restraint: it must never
 * go past the floors, never touch anything but the three knobs, and offer the
 * smallest change first.
 */
const theme = (overrides: Partial<Theme> = {}): Theme => ({ ...DEFAULT_THEME, ...overrides });

describe("fitCandidates", () => {
  test("offers the smallest change first and the tightest last", () => {
    const start = theme({ lineSpacing: 1.25, marginSize: 14, fontSizeScale: 1 });
    const ladder = fitCandidates(start);

    expect(ladder.length).toBeGreaterThan(10);

    // The first candidate differs from the start by one step of one knob.
    const first = ladder[0]!;
    expect(first.lineSpacing).toBeCloseTo(1.23, 5);
    expect(first.marginSize).toBe(14);
    expect(first.fontSizeScale).toBe(1);

    const last = ladder.at(-1)!;
    expect(last.lineSpacing).toBe(FIT_FLOORS.lineSpacing);
    expect(last.marginSize).toBe(FIT_FLOORS.marginSize);
    expect(last.fontSizeScale).toBe(FIT_FLOORS.fontSizeScale);
  });

  test("never proposes anything past the floors, which are stricter than the schema", () => {
    const ladder = fitCandidates(theme({ lineSpacing: 1.1, marginSize: 11.5, fontSizeScale: 0.91 }));

    for (const candidate of ladder) {
      expect(candidate.lineSpacing).toBeGreaterThanOrEqual(FIT_FLOORS.lineSpacing);
      expect(candidate.marginSize).toBeGreaterThanOrEqual(FIT_FLOORS.marginSize);
      expect(candidate.fontSizeScale).toBeGreaterThanOrEqual(FIT_FLOORS.fontSizeScale);
      // Every candidate is a theme the schema would accept.
      expect(themeSchema.safeParse(candidate).success).toBe(true);
    }
  });

  test("changes nothing but the three space knobs", () => {
    const start = theme({ accentColor: "#123456", fontFamily: "lato", layout: "two-column" });

    for (const candidate of fitCandidates(start)) {
      expect(candidate.accentColor).toBe("#123456");
      expect(candidate.fontFamily).toBe("lato");
      expect(candidate.headingFontFamily).toBe(start.headingFontFamily);
      expect(candidate.layout).toBe("two-column");
      expect(candidate.pageSize).toBe(start.pageSize);
      expect(candidate.textColor).toBe(start.textColor);
    }
  });

  test("each candidate is one step from the one before it", () => {
    const ladder = fitCandidates(theme());
    let previous = theme();

    for (const candidate of ladder) {
      const changed = (["lineSpacing", "marginSize", "fontSizeScale"] as const).filter(
        (knob) => candidate[knob] !== previous[knob],
      );
      expect(changed).toHaveLength(1);
      previous = candidate;
    }
  });

  /**
   * The distinction phase 1 exists for. This is the real case found in the
   * database: content identical to the sample, but line height and margin nudged
   * above what the template asked for — so the first thing to try is the template's
   * own values, not a compromise.
   */
  test("reverts drift above the template default before tightening past it", () => {
    const template = theme({ lineSpacing: 1.19, marginSize: 14 });
    const drifted = theme({ lineSpacing: 1.3, marginSize: 15 });

    const ladder = fitCandidates(drifted, template);
    const revert = ladder.findIndex(
      (c) => c.lineSpacing === 1.19 && c.marginSize === 14 && c.fontSizeScale === 1,
    );

    expect(revert).toBeGreaterThanOrEqual(0);
    // Everything before the revert is still at or above the template's values —
    // the ladder walks back to the template before going below it.
    for (const candidate of ladder.slice(0, revert)) {
      expect(candidate.lineSpacing).toBeGreaterThanOrEqual(1.19);
      expect(candidate.marginSize).toBeGreaterThanOrEqual(14);
      expect(candidate.fontSizeScale).toBe(1);
    }
  });

  test("leaves a knob alone when the user set it tighter than the template", () => {
    const template = theme({ lineSpacing: 1.4 });
    // Already tighter than the template asks for; loosening it back up would cost
    // space, so phase 1 must skip it.
    const ladder = fitCandidates(theme({ lineSpacing: 1.15 }), template);

    for (const candidate of ladder) expect(candidate.lineSpacing).toBeLessThanOrEqual(1.15);
  });

  test("has nothing to offer a theme already on every floor", () => {
    const floored = theme({ ...FIT_FLOORS });

    expect(fitCandidates(floored)).toEqual([]);
    expect(canTighten(floored)).toBe(false);
    expect(canTighten(theme())).toBe(true);
  });

  test("can still revert drift for a floored theme, since that is free space", () => {
    const floored = theme({ ...FIT_FLOORS, marginSize: 20 });
    expect(canTighten(floored, theme({ marginSize: 14 }))).toBe(true);
  });
});

/**
 * The mirror of the above. The properties that matter are the same three, reflected:
 * it must never go past the ceilings, never touch anything but the three knobs, and
 * never hand back something *tighter* than what it was given — a search asked to
 * fill a page has no business narrowing anything.
 */
describe("fillCandidates", () => {
  test("offers the smallest change first and the loosest last", () => {
    const start = theme({ lineSpacing: 1.25, marginSize: 14, fontSizeScale: 1 });
    const ladder = fillCandidates(start);

    expect(ladder.length).toBeGreaterThan(10);

    const first = ladder[0]!;
    expect(first.lineSpacing).toBeCloseTo(1.27, 5);
    expect(first.marginSize).toBe(14);
    expect(first.fontSizeScale).toBe(1);

    const last = ladder.at(-1)!;
    expect(last.lineSpacing).toBe(FIT_CEILINGS.lineSpacing);
    expect(last.marginSize).toBe(FIT_CEILINGS.marginSize);
    expect(last.fontSizeScale).toBe(FIT_CEILINGS.fontSizeScale);
  });

  test("never proposes anything past the ceilings, which are inside the schema", () => {
    const ladder = fillCandidates(theme({ lineSpacing: 1.4, marginSize: 17, fontSizeScale: 1.09 }));

    for (const candidate of ladder) {
      expect(candidate.lineSpacing).toBeLessThanOrEqual(FIT_CEILINGS.lineSpacing);
      expect(candidate.marginSize).toBeLessThanOrEqual(FIT_CEILINGS.marginSize);
      expect(candidate.fontSizeScale).toBeLessThanOrEqual(FIT_CEILINGS.fontSizeScale);
      expect(themeSchema.safeParse(candidate).success).toBe(true);
    }
  });

  test("only ever grows: no candidate is tighter than where it started", () => {
    const start = theme({ lineSpacing: 1.2, marginSize: 13, fontSizeScale: 0.95 });

    for (const candidate of fillCandidates(start)) {
      expect(candidate.lineSpacing).toBeGreaterThanOrEqual(start.lineSpacing);
      expect(candidate.marginSize).toBeGreaterThanOrEqual(start.marginSize);
      expect(candidate.fontSizeScale).toBeGreaterThanOrEqual(start.fontSizeScale);
    }
  });

  /**
   * The ceilings here are well inside the schema's, which allows margins to 30mm.
   * So a user who widened their margins by hand already sits above one — and a
   * ladder that clamped to the ceiling rather than to where they already are would
   * *narrow* those margins while being asked to fill the page, changing how the
   * resume looks in the name of how much of the sheet it uses.
   */
  test("never narrows a theme already set past a ceiling", () => {
    const wide = theme({ marginSize: 21 });
    const ladder = fillCandidates(wide, wide);

    expect(ladder.length).toBeGreaterThan(0);
    for (const candidate of ladder) expect(candidate.marginSize).toBeGreaterThanOrEqual(21);
  });

  test("changes nothing but the three space knobs", () => {
    const start = theme({ accentColor: "#123456", fontFamily: "lato", layout: "two-column" });

    for (const candidate of fillCandidates(start)) {
      expect(candidate.accentColor).toBe("#123456");
      expect(candidate.fontFamily).toBe("lato");
      expect(candidate.layout).toBe("two-column");
      expect(candidate.pageSize).toBe(start.pageSize);
      expect(candidate.textColor).toBe(start.textColor);
    }
  });

  test("each candidate is one step from the one before it", () => {
    const ladder = fillCandidates(theme());
    let previous = theme();

    for (const candidate of ladder) {
      const changed = (["lineSpacing", "marginSize", "fontSizeScale"] as const).filter(
        (knob) => candidate[knob] !== previous[knob],
      );
      expect(changed).toHaveLength(1);
      previous = candidate;
    }
  });

  /** Phase 1 in the other direction: space the user gave up is the first to reclaim. */
  test("reverts drift below the template default before loosening past it", () => {
    const template = theme({ lineSpacing: 1.3, marginSize: 15 });
    const tightened = theme({ lineSpacing: 1.19, marginSize: 14 });

    const ladder = fillCandidates(tightened, template);
    const revert = ladder.findIndex(
      (c) => c.lineSpacing === 1.3 && c.marginSize === 15 && c.fontSizeScale === 1,
    );

    expect(revert).toBeGreaterThanOrEqual(0);
    for (const candidate of ladder.slice(0, revert)) {
      expect(candidate.lineSpacing).toBeLessThanOrEqual(1.3);
      expect(candidate.marginSize).toBeLessThanOrEqual(15);
      expect(candidate.fontSizeScale).toBe(1);
    }
  });

  test("leaves a knob alone when the user set it looser than the template", () => {
    const template = theme({ lineSpacing: 1.15 });
    const ladder = fillCandidates(theme({ lineSpacing: 1.35 }), template);

    for (const candidate of ladder) expect(candidate.lineSpacing).toBeGreaterThanOrEqual(1.35);
  });

  test("has nothing to offer a theme already on every ceiling", () => {
    const maxed = theme({ ...FIT_CEILINGS });

    expect(fillCandidates(maxed)).toEqual([]);
    expect(canFill(maxed)).toBe(false);
    expect(canFill(theme())).toBe(true);
  });

  test("the two ladders never overlap: one only tightens, the other only loosens", () => {
    const start = theme({ lineSpacing: 1.25, marginSize: 14, fontSizeScale: 1 });

    for (const candidate of fitCandidates(start)) {
      expect(candidate.lineSpacing).toBeLessThanOrEqual(start.lineSpacing);
    }
    for (const candidate of fillCandidates(start)) {
      expect(candidate.lineSpacing).toBeGreaterThanOrEqual(start.lineSpacing);
    }
  });
});

/**
 * The two thresholds do different jobs and must not drift into each other: the
 * target is what a fill aims for, the offer threshold is how far short of it a page
 * has to fall before the editor mentions it. Collapsing them would greet new
 * resumes with a banner, since a template's theme is tuned against the longest
 * sample that shares it and shorter siblings open below target.
 */
describe("fill thresholds", () => {
  test("the offer threshold sits below the target, leaving a deadband", () => {
    expect(FILL_OFFER_BELOW).toBeLessThan(TARGET_FILL);
    // Wide enough to cover a couple of lines of slack, narrow enough that a real
    // band of dead space still gets caught.
    expect(TARGET_FILL - FILL_OFFER_BELOW).toBeGreaterThanOrEqual(0.04);
  });

  test("both leave room to keep typing before a second sheet", () => {
    expect(TARGET_FILL).toBeLessThan(1);
  });
});

describe("describeFit", () => {
  test("names only what moved, in the units the sliders show", () => {
    const before = theme({ lineSpacing: 1.25, marginSize: 14, fontSizeScale: 1 });
    const after = theme({ lineSpacing: 1.15, marginSize: 14, fontSizeScale: 0.95 });

    expect(describeFit(before, after)).toEqual(["line height 1.25 → 1.15", "text size 100% → 95%"]);
  });

  test("says nothing when nothing moved", () => {
    expect(describeFit(theme(), theme())).toEqual([]);
  });
});

describe("describeDrift", () => {
  test("names the settings loosened past the template, and only those", () => {
    const template = theme({ lineSpacing: 1.19, marginSize: 14, fontSizeScale: 1 });
    // Line height loosened, margins tightened, text size untouched.
    const drifted = theme({ lineSpacing: 1.3, marginSize: 12, fontSizeScale: 1 });

    expect(describeDrift(drifted, template)).toEqual([
      "line height is 1.30, where this template sets 1.19",
    ]);
  });

  test("says nothing when the resume is on the template's own settings", () => {
    const template = theme({ lineSpacing: 1.19, marginSize: 14 });
    expect(describeDrift(theme({ lineSpacing: 1.19, marginSize: 14 }), template)).toEqual([]);
  });
});
