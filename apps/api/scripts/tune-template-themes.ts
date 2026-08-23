/**
 * Works out the typography each template should open with so that a new resume
 * fills its page, and prints the numbers to paste into `catalog.ts`.
 *
 * The problem this solves: one shared sample cannot fill seventeen templates. They
 * differ by roughly twenty percentage points in how much they hold, so content long
 * enough to fill the roomiest overflows the densest. Growing the *typography* per
 * template fills every one of them without touching a word of content — a fraction
 * more line height, a hair more type size, a millimetre more margin.
 *
 * Why a script rather than a unit test, and why print rather than write: fit is a
 * layout property that needs real font metrics and real line breaking, so it needs a
 * browser; and the result is a design decision about seventeen templates, which
 * belongs in a reviewed diff rather than in a file this rewrote on its own.
 *
 * Needs a Chromium: `bun run browsers:install` once.
 *
 *   bun run check:tune-themes            # every template
 *   bun run check:tune-themes classic    # only templates whose slug contains this
 */
import puppeteer, { type Page } from "puppeteer";
import type { ResumeContent, Theme } from "@repo/types";
import { isBlankTemplate } from "@repo/types";
import { ALL_TEMPLATES, PROFESSIONS, TEMPLATES } from "@repo/db/catalog";
import { SAMPLE_CONTENT } from "@repo/db/sample-content";
import { SAMPLE_CONTENT_BY_PROFESSION } from "@repo/db/samples";
import { fillCandidates, TARGET_FILL } from "@repo/ui/resume/fit-page";
import {
  fillRatio,
  forcedBreakIds,
  measureArgs,
  measureFlow,
  packBlocks,
} from "@repo/ui/resume/paginate";
import { themeToCssVars } from "@repo/ui/resume/styles";
import { renderMeasureHtml } from "../src/services/pdf.js";

const MEASURE_ROOT = "[data-measure-root]";

/** The three knobs a fit or fill may move; nothing else is tuned here. */
const KNOBS = ["lineSpacing", "marginSize", "fontSizeScale"] as const;

type Knob = (typeof KNOBS)[number];

/** One document a template has to render, and where it comes from. */
type Reachable = {
  /** A profession slug, or "template default" for the shared sample. */
  source: string;
  content: ResumeContent;
};

type Outcome = { sheets: number; fill: number };

/**
 * Every content a template can actually be asked to render, because a
 * `defaultTheme` is shared by all of them.
 *
 * `POST /resumes` resolves content as `professionSample ?? template.sampleContent`,
 * so a template curated for three professions has four documents to satisfy — the
 * three samples plus the shared one, since the gallery is browsable with no
 * profession chosen at all. Tuning against only the shared sample would leave the
 * longest profession sample overflowing, which is the one regression this must not
 * introduce.
 */
function reachableContents(slug: string): Reachable[] {
  const out: Reachable[] = [{ source: "template default", content: SAMPLE_CONTENT }];

  for (const profession of PROFESSIONS) {
    if (!profession.templates.includes(slug)) continue;
    const content = SAMPLE_CONTENT_BY_PROFESSION[profession.slug];
    // No sample of its own means it falls back to the shared one, already listed.
    if (content) out.push({ source: profession.slug, content });
  }

  return out;
}

/**
 * Measures one already-rendered document under a candidate theme.
 *
 * Writes the candidate's CSS custom properties onto the mirror and re-reads the
 * flow, which is what makes a ladder of sixty candidates affordable: no re-render,
 * no font reload. The same trick `searchFill` uses in the browser, for the same
 * reason.
 */
async function measureCandidate(
  page: Page,
  candidate: Theme,
  forcedBreaks: Set<string>,
): Promise<Outcome | null> {
  await page.evaluate(
    (vars: Record<string, string>, root: string) => {
      const element = document
        .querySelector(root)
        ?.querySelector<HTMLElement>(".rd-root");
      if (!element) throw new Error("measuring mirror has no .rd-root");
      for (const [name, value] of Object.entries(vars)) element.style.setProperty(name, value);
    },
    themeToCssVars(candidate),
    MEASURE_ROOT,
  );

  const flow = await page.evaluate(measureFlow, measureArgs(MEASURE_ROOT));
  if (flow.usableHeight <= 0) return null;

  return { sheets: packBlocks({ ...flow, forcedBreaks }).length, fill: fillRatio(flow) };
}

