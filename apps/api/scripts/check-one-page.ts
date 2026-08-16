/**
 * Measures every default a new resume can open with, and reports the two numbers
 * that decide whether that default is any good: how many sheets it needs, and how
 * full the first one is.
 *
 * Why a script rather than a unit test: fit is a *layout* property. It depends on
 * real font metrics, real line breaking and real margin collapsing, none of which
 * exist without a browser. This drives the same pipeline `exportResumePdf` does —
 * `renderMeasureHtml`, then `measureFlow` in the page, then `packBlocks` — so a
 * combination that reads as one page here is one page in the editor and in the
 * PDF, by construction rather than by resemblance.
 *
 * Needs a Chromium: `bun run browsers:install` once.
 *
 *   bun run check:one-page            # every reachable default
 *   bun run check:one-page classic    # only templates whose slug contains this
 */
import puppeteer, { type Page } from "puppeteer";
import type { ResumeContent, Theme } from "@repo/types";
import { ALL_TEMPLATES, PROFESSIONS } from "@repo/db/catalog";
import { SAMPLE_CONTENT } from "@repo/db/sample-content";
import { SAMPLE_CONTENT_BY_PROFESSION } from "@repo/db/samples";
import {
  forcedBreakIds,
  measureArgs,
  measureFlow,
  packBlocks,
  type MeasuredFlow,
} from "@repo/ui/resume/paginate";
import { renderMeasureHtml, renderResumeHtml } from "../src/services/pdf.js";

/**
 * How full sheet one has to be before a one-page resume reads as finished rather
 * than as a stub. Below about three-quarters there is a visible band of dead
 * space above the bottom margin, which is what makes a sample look unfinished.
 */
const MIN_FILL = 0.74;

/** The mirror's root, matching what `renderMeasureHtml` emits. */
const MEASURE_ROOT = "[data-measure-root]";

type Combination = {
  /** Where this default comes from: a profession's sample, or a template's own. */
  source: string;
  templateSlug: string;
  theme: Theme;
  content: ResumeContent;
};

type Measurement = {
  sheets: number;
  /** Content height on sheet one as a fraction of the usable height. */
  fill: number;
};

/**
 * Every (sample, template) pair a real user can actually land on.
 *
 * Two families, because `POST /resumes` resolves content as
 * `professionSample ?? template.sampleContent`:
 *
 *  - a profession's own sample, in each template curated for that profession;
 *  - the seeded template sample, in *every* template — the gallery is browsable
 *    unfiltered, so any template can be picked with no profession chosen.
 *
 * The second family is the one that's easy to forget: `seed.ts` writes the same
 * `SAMPLE_CONTENT` to all seventeen templates, so a sample tuned only against
 * Jake's tight margins still has to survive Classic Journal's wide ones.
 */
function combinations(filter: string | undefined): Combination[] {
  const themeBySlug = new Map(ALL_TEMPLATES.map((template) => [template.slug, template]));
  const out: Combination[] = [];

  const add = (source: string, slug: string, content: ResumeContent) => {
    const template = themeBySlug.get(slug);
    if (!template) throw new Error(`${source} lists unknown template "${slug}"`);
    if (filter && !slug.includes(filter)) return;
    out.push({ source, templateSlug: slug, theme: template.defaultTheme, content });
  };

  for (const template of ALL_TEMPLATES) {
    add("template default", template.slug, SAMPLE_CONTENT);
  }

  for (const profession of PROFESSIONS) {
    const content = SAMPLE_CONTENT_BY_PROFESSION[profession.slug];
    // No sample of its own means it falls back to the template's, already covered.
    if (!content) continue;
    for (const slug of profession.templates) add(profession.slug, slug, content);
  }

  return out;
}

/**
 * Height sheet one carries, per the same arithmetic `packBlocks` uses.
 *
 * Each column is summed separately and the taller one wins. Two-column templates
 * pack their columns independently against the full sheet height, so what fills
 * the page is the longer of the two — adding them together would report a
 * comfortable sidebar layout as overfull.
 */
function fillRatio(flow: MeasuredFlow): number {
  const used = (column: string) =>
    flow.blocks
      .filter((block) => block.column === column)
      .reduce((sum, block) => sum + block.height + block.gapBefore, flow.headerHeight);

  return Math.max(used("main"), used("side")) / flow.usableHeight;
}

/** Renders one combination into `page` and reads its sheet count and fill. */
async function measure(page: Page, combo: Combination): Promise<Measurement> {
  const args = {
    templateSlug: combo.templateSlug,
    content: combo.content,
    theme: combo.theme,
  };

  await page.setContent(renderMeasureHtml(args), { waitUntil: "load" });
  // Base64 @font-face decoding is async; measuring first would use fallback
  // metrics and shift every line.
  await page.evaluate(() => document.fonts.ready);

  const flow = await page.evaluate(measureFlow, measureArgs(MEASURE_ROOT));
  if (flow.usableHeight <= 0) throw new Error(`mirror rendered nothing for ${combo.templateSlug}`);

  const layout = packBlocks({ ...flow, forcedBreaks: forcedBreakIds(combo.content) });

  // Render the packed document too, and trust the sheet count it actually
  // produces over the one the packer intended.
  await page.setContent(renderResumeHtml({ ...args, layout }), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const sheets = await page.evaluate(() => document.querySelectorAll(".rd-page").length);

  if (sheets !== layout.length) {
    throw new Error(
      `${combo.templateSlug}: packer said ${layout.length} sheets, renderer drew ${sheets}`,
    );
  }

  return { sheets, fill: fillRatio(flow) };
}

async function main(): Promise<void> {
  const filter = process.argv[2];
  const combos = combinations(filter);
  if (combos.length === 0) {
    console.error(`No combinations match "${filter}".`);
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
  });

  const overfull: string[] = [];
  const underfull: string[] = [];

  try {
    const page = await browser.newPage();
    // Wide enough that a Letter sheet (816px) never meets the viewport edge.
    await page.setViewport({ width: 1200, height: 1600 });

    let source = "";
    for (const combo of combos) {
      if (combo.source !== source) {
        source = combo.source;
        console.log(`\n${source}`);
      }

      const { sheets, fill } = await measure(page, combo);
      const percent = `${(fill * 100).toFixed(0)}%`.padStart(4);
      const where = `${combo.source}/${combo.templateSlug} (${sheets} sheet${sheets === 1 ? "" : "s"}, fill ${percent})`;

      let verdict = "  ok  ";
      if (sheets > 1) {
        verdict = "OVER  ";
        overfull.push(where);
      } else if (fill < MIN_FILL) {
        verdict = "under ";
        underfull.push(where);
      }

      console.log(
        `  ${verdict}${combo.templateSlug.padEnd(24)} ${sheets} sheet${sheets === 1 ? " " : "s"}  fill ${percent}`,
      );
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${combos.length} default${combos.length === 1 ? "" : "s"} measured.`);

  if (overfull.length > 0) {
    console.log(`\n${overfull.length} run past one page:`);
    for (const line of overfull) console.log(`  ${line}`);
  }
  if (underfull.length > 0) {
    console.log(`\n${underfull.length} under ${(MIN_FILL * 100).toFixed(0)}% of a page:`);
    for (const line of underfull) console.log(`  ${line}`);
  }
  if (overfull.length === 0 && underfull.length === 0) {
    console.log("\nEvery seeded default fills exactly one page.");
  }

  // Only overflow fails the run: an underfull sample is a judgement call about
  // copy, while an overfull one breaks the promise that a new resume is one page.
  process.exit(overfull.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
