import { BLANK_TEMPLATE_SLUG, DEFAULT_THEME, type Theme } from "@repo/types";

/**
 * The template and profession catalogue: what gets seeded, and what a fit check
 * has to hold itself to.
 *
 * Lifted out of `seed.ts` so it can be imported without importing a Prisma
 * client. `scripts/check-one-page.ts` renders every one of these themes against
 * every sample and measures the result; if that script read a second copy of the
 * list, a template could pass the check and ship with different margins.
 */

export type TemplateSeed = {
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
export const TEMPLATES: TemplateSeed[] = [
  {
    name: "Jake's Resume",
    slug: "jakes",
    description:
      "The single-column, ATS-friendly standard for software engineers. Ruled section headings, right-aligned dates, and tight bullet spacing that fits a dense career on one page.",
    category: "Software Engineer",
    defaultTheme: {
      fontFamily: "inter",
      headingFontFamily: "inter",
      fontSizeScale: 1.01,
      accentColor: "#000000",
      textColor: "#000000",
      lineSpacing: 1.24,
      marginSize: 14,
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
      fontSizeScale: 1.02,
      accentColor: "#0e6ba8",
      textColor: "#1a1a1a",
      lineSpacing: 1.39,
      marginSize: 15.5,
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
      fontSizeScale: 1.01,
      accentColor: "#0f766e",
      textColor: "#27272a",
      lineSpacing: 1.31,
      marginSize: 17,
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
      fontSizeScale: 1.02,
      accentColor: "#1a1a1a",
      textColor: "#1a1a1a",
      lineSpacing: 1.24,
      marginSize: 16,
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
      lineSpacing: 1.26,
      marginSize: 14.5,
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
 *
 * Note that every variant sets all three of `fontSizeScale`, `lineSpacing` and
 * `marginSize` explicitly, even where the value equals its base's. These are the
 * knobs `check:tune-themes` moves to fill the page, and each variant is measured
 * separately because different fonts have different metrics — Merriweather at 1.26
 * leading is not Garamond at 1.26. Inheriting any of them would mean retuning one
 * base silently changed the fill of three variants that were never measured at
 * those values.
 */
export type VariantSeed = Omit<TemplateSeed, "defaultTheme"> & {
  /** Slug of the layout this restyles. Must exist in TEMPLATES. */
  base: string;
  themeOverrides: Partial<Theme>;
};

export const VARIANTS: VariantSeed[] = [
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
      fontSizeScale: 1.01,
      lineSpacing: 1.24,
      marginSize: 14.5,
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
      fontSizeScale: 1.01,
      lineSpacing: 1.24,
      marginSize: 13.5,
    },
  },
  {
    name: "Jake's Compact",
    slug: "jakes--compact",
    base: "jakes",
    description:
      "Tuned down to fit a longer history on a single page — smaller type, tighter leading, narrower margins. Useful when you have more to say than room to say it.",
    category: "Software Engineer",
    // Deliberately *not* the values `check:tune-themes` proposes. The tuner asked
    // for 1.34 leading and 14.5mm margins here — which would fill the sample
    // nicely and make this the airiest Jake's in the gallery, looser than the base
    // it is meant to be the tight version of. This template exists for the user
    // with a thirteen-bullet history and one page to put it on, so it stays
    // tighter than `jakes` on all three knobs and accepts a lower fill against the
    // short shared sample. Filled with the content it is *for*, it reaches the
    // page like everything else.
    themeOverrides: {
      fontSizeScale: 1,
      lineSpacing: 1.22,
      marginSize: 13.5,
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
      fontSizeScale: 1.03,
      lineSpacing: 1.41,
      marginSize: 16,
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
      fontSizeScale: 1,
      lineSpacing: 1.42,
      marginSize: 15,
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
      fontSizeScale: 1,
      lineSpacing: 1.28,
      marginSize: 14.5,
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
      fontSizeScale: 1.01,
      lineSpacing: 1.29,
      marginSize: 15.5,
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
      fontSizeScale: 0.98,
      lineSpacing: 1.24,
      marginSize: 15.5,
    },
  },
  {
    name: "Classic Journal",
    slug: "classic--journal",
    base: "classic",
    description:
      "A4 with looser leading than the rest of the classic set, set in Merriweather for long-form legibility. Holds a one-page resume comfortably and stays readable when a CV runs on.",
    category: "Academic",
    themeOverrides: {
      fontFamily: "merriweather",
      headingFontFamily: "merriweather",
      fontSizeScale: 1.01,
      lineSpacing: 1.26,
      marginSize: 16.5,
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
      fontSizeScale: 1.02,
      lineSpacing: 1.24,
      marginSize: 16,
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
      fontSizeScale: 1,
      lineSpacing: 1.26,
      marginSize: 14.5,
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
      fontSizeScale: 1,
      lineSpacing: 1.21,
      marginSize: 14.5,
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

/**
 * The blank canvas: the one template that imposes no structure at all.
 *
 * A seeded row like any other, because a `Resume` needs a template id and because
 * the renderer already dispatches on the slug — from its point of view "no layout"
 * is simply one more layout. What sets it apart is what it is *left out* of: the
 * gallery grid shows it as the dashed "Start from blank" card rather than a
 * thumbnail of an empty page, and `scripts/check-one-page.ts` skips it, since "how
 * full is the first sheet" has no answer for a document whose sample content is a
 * single empty heading.
 *
 * Its theme is `DEFAULT_THEME` verbatim, which is the whole intent: sane body
 * defaults and not one styling decision made on the user's behalf.
 */
export const BLANK_TEMPLATE: TemplateSeed = {
  name: "Blank",
  slug: BLANK_TEMPLATE_SLUG,
  description:
    "An empty page with no imposed structure — click anywhere to start typing, and place headings, text, images and dividers wherever you want them.",
  category: "Blank",
  defaultTheme: DEFAULT_THEME,
};

export const ALL_TEMPLATES: TemplateSeed[] = [...TEMPLATES, ...expandVariants(), BLANK_TEMPLATE];

/**
 * Who a template is for. Orthogonal to `category`, which describes how it looks
 * — a Lawyer and an Academic are well served by the same conservative serif.
 *
 * `templates` is the curated pick for that profession, in rank order: first
 * entry is the strongest recommendation and leads the filtered grid.
 */
export type ProfessionSeed = {
  name: string;
  slug: string;
  description: string;
  iconKey: string;
  templates: string[];
};

export const PROFESSIONS: ProfessionSeed[] = [
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
      "Long-form CV layouts that stay legible when the publication list grows.",
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
