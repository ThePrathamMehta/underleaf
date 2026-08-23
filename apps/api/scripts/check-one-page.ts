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
import { isBlankTemplate } from "@repo/types";
import { ALL_TEMPLATES, PROFESSIONS } from "@repo/db/catalog";
import { SAMPLE_CONTENT } from "@repo/db/sample-content";
import { SAMPLE_CONTENT_BY_PROFESSION } from "@repo/db/samples";
import {
  fillRatio,
  forcedBreakIds,
  measureArgs,
  measureFlow,
  packBlocks,
} from "@repo/ui/resume/paginate";
import { renderMeasureHtml, renderResumeHtml } from "../src/services/pdf.js";

/**
 * How full sheet one has to be before a one-page resume reads as finished rather
 * than as a stub. Below this there is a visible band of dead space above the bottom
 * margin, which is what makes a sample look unfinished.
 *
 * Set well under `TARGET_FILL`, the figure each template's `defaultTheme` is tuned
 * to by `check:tune-themes`, because a template's theme is shared by every document
 * that can reach it and those documents are not the same length. The tuner grows a
 * theme until the *fullest* reachable document approaches the target — any further
 * and that one would be a typed word from a second sheet — so a shorter sibling
 * under the same theme necessarily lands lower, by however much shorter it is. The
 * `general` sample is about a fifth shorter than the longest profession samples,
 * and its rows sit ten-odd points below target as a direct result.
 *
 * So a row under this threshold is a statement about content length, not a defect in
 * the theme: it marks the combinations where sharing one theme costs the most, which
 * is worth a human glance and nothing more. Closing those gaps would mean either
 * per-(profession, template) themes or lengthening the short samples — and the
 * latter would invalidate every tuned number here, since the tuning was measured
 * against the samples exactly as they stand.
 *
 * This used to sit at 0.74, with a note that the dense layouts — `jakes--compact`
 * and the two-column `deedy` family — were *expected* to come in low, because one
 * shared sample cannot fill templates that differ by ~22 points in capacity. That
 * reasoning applied when every template rendered the same sample at roughly the
 * same type size. Now the typography is tuned per template, so those layouts are no
 * longer special and a low fill is a real finding again.
 */
const MIN_FILL = 0.84;

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
    // The blank canvas has no sample to fit: its content is one empty heading,
    // and "is the first sheet three-quarters full" is not a question about it.
    if (isBlankTemplate(template.slug)) continue;
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
