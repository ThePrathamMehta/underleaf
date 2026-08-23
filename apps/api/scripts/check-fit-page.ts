/**
 * Exercises "Fit to one page" against real layout.
 *
 * The ladder `fitCandidates` produces is unit-tested and pure. What isn't
 * testable without a browser is the search that consumes it: whether writing a
 * candidate's CSS variables onto the mirror actually re-lays-out the document,
 * whether the mirror's root is where the search thinks it is, and whether the
 * variables get put back afterwards. Those are the three ways this feature can be
 * quietly broken while every unit test still passes, so they get measured here,
 * in the same pipeline the editor and the PDF use.
 *
 * Deliberately starts from an *overfull* document. The seeded samples all fit, so
 * measuring them would prove nothing about fitting; the check inflates one until
 * it spills onto a second sheet, then asks the search to bring it back.
 *
 * Needs a Chromium: `bun run browsers:install` once.
 *
 *   bun run check:fit-page
 */
import puppeteer from "puppeteer";
import { fileURLToPath } from "node:url";
import type { ExperienceItem, ResumeContent, Theme } from "@repo/types";
import { ALL_TEMPLATES } from "@repo/db/catalog";
import { SAMPLE_CONTENT } from "@repo/db/sample-content";
import { FIT_FLOORS, type searchFit } from "@repo/ui/resume/fit-page";
import { forcedBreakIds, measureArgs, measureFlow, packBlocks } from "@repo/ui/resume/paginate";
import { renderMeasureHtml } from "../src/services/pdf.js";

const MEASURE_ROOT = "[data-measure-root]";

/** What `fit-page-browser.ts` parks on the page's `globalThis`. */
type SearchFit = typeof searchFit;

/**
 * The one Bun global this script needs.
 *
 * The API's types are Node's — `@types/bun` isn't a dependency, and adding it for
 * a single script would put Bun's globals in scope for the whole server, where
 * they'd invite code that only runs under Bun. Declaring the bundler here keeps
 * that confined to the check that actually needs it.
 */
declare const Bun: {
  build(options: {
    entrypoints: string[];
    target?: "browser" | "bun" | "node";
    minify?: boolean;
  }): Promise<{ success: boolean; logs: unknown[]; outputs: { text(): Promise<string> }[] }>;
};

/** Templates to check: one single-column, one two-column, one with a band. */
const SLUGS = ["jakes", "deedy", "creative"];

/**
 * The sample with `extra` more bullets on its first job — enough to overflow.
 *
 * Bullets rather than a whole section, because a bullet is the smallest thing a
 * page can be short of, which is the case the fit action exists for: the resume
 * that misses by four lines rather than by half a page.
 */
function inflated(extra: number): ResumeContent {
  return {
    ...SAMPLE_CONTENT,
    sections: SAMPLE_CONTENT.sections.map((section) =>
      section.type === "experience"
        ? {
            ...section,
            items: section.items.map((item, index) =>
              index === 0
                ? {
                    ...item,
                    bullets: [
                      ...(item as ExperienceItem).bullets,
                      ...Array.from(
                        { length: extra },
                        (_, n) =>
                          `Additional responsibility number ${n + 1}, written at about the length a real bullet runs to so the line count is honest.`,
                      ),
                    ],
                  }
                : item,
            ),
          }
        : section,
    ) as ResumeContent["sections"],
  };
}

