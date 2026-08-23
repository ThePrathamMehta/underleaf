/**
 * Pushes the repo's sample content to the Template and Profession rows, and
 * nothing else.
 *
 * `db:seed` would do this too, but it does considerably more on the way past:
 * it rewrites every plan's `stripePriceId` from the environment (nulling it when
 * the variable is unset), deletes template-profession mappings that curation no
 * longer lists, and promotes accounts named in `ADMIN_EMAILS`. None of that is
 * implied by "the samples were retuned", and each is a way for a content change
 * to break something unrelated. So this writes the two `sampleContent` columns
 * and stops.
 *
 * Existing resumes are untouched by design: `POST /resumes` copies the sample
 * into the new row at creation, so a user's document is theirs from that moment
 * and nothing here reaches back into it. Only newly created resumes pick up the
 * retuned content.
 *
 * Reports shape only — section, item and bullet counts — never field text, so the
 * output is safe to paste into an issue.
 *
 *   bun run db:reseed-samples
 */
import { isBlankTemplate, createBlankCanvasContent, resumeContentSchema } from "@repo/types";
import type { ResumeContent } from "@repo/types";
import { prisma } from "../src/index.js";
import { ALL_TEMPLATES, PROFESSIONS } from "../src/catalog.js";
import { SAMPLE_CONTENT } from "../src/sample-content.js";
import { SAMPLE_CONTENT_BY_PROFESSION } from "../src/samples/index.js";

/** Counts that describe a document's size without quoting any of it. */
function shape(content: ResumeContent): string {
  const items = content.sections.reduce((sum, section) => sum + (section.items?.length ?? 0), 0);
  const bullets = content.sections.reduce((sum, section) => {
    const list = (section.items ?? []) as { bullets?: string[] }[];
    return sum + list.reduce((n, item) => n + (item.bullets?.length ?? 0), 0);
  }, 0);
  return `${content.sections.length} sections / ${items} items / ${bullets} bullets`;
}

async function main(): Promise<void> {
  // Parsed before anything is written, for the same reason the seed does it: a
  // sample the API's own validation would reject should stop the run rather than
  // land in the gallery and fail to render.
  const shared = resumeContentSchema.parse(SAMPLE_CONTENT);
  const blank = resumeContentSchema.parse(createBlankCanvasContent());

  console.log(`shared sample: ${shape(shared)}\n`);

  let templates = 0;
  for (const template of ALL_TEMPLATES) {
    const content = isBlankTemplate(template.slug) ? blank : shared;
    // `updateMany`, not `update`: a slug that was never seeded should be reported
    // as missing rather than throw and abandon the rows after it.
    const { count } = await prisma.template.updateMany({
      where: { slug: template.slug },
      data: { sampleContent: content },
    });

    if (count === 0) {
      console.log(`  MISSING ${template.slug} — never seeded, run db:seed once`);
      continue;
    }
    templates += count;
  }

  console.log(`Updated ${templates} of ${ALL_TEMPLATES.length} template rows.\n`);

  let professions = 0;
  for (const profession of PROFESSIONS) {
    const sample = SAMPLE_CONTENT_BY_PROFESSION[profession.slug];
    // No sample of its own means the row should stay as it is — it falls back to
    // the template's, and writing DbNull here would be a change, not a no-op.
    if (!sample) continue;

    const parsed = resumeContentSchema.parse(sample);
    const { count } = await prisma.profession.updateMany({
      where: { slug: profession.slug },
      data: { sampleContent: parsed },
    });

    if (count === 0) {
      console.log(`  MISSING ${profession.slug} — never seeded, run db:seed once`);
      continue;
    }

    professions += count;
    console.log(`  ${profession.slug.padEnd(18)} ${shape(parsed)}`);
  }

  console.log(`\nUpdated ${professions} profession rows.`);

  const resumes = await prisma.resume.count();
  console.log(
    `\n${resumes} existing resume(s) unchanged — content is copied at creation, not referenced.`,
  );
}

main()
  .catch((error) => {
    console.error("Re-seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