/**
 * Walks the ladder for one document and reports what each rung costs.
 *
 * Stops at the first candidate needing a second sheet: fill only rises from there,
 * so nothing looser can be safe either. The returned array is therefore shorter than
 * the ladder, and a candidate with no entry is one this document rules out.
 */
async function walk(
  page: Page,
  templateSlug: string,
  reachable: Reachable,
  ladder: Theme[],
  theme: Theme,
): Promise<{ start: Outcome; rungs: Outcome[] }> {
  const args = { templateSlug, content: reachable.content, theme };

  await page.setContent(renderMeasureHtml(args), { waitUntil: "load" });
  // Base64 @font-face decoding is async; measuring first would use fallback
  // metrics and shift every line.
  await page.evaluate(() => document.fonts.ready);

  const forcedBreaks = forcedBreakIds(reachable.content);

  const start = await measureCandidate(page, theme, forcedBreaks);
  if (!start) throw new Error(`mirror rendered nothing for ${templateSlug}`);

  const rungs: Outcome[] = [];
  for (const candidate of ladder) {
    const outcome = await measureCandidate(page, candidate, forcedBreaks);
    if (!outcome || outcome.sheets > 1) break;
    rungs.push(outcome);
  }

  return { start, rungs };
}

type Tuned = {
  slug: string;
  theme: Theme;
  /** Fill before and after, worst case across every reachable document. */
  before: number;
  after: number;
  /** Which document stopped the growth, when something did. */
  boundBy: string | null;
  /** True when even the first rung cost a second sheet somewhere. */
  stuck: boolean;
};

/**
 * The loosest theme that keeps *every* reachable document on one sheet, without
 * pushing any of them to the page edge.
 *
 * Three stopping conditions, earliest wins:
 *
 *  - a candidate any document rejects outright, because the theme serves all of them;
 *  - the **fullest** document reaching the target;
 *  - the ladder running out.
 *
 * The fullest, not the emptiest. Growth is shared but capacity isn't: on a template
 * curated for three professions, the longest sample reaches the foot of the page
 * while the shortest still has an inch to spare. Stopping when the *shortest* is
 * satisfied runs the longest to 99% — technically one page, but one typed word from
 * being two, which is the fragile edge this is supposed to avoid. So the document
 * with the least room left is the one that calls time, and a shorter sibling landing
 * below target is the honest cost of sharing a theme.
 */
async function tune(page: Page, slug: string, theme: Theme): Promise<Tuned> {
  const reachable = reachableContents(slug);
  // `theme` as its own template default, so phase 1 of the ladder is empty and the
  // walk starts at the template's own values rather than reverting toward them.
  const ladder = fillCandidates(theme, theme);

  // Sequential, not `Promise.all`: every walk drives the same tab through
  // `setContent`, so running them together would have each one measuring whichever
  // document happened to be loaded last.
  const walks: Awaited<ReturnType<typeof walk>>[] = [];
  for (const entry of reachable) {
    walks.push(await walk(page, slug, entry, ladder, theme));
  }

  const before = Math.max(...walks.map((w) => w.start.fill));
  // How far every document got before it needed a second sheet.
  const safeDepth = Math.min(...walks.map((w) => w.rungs.length));
  const limiting = walks.findIndex((w) => w.rungs.length === safeDepth);

  /** The fullest page any reachable document shows at this rung. */
  const fullest = (rung: number) => Math.max(...walks.map((w) => w.rungs[rung]!.fill));

  let best = -1;
  let reachedTarget = false;
  for (let rung = 0; rung < safeDepth; rung++) {
    // Take the rung that lands nearest the target from below, then stop: one step
    // past it is closer to overflowing than to the target.
    if (fullest(rung) > TARGET_FILL) {
      // Unless nothing has been accepted yet — the template starts fuller than the
      // target, or one step crosses it — in which case the nearer of the two sides
      // wins, so a coarse-stepping template isn't left at its original fill.
      if (best < 0 && TARGET_FILL - before > fullest(rung) - TARGET_FILL) best = rung;
      reachedTarget = true;
      break;
    }
    best = rung;
  }

  return {
    slug,
    theme: best >= 0 ? ladder[best]! : theme,
    before,
    after: best >= 0 ? Math.max(...walks.map((w) => w.rungs[best]!.fill)) : before,
    // Only meaningful when growth stopped short: it names the document that ran out
    // of room first, which is the one to shorten if this template must fill better.
    boundBy: reachedTarget ? null : (reachable[limiting]?.source ?? null),
    stuck: safeDepth === 0,
  };
}