async function main(): Promise<void> {
  // Bundled rather than evaluated: see fit-page-browser.ts. `fileURLToPath`
  // rather than `.pathname`, which on Windows yields a leading-slash path the
  // bundler can't open.
  const bundle = await Bun.build({
    entrypoints: [fileURLToPath(new URL("./fit-page-browser.ts", import.meta.url))],
    target: "browser",
    minify: false,
  });
  if (!bundle.success) {
    for (const log of bundle.logs) console.error(log);
    throw new Error("could not bundle the fit search for the browser");
  }
  const script = await bundle.outputs[0]!.text();

  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
  });

  const failures: string[] = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 1600 });

    for (const slug of SLUGS) {
      const template = ALL_TEMPLATES.find((entry) => entry.slug === slug);
      if (!template) throw new Error(`unknown template "${slug}"`);

      const theme = template.defaultTheme;

      /** Sheets this content needs, from a clean render of the mirror. */
      const sheetsFor = async (content: ResumeContent, candidate: Theme): Promise<number> => {
        await page.setContent(
          renderMeasureHtml({ templateSlug: slug, content, theme: candidate }),
          { waitUntil: "load" },
        );
        await page.evaluate(() => document.fonts.ready);
        const flow = await page.evaluate(measureFlow, measureArgs(MEASURE_ROOT));
        if (flow.usableHeight <= 0) throw new Error(`mirror rendered nothing for ${slug}`);
        return packBlocks({ ...flow, forcedBreaks: forcedBreakIds(content) }).length;
      };

      // How far over is decided per template, not guessed: a two-column layout
      // absorbs four extra bullets that a single-column one spills on. Escalating
      // to the first amount that actually overflows keeps every template measured
      // at the case this feature is for — just barely over.
      let content: ResumeContent | null = null;
      let before = 1;
      for (const extra of [3, 6, 10, 16, 24]) {
        const candidate = inflated(extra);
        const sheets = await sheetsFor(candidate, theme);
        if (sheets > 1) {
          content = candidate;
          before = sheets;
          break;
        }
      }

      if (!content) {
        failures.push(`${slug}: could not make the sample overflow — this check proves nothing`);
        console.log(`  SKIP   ${slug.padEnd(12)} never overflowed, even with 24 extra bullets`);
        continue;
      }

      // Back to the overfull render, and inject the real module into it.
      await sheetsFor(content, theme);
      await page.addScriptTag({ content: script });

      // The search itself, in the page, against the mirror it was written for.
      const fitted = await page.evaluate(
        (measureRoot: string, candidateTheme: Theme, targetPages: number) => {
          const search = (globalThis as unknown as { __searchFit: SearchFit }).__searchFit;
          const root = document.querySelector(measureRoot)!.querySelector<HTMLElement>(".rd-root")!;
          // Every custom property the document is set with, by resolved value.
          // Comparing the style *attribute* as a string would fail on formatting
          // alone: React serialises it one way and CSSOM another.
          const vars = () =>
            Array.from(root.style)
              .filter((name) => name.startsWith("--rd-"))
              .map((name) => `${name}:${root.style.getPropertyValue(name)}`)
              .sort()
              .join(";");

          const varsBefore = vars();
          const result = search({
            measureRoot,
            theme: candidateTheme,
            // The document is on its template's own theme here, so phase 1 of the
            // ladder has nothing to revert and the search has to earn the fit by
            // going below it — the harder of the two paths.
            templateDefault: candidateTheme,
            // A Set can't cross the evaluate boundary, so it's built in here.
            forcedBreaks: new Set<string>(),
            targetPages,
          });

          return { result, restored: vars() === varsBefore };
        },
        MEASURE_ROOT,
        theme,
        1,
      );

      if (!fitted.result) {
        failures.push(`${slug}: overflowed by a few bullets and the search found nothing`);
        console.log(`  FAIL   ${slug.padEnd(12)} ${before} sheets → no fit found`);
        continue;
      }

      if (!fitted.restored) {
        failures.push(`${slug}: the search left the mirror on a candidate's variables`);
      }

      // Independently verify the winner, from a clean render — the search's own
      // answer is not evidence that the theme it returned produces one sheet.
      const after = await sheetsFor(content, fitted.result);

      const floored =
        fitted.result.lineSpacing < FIT_FLOORS.lineSpacing ||
        fitted.result.marginSize < FIT_FLOORS.marginSize ||
        fitted.result.fontSizeScale < FIT_FLOORS.fontSizeScale;
      if (floored) failures.push(`${slug}: the fit went past the floors`);
      if (after > 1) failures.push(`${slug}: the fitted theme still renders ${after} sheets`);

      const changes =
        `leading ${theme.lineSpacing.toFixed(2)}→${fitted.result.lineSpacing.toFixed(2)}` +
        `  margin ${theme.marginSize}→${fitted.result.marginSize}mm` +
        `  scale ${theme.fontSizeScale.toFixed(2)}→${fitted.result.fontSizeScale.toFixed(2)}`;

      console.log(
        `  ${after === 1 && !floored && fitted.restored ? "ok  " : "FAIL"}   ${slug.padEnd(12)} ${before} sheets → ${after}  ${changes}` +
          `${fitted.restored ? "" : "  (mirror not restored)"}`,
      );
    }
  } finally {
    await browser.close();
  }

  if (failures.length > 0) {
    console.log(`\n${failures.length} problem(s):`);
    for (const line of failures) console.log(`  ${line}`);
    process.exit(1);
  }

  console.log("\nEvery overfull document was fitted back to one page, within the floors.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
