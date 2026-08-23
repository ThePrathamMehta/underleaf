import type { PlanKey } from "@repo/types";
import {
  PLAN_DEFAULTS,
  PLAN_KEYS,
  createBlankCanvasContent,
  isBlankTemplate,
  themeSchema,
  resumeContentSchema,
} from "@repo/types";
import { Prisma, prisma } from "./index.js";
import { SAMPLE_CONTENT } from "./sample-content.js";
import { SAMPLE_CONTENT_BY_PROFESSION } from "./samples/index.js";
// The catalogue itself lives in `catalog.ts` so `scripts/check-one-page.ts` can
// measure the exact themes that get seeded without pulling in a Prisma client.
import { ALL_TEMPLATES, PROFESSIONS } from "./catalog.js";

async function main() {
  // Fail loudly at seed time rather than shipping a template the renderer or
  // the API's Zod validation would later reject.
  const sampleContent = resumeContentSchema.parse(SAMPLE_CONTENT);
  // The blank canvas previews as what it is: one empty heading on an empty page.
  // Sharing the general sample would show a fully written resume behind a card
  // that promises no structure at all.
  const blankSample = resumeContentSchema.parse(createBlankCanvasContent());

  const templateIdBySlug = new Map<string, string>();

  for (const template of ALL_TEMPLATES) {
    const defaultTheme = themeSchema.parse(template.defaultTheme);
    const content = isBlankTemplate(template.slug) ? blankSample : sampleContent;

    const row = await prisma.template.upsert({
      where: { slug: template.slug },
      create: {
        name: template.name,
        slug: template.slug,
        description: template.description,
        category: template.category,
        previewImageUrl: `/templates/${template.slug}.png`,
        defaultTheme,
        sampleContent: content,
      },
      update: {
        name: template.name,
        description: template.description,
        category: template.category,
        previewImageUrl: `/templates/${template.slug}.png`,
        defaultTheme,
        sampleContent: content,
      },
    });

    templateIdBySlug.set(template.slug, row.id);
    console.log(`  seeded template: ${template.name} (${template.slug})`);
  }

  console.log(`\nSeeded ${ALL_TEMPLATES.length} templates.\n`);

  for (const [index, profession] of PROFESSIONS.entries()) {
    // Validated here for the same reason template content is: a malformed
    // sample should stop the seed, not reach the gallery and fail to render.
    // A profession without one is allowed — it falls back to the template's.
    const sample = SAMPLE_CONTENT_BY_PROFESSION[profession.slug];
    // `DbNull`, not `null`: for a nullable Json column Prisma distinguishes a
    // SQL NULL from the JSON value `null`, and only the former is what "this
    // profession has no sample of its own" means.
    const sampleContent = sample ? resumeContentSchema.parse(sample) : Prisma.DbNull;

    const row = await prisma.profession.upsert({
      where: { slug: profession.slug },
      create: {
        name: profession.name,
        slug: profession.slug,
        description: profession.description,
        iconKey: profession.iconKey,
        sortOrder: index,
        sampleContent,
      },
      update: {
        name: profession.name,
        description: profession.description,
        iconKey: profession.iconKey,
        sortOrder: index,
        sampleContent,
      },
    });

    // Curation is authoritative: drop mappings that are no longer listed, so
    // re-running the seed after removing a pick actually removes it.
    await prisma.templateProfession.deleteMany({
      where: {
        professionId: row.id,
        template: { slug: { notIn: profession.templates } },
      },
    });

    for (const [rank, slug] of profession.templates.entries()) {
      const templateId = templateIdBySlug.get(slug);
      // A typo here would silently shrink a profession's list below the 5–7 the
      // gallery promises, so refuse rather than seed a short one.
      if (!templateId) {
        throw new Error(`Profession "${profession.slug}" lists unknown template "${slug}"`);
      }

      await prisma.templateProfession.upsert({
        where: { templateId_professionId: { templateId, professionId: row.id } },
        create: { templateId, professionId: row.id, rank },
        update: { rank },
      });
    }

    console.log(
      `  seeded profession: ${profession.name} (${profession.templates.length} templates` +
        `${sampleContent ? ", own sample" : ""})`,
    );
  }

  console.log(`\nSeeded ${PROFESSIONS.length} professions.`);

  await seedPlans();
  await promoteAdmins();
}

/**
 * Seeds the three membership tiers from `PLAN_DEFAULTS`.
 *
 * Prices and allowances are *created* from those defaults and then left alone on
 * re-runs, because Section 0 says these numbers should be tuned from real usage —
 * and a seed that reset them on every deploy would undo the tuning. What does get
 * written every run is `stripePriceId`, read from the environment: test-mode and
 * live-mode price ids differ, so it belongs to the deployment rather than the
 * data, and re-pointing a plan at a new Stripe Price should take a `db:seed`
 * rather than a hand-written UPDATE.
 */
async function seedPlans(): Promise<void> {
  for (const key of PLAN_KEYS as readonly PlanKey[]) {
    const plan = PLAN_DEFAULTS[key];
    const stripePriceId = plan.stripePriceEnv
      ? (process.env[plan.stripePriceEnv]?.trim() ?? null) || null
      : null;

    await prisma.plan.upsert({
      where: { key },
      create: {
        key,
        name: plan.name,
        priceCents: plan.priceCents,
        billingInterval: plan.billingInterval,
        durationDays: plan.durationDays,
        aiActionAllowance: plan.aiActionAllowance,
        isRenewing: plan.isRenewing,
        sortOrder: plan.sortOrder,
        stripePriceId,
      },
      // Name and order are presentation, safe to keep current. The numbers are
      // not: see above.
      update: { name: plan.name, sortOrder: plan.sortOrder, stripePriceId },
    });

    const price = plan.priceCents === 0 ? "free" : `$${(plan.priceCents / 100).toFixed(2)}`;
    console.log(
      `  seeded plan: ${plan.name} (${price}, ${plan.aiActionAllowance} AI actions` +
        `${stripePriceId ? ", Stripe price set" : ", no Stripe price"})`,
    );
  }

  console.log(`\nSeeded ${PLAN_KEYS.length} plans.`);
}

/**
 * Promotes the accounts named in `ADMIN_EMAILS` (comma-separated) to `admin`.
 *
 * There is no self-service path to the admin role and deliberately so — it gates
 * which provider and model the whole deployment calls, and what it costs. The
 * env var is the deploy-time decision; the seed is what applies it.
 *
 * Only ever promotes. Demotion is left to whoever runs the deployment, because a
 * seed that silently stripped a role when the variable was momentarily unset
 * could lock every admin out of the settings that would let them back in.
 */
async function promoteAdmins(): Promise<void> {
  const emails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);

  if (emails.length === 0) {
    console.log("\nADMIN_EMAILS is unset — no admins promoted.");
    return;
  }

  // Accounts are created by signing up, so an email listed here before its owner
  // has registered simply matches nothing. Reporting the count rather than
  // failing keeps `db:seed` runnable on a fresh database.
  const { count } = await prisma.user.updateMany({
    where: { email: { in: emails }, role: { not: "admin" } },
    data: { role: "admin" },
  });

  const existing = await prisma.user.count({ where: { email: { in: emails } } });
  console.log(
    `\nPromoted ${count} admin${count === 1 ? "" : "s"} ` +
      `(${existing}/${emails.length} of the listed emails have accounts).`,
  );
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