const percent = (value: number) => `${(value * 100).toFixed(0)}%`.padStart(4);

/** Each knob as `catalog.ts` writes it: margins whole-ish, the other two to 2dp. */
const show = (knob: Knob, value: number) =>
  knob === "marginSize" ? String(value) : value.toFixed(2);

/**
 * The values to paste, as they should appear in `catalog.ts`.
 *
 * Variants are printed as full three-knob overrides rather than as diffs against
 * their parent. `expandVariants` merges `themeOverrides` over the base template's
 * theme, so a variant that inherited two knobs and overrode one would silently
 * change whenever the base was retuned — and each variant is tuned separately
 * anyway, because different fonts have different metrics.
 */
function paste(tuned: Tuned[]): void {
  const bases = new Set(TEMPLATES.map((template) => template.slug));

  console.log("\n--- paste into packages/db/src/catalog.ts ---");
  for (const entry of tuned) {
    const where = bases.has(entry.slug) ? "defaultTheme" : "themeOverrides";
    console.log(`\n  ${entry.slug}  (${where})`);
    for (const knob of KNOBS) console.log(`    ${knob}: ${show(knob, entry.theme[knob])},`);
  }
}

async function main(): Promise<void> {
  const filter = process.argv[2];

  const targets = ALL_TEMPLATES.filter(
    // A canvas paginates nothing and its sample is one empty heading, so "how full
    // is the first sheet" is not a question about it.
    (template) => !isBlankTemplate(template.slug) && (!filter || template.slug.includes(filter)),
  );

  if (targets.length === 0) {
    console.error(`No templates match "${filter}".`);
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
  });

  const tuned: Tuned[] = [];

  try {
    const page = await browser.newPage();
    // Wide enough that a Letter sheet (816px) never meets the viewport edge.
    await page.setViewport({ width: 1200, height: 1600 });

    console.log(`Tuning ${targets.length} template(s) toward ${percent(TARGET_FILL)} fill.\n`);

    for (const template of targets) {
      const entry = await tune(page, template.slug, template.defaultTheme);
      tuned.push(entry);

      const moved = KNOBS.filter((knob) => entry.theme[knob] !== template.defaultTheme[knob])
        .map((knob) => `${knob} ${show(knob, template.defaultTheme[knob])}→${show(knob, entry.theme[knob])}`)
        .join("  ");

      const note = entry.stuck
        ? "  already at capacity"
        : entry.boundBy
          ? `  (capped by ${entry.boundBy})`
          : "";

      console.log(
        `  ${template.slug.padEnd(24)} fill ${percent(entry.before)} → ${percent(entry.after)}` +
          `  ${moved || "unchanged"}${note}`,
      );
    }
  } finally {
    await browser.close();
  }

  const short = tuned.filter((entry) => entry.after < TARGET_FILL - 0.04);
  if (short.length > 0) {
    console.log(`\n${short.length} could not reach the target:`);
    for (const entry of short) {
      console.log(
        `  ${entry.slug.padEnd(24)} ${percent(entry.after)}` +
          `${entry.boundBy ? `  capped by ${entry.boundBy}` : "  ladder exhausted"}`,
      );
    }
    console.log(
      "\nA template shared by a long profession sample cannot grow past what that\n" +
        "sample allows. That is the honest limit, not a bug — the alternative is a\n" +
        "sample that overflows.",
    );
  }

  paste(tuned);
  console.log("\nNothing was written. Copy the values above into catalog.ts, then re-seed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
