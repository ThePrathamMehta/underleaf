import type { Theme } from "@repo/types";
import { themeSchema, resumeContentSchema } from "@repo/types";
import { Prisma, prisma } from "./index.js";
import { SAMPLE_CONTENT } from "./sample-content.js";
import { SAMPLE_CONTENT_BY_PROFESSION } from "./samples/index.js";

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

/**
 * Theme variants of the five structural layouts above.
 *
 * Profession curation asks for 5–7 templates each, which is more gallery items
 * than there are distinct layouts. Each variant is a real, pickable template
 * with its own slug, name, description and theme — it reuses a base component
 * because what differs is the styling, not the structure. `baseTemplateSlug` in
 * @repo/ui resolves `jakes--slate` back to the Jake's layout when rendering.
 *
 * Every axis used below (accent, both font slots, scale, line spacing, margin,
 * page size, text colour) is read by `themeToCss`, so each variant is visibly
 * its own document. `theme.layout` is deliberately *not* an axis here: the
 * renderer never reads that field, so varying it would ship a literal duplicate
 * wearing a different name — the one thing the gallery must not contain.
 */
type VariantSeed = Omit<TemplateSeed, "defaultTheme"> & {
  /** Slug of the layout this restyles. Must exist in TEMPLATES. */
  base: string;
  themeOverrides: Partial<Theme>;
};

const VARIANTS: VariantSeed[] = [
  // --- Jake's: dense, ATS-safe single column ---
  {
    name: "Jake's Slate",
    slug: "jakes--slate",
    base: "jakes",
    description:
      "The dense single-column standard in a cooler register — slate headings over a neutral grotesque. Reads as corporate rather than technical, without giving up the tight one-page fit.",
    category: "Corporate",
    themeOverrides: {
      fontFamily: "roboto",
      headingFontFamily: "roboto",
      accentColor: "#334155",
      textColor: "#0f172a",
      marginSize: 14,
    },
  },
  {
    name: "Jake's Serif",
    slug: "jakes--serif",
    base: "jakes",
    description:
      "Same efficient structure set in a text serif, with a little more air between lines. The conservative choice when the reader expects gravity over modernity.",
    category: "Corporate",
    themeOverrides: {
      fontFamily: "source-serif",
      headingFontFamily: "source-serif",
      lineSpacing: 1.32,
      marginSize: 15,
    },
  },
  {
    name: "Jake's Compact",
    slug: "jakes--compact",
    base: "jakes",
    description:
      "Tuned down to fit a longer history on a single page — smaller type, tighter leading, narrower margins. Useful when you have more to say than room to say it.",
    category: "Software Engineer",
    themeOverrides: {
      fontSizeScale: 0.88,
      lineSpacing: 1.14,
      marginSize: 10,
    },
  },

  // --- Deedy: narrow left rail ---
  {
    name: "Deedy Graphite",
    slug: "deedy--graphite",
    base: "deedy",
    description:
      "The sidebar layout stripped to greys, so the structure does the work instead of colour. Prints cleanly in black and white, which not every two-column resume does.",
    category: "Minimal",
    themeOverrides: {
      fontFamily: "inter",
      headingFontFamily: "inter",
      accentColor: "#3f3f46",
      textColor: "#18181b",
    },
  },
  {
    name: "Deedy Plum",
    slug: "deedy--plum",
    base: "deedy",
    description:
      "A deeper accent and a serif heading face warm up the sidebar rail. Keeps the scannable two-column split while reading less like an engineering CV.",
    category: "Creative",
    themeOverrides: {
      headingFontFamily: "merriweather",
      accentColor: "#6d28d9",
      textColor: "#27272a",
      lineSpacing: 1.3,
    },
  },

  // --- Modern Minimal: generous single column ---
  {
    name: "Modern Ink",
    slug: "modern-minimal--ink",
    base: "modern-minimal",
    description:
      "The open, airy layout in pure black on US Letter. No accent colour at all — the whitespace and the oversized name header carry it.",
    category: "Minimal",
    themeOverrides: {
      fontFamily: "roboto",
      headingFontFamily: "roboto",
      accentColor: "#18181b",
      marginSize: 18,
      pageSize: "letter",
    },
  },
  {
    name: "Modern Sienna",
    slug: "modern-minimal--sienna",
    base: "modern-minimal",
    description:
      "Warm earth accent with a serif heading against a sans body. The most editorial of the minimal set, and the one that survives a colour print best.",
    category: "Minimal",
    themeOverrides: {
      headingFontFamily: "source-serif",
      accentColor: "#b45309",
      textColor: "#292524",
      lineSpacing: 1.4,
    },
  },

  // --- Classic: centred serif header ---
  {
    name: "Classic Navy",
    slug: "classic--navy",
    base: "classic",
    description:
      "Traditional structure with a navy rule and a sturdier text serif. The register firms and practices tend to expect, without looking dated.",
    category: "Corporate",
    themeOverrides: {
      fontFamily: "source-serif",
      headingFontFamily: "source-serif",
      accentColor: "#1e3a5f",
      textColor: "#111827",
    },
  },
  {
    name: "Classic Journal",
    slug: "classic--journal",
    base: "classic",
    description:
      "A4 with looser leading and wider margins, sized for a CV that runs to several pages rather than a one-page resume. Set in Merriweather for long-form legibility.",
    category: "Academic",
    themeOverrides: {
      fontFamily: "merriweather",
      headingFontFamily: "merriweather",
      fontSizeScale: 1,
      lineSpacing: 1.42,
      marginSize: 20,
      pageSize: "a4",
    },
  },
  {
    name: "Classic Oxford",
    slug: "classic--oxford",
    base: "classic",
    description:
      "Garamond at a formal size with an oxblood accent and generous margins. The most ceremonial template here — suited to medicine, law and senior academic posts.",
    category: "Academic",
    themeOverrides: {
      accentColor: "#7f1d1d",
      fontSizeScale: 1.08,
      marginSize: 21,
    },
  },

  // --- Creative: saturated header band ---
  {
    name: "Creative Indigo",
    slug: "creative--indigo",
    base: "creative",
    description:
      "The reversed header band in a cool indigo with a sans heading face. Confident without the warmth of the default, and easier to pair with a brand palette.",
    category: "Creative",
    themeOverrides: {
      headingFontFamily: "inter",
      accentColor: "#4338ca",
      textColor: "#1e1b4b",
    },
  },
  {
    name: "Creative Forest",
    slug: "creative--forest",
    base: "creative",
    description:
      "A deep green band under a sans body, with the serif kept for headings. The quietest of the creative set — colour with restraint.",
    category: "Creative",
    themeOverrides: {
      fontFamily: "inter",
      accentColor: "#14532d",
      textColor: "#1c1917",
      lineSpacing: 1.3,
    },
  },
];

