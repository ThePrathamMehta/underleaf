import type { Theme } from "@repo/types";
import { themeSchema, resumeContentSchema } from "@repo/types";
import { prisma } from "./index.js";
import { SAMPLE_CONTENT } from "./sample-content.js";

type TemplateSeed = {
  name: string;
  slug: string;
  description: string;
  category: string;
  defaultTheme: Theme;
};

/**
 * Slugs are the contract between the database and the renderer: each one maps to
 * a template component in `@repo/ui/resume/templates`. Changing a slug here
 * without adding the matching component will fall back to the default layout.
 */
const TEMPLATES: TemplateSeed[] = [
  {
    name: "Jake's Resume",
    slug: "jakes",
    description:
      "The single-column, ATS-friendly standard for software engineers. Ruled section headings, right-aligned dates, and tight bullet spacing that fits a dense career on one page.",
    category: "Software Engineer",
    defaultTheme: {
      fontFamily: "inter",
      headingFontFamily: "inter",
      fontSizeScale: 1,
      accentColor: "#000000",
      textColor: "#000000",
      lineSpacing: 1.2,
      marginSize: 13,
      layout: "single-column",
      pageSize: "letter",
    },
  },
  {
    name: "Deedy Sidebar",
    slug: "deedy",
    description:
      "Two-column layout with contact, skills and education in a narrow sidebar, leaving the wide column for experience and projects. A bold accent bar anchors the header.",
    category: "Software Engineer",
    defaultTheme: {
      fontFamily: "lato",
      headingFontFamily: "lato",
      fontSizeScale: 0.95,
      accentColor: "#0e6ba8",
      textColor: "#1a1a1a",
      lineSpacing: 1.25,
      marginSize: 12,
      layout: "sidebar-left",
      pageSize: "letter",
    },
  },
  {
    name: "Modern Minimal",
    slug: "modern-minimal",
    description:
      "Generous white space, an oversized name header, and thin accent-colored dividers. Sans-serif throughout for a calm, contemporary read.",
    category: "Minimal",
    defaultTheme: {
      fontFamily: "inter",
      headingFontFamily: "inter",
      fontSizeScale: 1,
      accentColor: "#0f766e",
      textColor: "#27272a",
      lineSpacing: 1.45,
      marginSize: 20,
      layout: "single-column",
      pageSize: "a4",
    },
  },
  {
    name: "Classic Professional",
    slug: "classic",
    description:
      "Traditional serif typography with a centered header and conservative spacing. The safe, expected choice for academic, legal and corporate applications.",
    category: "Academic",
    defaultTheme: {
      fontFamily: "eb-garamond",
      headingFontFamily: "eb-garamond",
      fontSizeScale: 1.05,
      accentColor: "#1a1a1a",
      textColor: "#1a1a1a",
      lineSpacing: 1.3,
      marginSize: 18,
      layout: "single-column",
      pageSize: "letter",
    },
  },
  {
    name: "Creative Header",
    slug: "creative",
    description:
      "A saturated header band carries your name and title in reversed type, with a clean single column beneath. Built for design, marketing and brand roles.",
    category: "Creative",
    defaultTheme: {
      fontFamily: "lato",
      headingFontFamily: "merriweather",
      fontSizeScale: 1,
      accentColor: "#b4451f",
      textColor: "#292524",
      lineSpacing: 1.35,
      marginSize: 15,
      layout: "single-column",
      pageSize: "letter",
    },
  },
];

async function main() {
  // Fail loudly at seed time rather than shipping a template the renderer or
  // the API's Zod validation would later reject.
  const sampleContent = resumeContentSchema.parse(SAMPLE_CONTENT);

  for (const template of TEMPLATES) {
    const defaultTheme = themeSchema.parse(template.defaultTheme);

    await prisma.template.upsert({
      where: { slug: template.slug },
      create: {
        name: template.name,
        slug: template.slug,
        description: template.description,
        category: template.category,
        previewImageUrl: `/templates/${template.slug}.png`,
        defaultTheme,
        sampleContent,
      },
      update: {
        name: template.name,
        description: template.description,
        category: template.category,
        previewImageUrl: `/templates/${template.slug}.png`,
        defaultTheme,
        sampleContent,
      },
    });

    console.log(`  seeded template: ${template.name} (${template.slug})`);
  }

  console.log(`\nSeeded ${TEMPLATES.length} templates.`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
