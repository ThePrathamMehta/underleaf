/**
 * Read-only: compares the sample content each Template row holds against the
 * catalog in this repo, so a "my templates are two pages" report can be pinned on
 * either the code or the database before anything is written.
 *
 * Reports shape only — section and bullet counts — never field text.
 */
import { PrismaClient } from "@prisma/client";
import { ALL_TEMPLATES } from "../src/catalog";
import { SAMPLE_CONTENT } from "../src/sample-content";
import type { ResumeContent } from "@repo/types";

const prisma = new PrismaClient();

function shape(content: unknown): string {
  const parsed = content as ResumeContent | null;
  if (!parsed?.sections) return "none";

  const bullets = parsed.sections.reduce((sum, section) => {
    const items = (section.items ?? []) as { bullets?: string[] }[];
    return sum + items.reduce((n, item) => n + (item.bullets?.length ?? 0), 0);
  }, 0);

  const items = parsed.sections.reduce((sum, s) => sum + (s.items?.length ?? 0), 0);
  return `${parsed.sections.length} sections / ${items} items / ${bullets} bullets`;
}

const expected = shape(SAMPLE_CONTENT);
console.log(`repo catalog sample: ${expected}\n`);

const rows = await prisma.template.findMany({ select: { slug: true, sampleContent: true } });
const known = new Set(ALL_TEMPLATES.map((t) => t.slug));

let stale = 0;
for (const row of rows.sort((a, b) => a.slug.localeCompare(b.slug))) {
  const actual = shape(row.sampleContent);
  const blank = row.slug === "blank";
  const matches = blank || actual === expected;
  if (!matches) stale++;
  console.log(`  ${matches ? "ok   " : "STALE"} ${row.slug.padEnd(24)} ${actual}`);
  if (!known.has(row.slug)) console.log(`         (not in the repo catalog)`);
}

const missing = [...known].filter((slug) => !rows.some((r) => r.slug === slug));

console.log(`\n${rows.length} template rows, ${stale} stale.`);
if (missing.length > 0) console.log(`Never seeded: ${missing.join(", ")}`);

const resumes = await prisma.resume.count();
console.log(`${resumes} existing resume(s) — their content was copied at creation and is unaffected by seeding.`);

await prisma.$disconnect();