/** Expands each variant against the theme of the layout it restyles. */
function expandVariants(): TemplateSeed[] {
  return VARIANTS.map(({ base, themeOverrides, ...rest }) => {
    const parent = TEMPLATES.find((template) => template.slug === base);
    // A variant of a layout that doesn't exist would silently render as the
    // fallback template, so refuse to seed it at all.
    if (!parent) throw new Error(`Variant "${rest.slug}" names unknown base template "${base}"`);

    return { ...rest, defaultTheme: { ...parent.defaultTheme, ...themeOverrides } };
  });
}

const ALL_TEMPLATES: TemplateSeed[] = [...TEMPLATES, ...expandVariants()];

/**
 * Who a template is for. Orthogonal to `category`, which describes how it looks
 * — a Lawyer and an Academic are well served by the same conservative serif.
 *
 * `templates` is the curated pick for that profession, in rank order: first
 * entry is the strongest recommendation and leads the filtered grid.
 */
type ProfessionSeed = {
  name: string;
  slug: string;
  description: string;
  iconKey: string;
  templates: string[];
};

const PROFESSIONS: ProfessionSeed[] = [
  {
    name: "Software Engineer",
    slug: "software-engineer",
    description:
      "Dense, ATS-friendly layouts that give projects and stack the room they need.",
    iconKey: "terminal",
    templates: ["jakes", "deedy", "jakes--compact", "modern-minimal", "deedy--graphite", "jakes--slate"],
  },
  {
    name: "CA / Accountant",
    slug: "accountant",
    description:
      "Conservative, figure-friendly formats for audit, tax and finance roles.",
    iconKey: "ledger",
    templates: ["classic--navy", "jakes--serif", "classic", "jakes--slate", "modern-minimal--ink", "classic--oxford"],
  },
  {
    name: "Lawyer",
    slug: "lawyer",
    description:
      "Formal serif documents in the register firms and chambers expect.",
    iconKey: "scales",
    templates: ["classic--oxford", "classic", "classic--navy", "jakes--serif", "classic--journal", "modern-minimal--ink"],
  },
  {
    name: "Doctor / Healthcare",
    slug: "healthcare",
    description:
      "CV-length layouts with space for training, licensure and publications.",
    iconKey: "pulse",
    templates: ["classic--journal", "classic--oxford", "classic", "classic--navy", "modern-minimal--sienna", "jakes--serif"],
  },
  {
    name: "Academic / Researcher",
    slug: "academic",
    description:
      "Multi-page CVs that stay legible when the publication list runs long.",
    iconKey: "book",
    templates: ["classic--journal", "classic", "classic--oxford", "jakes--serif", "modern-minimal--sienna", "classic--navy"],
  },
  {
    name: "Designer / Creative",
    slug: "designer",
    description:
      "Colour and typographic character, still readable by an applicant tracker.",
    iconKey: "palette",
    templates: ["creative", "creative--indigo", "deedy--plum", "creative--forest", "modern-minimal--sienna", "deedy"],
  },
  {
    name: "Marketing / Sales",
    slug: "marketing",
    description:
      "Results-forward layouts with room for numbers near the top of the page.",
    iconKey: "megaphone",
    templates: ["creative--indigo", "modern-minimal--sienna", "creative", "jakes--slate", "creative--forest", "modern-minimal"],
  },
  {
    name: "Student / Entry-Level",
    slug: "student",
    description:
      "Education-first structures that read as full without padding them out.",
    iconKey: "cap",
    templates: ["jakes", "modern-minimal", "deedy--graphite", "classic", "modern-minimal--ink", "jakes--compact"],
  },
  {
    name: "General / Other",
    slug: "general",
    description: "Safe, versatile formats that suit almost any field.",
    iconKey: "compass",
    templates: ["jakes", "modern-minimal", "classic", "jakes--slate", "modern-minimal--ink", "classic--navy", "deedy"],
  },
];

async function main() {
  // Fail loudly at seed time rather than shipping a template the renderer or
  // the API's Zod validation would later reject.
  const sampleContent = resumeContentSchema.parse(SAMPLE_CONTENT);

  const templateIdBySlug = new Map<string, string>();

  for (const template of ALL_TEMPLATES) {
    const defaultTheme = themeSchema.parse(template.defaultTheme);

    const row = await prisma.template.upsert({
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
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
