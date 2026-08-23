/**
 * Measures the resumes that already exist, the same way an export does.
 *
 * Read-only, and separate from `check-one-page.ts` because it answers a different
 * question. That script measures the *defaults* a new resume opens with. This one
 * measures documents already in the database — whose content was copied out of a
 * sample at creation time, so a resume made before the samples were trimmed still
 * holds the longer version and is unaffected by re-seeding.
 *
 * Reports geometry only: sheet count, fill, and how much content is there. Never
 * field text, since these are real users' documents.
 *
 *   bun run check:existing-pages
 */
import puppeteer from "puppeteer";
import { prisma } from "@repo/db";
import { resumeContentSchema, themeSchema } from "@repo/types";
import {
  forcedBreakIds,
  measureArgs,
  measureFlow,
  packBlocks,
} from "@repo/ui/resume/paginate";
import { renderMeasureHtml, renderResumeHtml } from "../src/services/pdf.js";

const MEASURE_ROOT = "[data-measure-root]";

async function main(): Promise<void> {
  const resumes = await prisma.resume.findMany({
    select: {
      id: true,
      title: true,
      content: true,
      theme: true,
      createdAt: true,
      template: { select: { slug: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (resumes.length === 0) {
    console.log("No resumes yet.");
    return;
  }

  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
  });

  const over: string[] = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 1600 });

    for (const resume of resumes) {
      const content = resumeContentSchema.safeParse(resume.content);
      const theme = themeSchema.safeParse(resume.theme);
      if (!content.success || !theme.success) {
        console.log(`  skip   ${resume.id}  (content or theme does not validate)`);
        continue;
      }

      const args = { templateSlug: resume.template.slug, content: content.data, theme: theme.data };

      await page.setContent(renderMeasureHtml(args), { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      const flow = await page.evaluate(measureFlow, measureArgs(MEASURE_ROOT));
      const layout = packBlocks({ ...flow, forcedBreaks: forcedBreakIds(content.data) });

      await page.setContent(renderResumeHtml({ ...args, layout }), { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      const sheets = await page.evaluate(() => document.querySelectorAll(".rd-page").length);

      // A sheet the user asked for is not overflow. Anything beyond the forced
      // breaks is the document outgrowing the page on its own. (`forcedBreakIds`
      // returns a Set — `.length` on it is silently `undefined`, which would make
      // every overflow read as intentional.)
      const forced = forcedBreakIds(content.data).size;
      const bullets = content.data.sections.reduce(
        (sum, section) =>
          sum +
          section.items.reduce(
            (n, item) => n + (("bullets" in item ? item.bullets : undefined)?.length ?? 0),
            0,
          ),
        0,
      );

      const label =
        `${resume.template.slug.padEnd(22)} ${sheets} sheet${sheets === 1 ? " " : "s"}` +
        `  ${String(content.data.sections.length).padStart(2)} sections` +
        `  ${String(bullets).padStart(2)} bullets` +
        `${forced > 0 ? `  (${forced} break${forced === 1 ? "" : "s"} you added)` : ""}`;

      const natural = sheets - forced;
      if (natural > 1) {
        over.push(`${resume.id}  ${resume.template.slug}  ${sheets} sheets`);
        console.log(`  OVER   ${label}`);
      } else {
        console.log(`  ok     ${label}`);
      }
    }
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }

  console.log(`\n${resumes.length} existing resume(s) measured.`);
  if (over.length > 0) {
    console.log(`\n${over.length} run past one page on their own:`);
    for (const line of over) console.log(`  ${line}`);
    console.log(
      "\nThese hold content copied from a sample at creation time, so trimming the\n" +
        "seeded samples does not change them. A resume created now would be one page.",
    );
  } else {
    console.log("\nEvery existing resume is one page, or as many as its own breaks ask for.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
