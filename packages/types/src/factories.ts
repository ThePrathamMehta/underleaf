import type {
  DividerItem,
  FreeformBlock,
  FreeformBlockType,
  FreeformStyle,
  ImageItem,
  ResumeContent,
  Section,
  SectionType,
  TextItem,
} from "./content";
import { DIVIDER_ITEM_KIND, IMAGE_ITEM_KIND, TEXT_ITEM_KIND } from "./content";

/**
 * Ids only need to be unique within one resume document, and both the seed
 * script and the browser editor mint them, so a counter-free random suffix is
 * simpler than threading a generator through the editor reducer.
 */
export function makeId(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

const SECTION_DEFAULT_TITLES: Record<SectionType, string> = {
  summary: "Summary",
  experience: "Experience",
  education: "Education",
  skills: "Skills",
  projects: "Projects",
  certifications: "Certifications",
  custom: "Custom Section",
};

export function defaultSectionTitle(type: SectionType): string {
  return SECTION_DEFAULT_TITLES[type];
}

/** An empty section of the given type, with one blank item to edit into. */
export function createEmptySection(type: SectionType, order: number): Section {
  const base = { id: makeId("sec"), order, visible: true };

  switch (type) {
    case "summary":
      return { ...base, type, title: SECTION_DEFAULT_TITLES.summary, items: [{ id: makeId("item"), text: "" }] };
    case "experience":
      return {
        ...base,
        type,
        title: SECTION_DEFAULT_TITLES.experience,
        items: [
          {
            id: makeId("item"),
            org: "Company",
            role: "Role",
            location: "",
            startDate: "",
            endDate: "",
            bullets: [""],
          },
        ],
      };
    case "education":
      return {
        ...base,
        type,
        title: SECTION_DEFAULT_TITLES.education,
        items: [
          {
            id: makeId("item"),
            institution: "Institution",
            degree: "Degree",
            location: "",
            startDate: "",
            endDate: "",
            bullets: [],
          },
        ],
      };
    case "skills":
      return {
        ...base,
        type,
        title: SECTION_DEFAULT_TITLES.skills,
        items: [{ id: makeId("item"), category: "Languages", skills: [] }],
      };
    case "projects":
      return {
        ...base,
        type,
        title: SECTION_DEFAULT_TITLES.projects,
        items: [
          {
            id: makeId("item"),
            name: "Project",
            tech: "",
            link: "",
            startDate: "",
            endDate: "",
            bullets: [""],
          },
        ],
      };
    case "certifications":
      return {
        ...base,
        type,
        title: SECTION_DEFAULT_TITLES.certifications,
        items: [{ id: makeId("item"), name: "Certification", issuer: "", date: "", link: "" }],
      };
    case "custom":
      return {
        ...base,
        type,
        title: SECTION_DEFAULT_TITLES.custom,
        items: [{ id: makeId("item"), heading: "", subheading: "", dateRange: "", bullets: [""] }],
      };
  }
}

/**
 * A blank free text block, minted with the same `item` prefix as any other entry
 * — it occupies a slot in a section's `items`, so its id shares that namespace.
 */
export function createTextItem(text = ""): TextItem {
  return { id: makeId("item"), kind: TEXT_ITEM_KIND, text };
}

/**
 * An image in the flow of a section.
 *
 * `src` may be empty: an image item exists for the moment between the user picking
 * a file and the upload finishing, and the renderer draws a placeholder frame for
 * it — which is far better than an item that only appears once the bytes land.
 *
 * The default width is a little under half the column, which is about right for a
 * headshot or a logo and small enough that inserting one never reflows a page in a
 * way the user didn't expect.
 */
export function createImageItem(src = "", widthPercent = 40): ImageItem {
  return { id: makeId("item"), kind: IMAGE_ITEM_KIND, src, widthPercent };
}

/** A horizontal rule between entries. It has no properties beyond being one. */
export function createDividerItem(): DividerItem {
  return { id: makeId("item"), kind: DIVIDER_ITEM_KIND };
}

/** A blank-but-valid resume, used when creating from a template with no sample. */
export function createEmptyContent(): ResumeContent {
  return {
    personalInfo: {
      name: "Your Name",
      title: "Your Title",
      email: "",
      phone: "",
      location: "",
      links: [],
    },
    sections: (["summary", "experience", "education", "skills", "projects"] as const).map(
      (type, index) => createEmptySection(type, index),
    ),
  };
}

/**
 * A truly blank document for "Start from Blank": empty personal info and a few
 * scaffolded sections with *no* items, so the canvas has structure to build on
 * without any placeholder content to clear out first.
 *
 * This is "blank" in the sense a *named template* can be blank — the section
 * shape is still the template's. For the Blank template itself, which imposes no
 * shape at all, see `createBlankCanvasContent`.
 */
export function createBlankContent(): ResumeContent {
  return {
    personalInfo: { name: "", title: "", email: "", phone: "", location: "", links: [] },
    sections: [
      { id: makeId("sec"), type: "experience", title: SECTION_DEFAULT_TITLES.experience, order: 0, visible: true, items: [] },
      { id: makeId("sec"), type: "education", title: SECTION_DEFAULT_TITLES.education, order: 1, visible: true, items: [] },
      { id: makeId("sec"), type: "skills", title: SECTION_DEFAULT_TITLES.skills, order: 2, visible: true, items: [] },
    ],
  };
}

// --- The blank canvas ---

/** Default point size per block type, before the theme's scale is applied. */
const FREEFORM_FONT_SIZE: Record<FreeformBlockType, number | undefined> = {
  heading: 22,
  text: 10,
  image: undefined,
  divider: undefined,
};

export function createFreeformBlock(input: {
  type?: FreeformBlockType;
  position: { x: number; y: number };
  page?: number;
  content?: string;
  size?: { width: number; height: number };
  style?: FreeformStyle;
}): FreeformBlock {
  const type = input.type ?? "text";
  const fontSize = FREEFORM_FONT_SIZE[type];

  return {
    id: makeId("blk"),
    type,
    ...(input.page ? { page: input.page } : {}),
    position: input.position,
    ...(input.size ? { size: input.size } : {}),
    content: input.content ?? "",
    style: { ...(fontSize ? { fontSize } : {}), ...input.style },
  };
}

/**
 * Where the pre-placed name heading lands, in millimetres.
 *
 * A 20mm inset either side of a Letter page (215.9mm wide), which is the page size
 * the Blank template seeds. On A4 (210mm) the right-hand inset comes out a few
 * millimetres tighter; the text is centred *inside* the box either way, so the
 * heading still reads as centred on both.
 */
const NAME_HEADING = { x: 20, y: 16, width: 176, height: 14 };

/**
 * The Blank template's starting document: no sections, and one empty heading
 * block across the top of the first page.
 *
 * Not an empty page. A genuinely empty canvas gives the cursor nowhere to go and
 * makes the user's first act "find the click target"; Word and Canva both open on
 * a title, and the editor renders this block with a "Your Name" placeholder and
 * focuses it on load, so the first keystroke lands somewhere sensible.
 */
export function createBlankCanvasContent(): ResumeContent {
  return {
    personalInfo: { name: "", title: "", email: "", phone: "", location: "", links: [] },
    sections: [],
    freeformBlocks: [
      createFreeformBlock({
        type: "heading",
        position: { x: NAME_HEADING.x, y: NAME_HEADING.y },
        size: { width: NAME_HEADING.width, height: NAME_HEADING.height },
        style: { textAlign: "center" },
      }),
    ],
  };
}

// --- Starter sections, for the canvas's Insert Section picker ---

/**
 * The sections the picker offers, in the order a resume tends to want them.
 *
 * A superset of `SECTION_TYPES` on purpose: languages, volunteer work and awards
 * are ordinary things to put on a resume, and on a canvas they cost nothing to
 * offer — a starter is only ever a text block with a heading in it, so no template
 * has to learn how to lay one out.
 */
export const SECTION_STARTERS = [
  "experience",
  "education",
  "skills",
  "projects",
  "summary",
  "certifications",
  "languages",
  "volunteer",
  "awards",
  "custom",
] as const;

export type SectionStarter = (typeof SECTION_STARTERS)[number];

/**
 * What each starter writes onto the page: a heading, and one worked example under
 * it.
 *
 * Filled in rather than blank, and phrased as a prompt wherever the shape of a
 * line isn't self-evident. A canvas gives no hint about what belongs where — a
 * flow template at least has named fields behind its placeholders — so the text
 * has to carry that itself. Every line here is meant to be typed over.
 *
 * `label` appears only where the picker should read differently from what lands on
 * the page: "Custom" names the choice, "Section Title" prompts for the heading.
 */
const STARTER_SECTIONS: Record<
  SectionStarter,
  { title: string; label?: string; lines: string[] }
> = {
  experience: {
    title: "Experience",
    lines: [
      "<b>Company Name</b> — Job Title",
      "Jan 2024 – Present · City, Country",
      "• What you did, and what it led to.",
      "• A second bullet — put a number in it if you have one.",
    ],
  },
  education: {
    title: "Education",
    lines: [
      "<b>University Name</b> — Degree",
      "2020 – 2024 · City, Country",
      "• Coursework, honors or a thesis worth naming.",
    ],
  },
  skills: {
    title: "Skills",
    lines: [
      "<b>Languages:</b> the ones you would be happy to be tested on",
      "<b>Tools:</b> frameworks, platforms, whatever you use daily",
    ],
  },
  projects: {
    title: "Projects",
    lines: [
      "<b>Project Name</b> — what it does, in one line",
      "React · Node · Postgres",
      "• The problem it solved, and how far it got.",
    ],
  },
  summary: {
    title: "Summary",
    lines: [
      "Two or three lines on what you do, what you are best at, and what you are looking for next.",
    ],
  },
  certifications: {
    title: "Certifications",
    lines: ["<b>Certification Name</b> — Issuing Body · 2025"],
  },
  languages: {
    title: "Languages",
    lines: ["English — Native", "Spanish — Conversational"],
  },
  volunteer: {
    title: "Volunteer Work",
    lines: [
      "<b>Organization</b> — Role",
      "2023 – Present",
      "• What you helped with, and who it reached.",
    ],
  },
  awards: {
    title: "Awards",
    lines: ["<b>Award Name</b> — Awarding Body · 2025", "• Why it was given, in one line."],
  },
  custom: {
    title: "Section Title",
    label: "Custom",
    lines: ["Anything this resume needs that the other sections don't cover."],
  },
};

/** How a starter reads in the picker. */
export function sectionStarterLabel(kind: SectionStarter): string {
  const starter = STARTER_SECTIONS[kind];
  return starter.label ?? starter.title;
}

/**
 * A starter section's measure: 170mm, which is a Letter page inside the same 20mm
 * insets the pre-placed name heading uses, and a hair narrower than that on A4.
 * One line length that reads well on both.
 */
const STARTER_WIDTH_MM = 170;

/** About what one line of the starter's 10pt body type comes to. */
const STARTER_LINE_MM = 4.8;

/** The heading's point size — a step up from the body, as the flow templates set it. */
const STARTER_HEADING_PT = 12;

/**
 * The box a starter opens at, so a caller can ask whether one fits before placing
 * it.
 *
 * An estimate, and only ever an opening one: the renderer treats a text block's
 * height as a floor, so the box grows to whatever the real type needs, and the
 * editor re-measures the rendered result before stacking anything underneath. It
 * only has to be close enough that the block doesn't arrive visibly wrong.
 */
export function sectionStarterSize(kind: SectionStarter): { width: number; height: number } {
  // The heading, its lines, and a line of air at the foot.
  const lines = STARTER_SECTIONS[kind].lines.length + 2;
  return { width: STARTER_WIDTH_MM, height: Math.round(lines * STARTER_LINE_MM * 10) / 10 };
}

/**
 * A starter section as one freely-placed block.
 *
 * One block rather than a heading block plus a body block, so the section moves,
 * resizes and deletes as the single thing the user takes it for — and so the
 * picker's result is an ordinary `text` block, with nothing new for the renderer,
 * the schema or the exporter to know about.
 *
 * The heading's size and weight come from an inline run rather than from the
 * block's type, which is the same markup the selection toolbar writes when someone
 * bolds a word. That keeps it text they can retype, restyle or delete instead of
 * structure they can't get out of.
 */
export function createSectionStarterBlock(
  kind: SectionStarter,
  input: { position: { x: number; y: number }; page?: number },
): FreeformBlock {
  const starter = STARTER_SECTIONS[kind];
  const heading =
    `<span style="font-size: ${STARTER_HEADING_PT}pt; font-weight: 700; letter-spacing: 0.06em">` +
    `${starter.title.toUpperCase()}</span>`;

  return createFreeformBlock({
    type: "text",
    position: input.position,
    page: input.page,
    size: sectionStarterSize(kind),
    // Joined with <br> rather than newlines: the field round-trips through the
    // inline-HTML sanitizer, which keeps a <br> and would leave a bare newline at
    // the mercy of whatever markup the browser replaces it with on the first edit.
    content: [heading, ...starter.lines].join("<br>"),
  });
}
