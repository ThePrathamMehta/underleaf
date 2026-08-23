import { z } from "zod";
import { hexColorSchema } from "./theme";

/**
 * Dates are free-text strings ("Jun 2023", "2021 – Present", "Expected 2026")
 * rather than real dates. Resumes render them verbatim, and forcing an ISO date
 * would make legitimate values like "Present" unrepresentable.
 */
const dateStringSchema = z.string().max(60);

const idSchema = z.string().min(1);

/**
 * Text fields hold a small subset of inline HTML — bold, italic, underline,
 * per-run colour, links (see `sanitizeInlineHtml` in @repo/ui). A single
 * formatted word costs roughly 40 characters of markup, so these limits are
 * generous relative to the visible text they cap: they exist to bound the
 * payload, not to constrain what someone can write.
 *
 * `MARKUP_FACTOR` records that intent in one place, so the limits stay in
 * proportion to each other if the visible allowances ever change.
 */
const MARKUP_FACTOR = 6;

/** A rich text field allowing roughly `visible` characters of readable text. */
function richText(visible: number) {
  return z.string().max(visible * MARKUP_FACTOR);
}

export const linkSchema = z.object({
  id: idSchema,
  label: richText(80),
  url: z.string().max(300),
});

export type ResumeLink = z.infer<typeof linkSchema>;

export const personalInfoSchema = z.object({
  name: richText(120),
  title: richText(160),
  email: richText(160),
  phone: richText(60),
  location: richText(120),
  links: z.array(linkSchema).max(8),
});

export type PersonalInfo = z.infer<typeof personalInfoSchema>;

// --- Section items, one shape per section type ---

export const summaryItemSchema = z.object({
  id: idSchema,
  text: richText(2000),
});

export const experienceItemSchema = z.object({
  id: idSchema,
  org: richText(160),
  role: richText(160),
  location: richText(120),
  startDate: dateStringSchema,
  endDate: dateStringSchema,
  bullets: z.array(richText(600)).max(12),
});

export const educationItemSchema = z.object({
  id: idSchema,
  institution: richText(160),
  degree: richText(160),
  location: richText(120),
  startDate: dateStringSchema,
  endDate: dateStringSchema,
  bullets: z.array(richText(600)).max(12),
});

export const skillsItemSchema = z.object({
  id: idSchema,
  /** e.g. "Languages", "Frameworks" — rendered as a bold inline label. */
  category: richText(80),
  skills: z.array(z.string().max(80)).max(40),
});

export const projectItemSchema = z.object({
  id: idSchema,
  name: richText(160),
  /** Comma-separated tech list, rendered inline after the project name. */
  tech: richText(200),
  link: z.string().max(300),
  startDate: dateStringSchema,
  endDate: dateStringSchema,
  bullets: z.array(richText(600)).max(12),
});

export const certificationItemSchema = z.object({
  id: idSchema,
  name: richText(160),
  issuer: richText(160),
  date: dateStringSchema,
  link: z.string().max(300),
});

export const customItemSchema = z.object({
  id: idSchema,
  heading: richText(160),
  subheading: richText(160),
  dateRange: dateStringSchema,
  bullets: z.array(richText(600)).max(12),
});

/**
 * The discriminators that tell a placed block apart from a section's own entries.
 * Every entry shape above omits `kind` entirely, which is what makes the runtime
 * checks below reliable in both directions.
 */
export const TEXT_ITEM_KIND = "text";
export const IMAGE_ITEM_KIND = "image";
export const DIVIDER_ITEM_KIND = "divider";

/**
 * A free block of prose the user can drop anywhere in the document.
 *
 * It lives in a section's `items` rather than in a list of its own so that
 * everything already built per item works for it unchanged: the pagination pass
 * measures it as an entry, its edit path is the usual
 * `["sections", i, "items", k, "text"]`, and moving one is a move within an
 * array. Nothing downstream needed a new concept.
 */
export const textItemSchema = z.object({
  id: idSchema,
  kind: z.literal(TEXT_ITEM_KIND),
  text: richText(2000),
});

export type TextItem = z.infer<typeof textItemSchema>;

/**
 * An image placed in the flow of a template resume — a headshot, a logo, a QR code.
 *
 * The freeform equivalent is a `FreeformBlock` of type `image`, which carries
 * millimetre coordinates because it is placed on a sheet. This one sits in a
 * column whose width depends on the layout (a sidebar column is a third of the
 * page), so its width is a *percentage* of whatever column it lands in — which is
 * what lets the same item look right in Jake's single column and in Deedy's
 * sidebar, and keeps it correct if the theme's margins change underneath it.
 *
 * `src` is a URL, never bytes: images are uploaded to blob storage and referenced,
 * so the document JSON stays small enough to re-send on every autosave.
 */
export const imageItemSchema = z.object({
  id: idSchema,
  kind: z.literal(IMAGE_ITEM_KIND),
  src: z.string().max(600),
  /** Share of the column's width. Absent means the renderer's own default. */
  widthPercent: z.number().finite().min(5).max(100).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  /**
   * Describes the image to a screen reader in the editor. Deliberately not fed to
   * the ATS scorer: the exported PDF isn't tagged, so a parser never sees this
   * text, and scoring it would credit the user for words that don't ship.
   */
  alt: z.string().max(200).optional(),
});

export type ImageItem = z.infer<typeof imageItemSchema>;

/**
 * A horizontal rule between entries.
 *
 * It holds no content at all, which is the whole point — everything about how it
 * looks comes from the theme, so a rule inserted into Jake's and a rule inserted
 * into Creative each match the section rules already on the page.
 */
export const dividerItemSchema = z.object({
  id: idSchema,
  kind: z.literal(DIVIDER_ITEM_KIND),
});

export type DividerItem = z.infer<typeof dividerItemSchema>;

/**
 * Anything that can share a section's `items` without being one of its entries.
 *
 * They live in `items` rather than in lists of their own for the reason the free
 * text block did: pagination measures them as entries, their edit paths are the
 * usual `["sections", i, "items", k, …]`, and moving one is a move within an
 * array. Nothing downstream needed a new concept.
 */
export const placedItemSchema = z.union([textItemSchema, imageItemSchema, dividerItemSchema]);

export type PlacedItem = z.infer<typeof placedItemSchema>;

const PLACED_ITEM_KINDS: readonly string[] = [
  TEXT_ITEM_KIND,
  IMAGE_ITEM_KIND,
  DIVIDER_ITEM_KIND,
];

export type SummaryItem = z.infer<typeof summaryItemSchema>;
export type ExperienceItem = z.infer<typeof experienceItemSchema>;
export type EducationItem = z.infer<typeof educationItemSchema>;
export type SkillsItem = z.infer<typeof skillsItemSchema>;
export type ProjectItem = z.infer<typeof projectItemSchema>;
export type CertificationItem = z.infer<typeof certificationItemSchema>;
export type CustomItem = z.infer<typeof customItemSchema>;

/** The `kind` of an item, or undefined for one of a section's own entries. */
function itemKind(item: unknown): string | undefined {
  if (typeof item !== "object" || item === null) return undefined;
  const kind = (item as { kind?: unknown }).kind;
  return typeof kind === "string" ? kind : undefined;
}

/**
 * Whether an item is a free text block rather than one of the section's own
 * entries.
 *
 * Checks the discriminator rather than the absence of a field, because some item
 * shapes are structurally compatible with a text block — a SummaryItem also has
 * `id` and `text` — and only `kind` separates them.
 */
export function isTextItem(item: unknown): item is TextItem {
  return itemKind(item) === TEXT_ITEM_KIND;
}

export function isImageItem(item: unknown): item is ImageItem {
  return itemKind(item) === IMAGE_ITEM_KIND;
}

export function isDividerItem(item: unknown): item is DividerItem {
  return itemKind(item) === DIVIDER_ITEM_KIND;
}

/**
 * Whether an item was *placed* in a section rather than being one of its entries.
 *
 * This is the check every consumer wants: "is this a thing the user dropped here",
 * as opposed to a job, a degree or a project. Adding a fourth placed kind means
 * adding it to `PLACED_ITEM_KINDS` and nothing else.
 */
export function isPlacedItem(item: unknown): item is PlacedItem {
  const kind = itemKind(item);
  return kind !== undefined && PLACED_ITEM_KINDS.includes(kind);
}

/**
 * A section's own entries, with placed items filtered out.
 *
 * Anything that reasons about a section's *content* — scoring, ATS rules, the
 * "is this section empty" check — wants this rather than `section.items`, since
 * a stray note or a headshot is not an entry. The cast is the one place the
 * narrowing is asserted; `Exclude` is correct whether the caller's `T` is a single
 * item type or the whole union.
 */
export function sectionEntries<T>(items: readonly T[]): Exclude<T, PlacedItem>[] {
  return items.filter((item) => !isPlacedItem(item)) as Exclude<T, PlacedItem>[];
}

export const SECTION_TYPES = [
  "summary",
  "experience",
  "education",
  "skills",
  "projects",
  "certifications",
  "custom",
] as const;

export const sectionTypeSchema = z.enum(SECTION_TYPES);
export type SectionType = z.infer<typeof sectionTypeSchema>;

const sectionBase = {
  id: idSchema,
  title: richText(80),
  order: z.number().int().min(0),
  visible: z.boolean(),
  /**
   * Multi-page: when true, this section begins a new printed page. Optional and
   * defaulting to absent, so every existing single-page resume stays valid and
   * renders unchanged. Pages are derived from these breaks in `order` sequence
   * rather than stored explicitly, so reordering sections can't orphan a page.
   */
  pageBreakBefore: z.boolean().optional(),
};

/** How many placed items — notes, images, rules — one section may hold. */
const MAX_PLACED_ITEMS_PER_SECTION = 20;

/**
 * A section's items: its own entries, with placed items allowed among them.
 *
 * `placedItemSchema` comes first in the union deliberately. Zod objects strip
 * unknown keys, so `z.union([summaryItemSchema, textItemSchema])` would match a
 * text block against the summary shape — both have `id` and `text` — and quietly
 * drop the `kind` that identifies it. First match wins, so the more specific
 * shapes have to be tried first.
 *
 * The cap is split the same way: the array bound has to leave room for the placed
 * items, so the section's real limit on *entries* is re-imposed by the refinement.
 * A summary section stays one-summary-only while still accepting a note beside it.
 */
function itemsWithText<T extends z.ZodTypeAny>(entry: T, maxEntries: number) {
  return z
    .array(z.union([placedItemSchema, entry]))
    .max(maxEntries + MAX_PLACED_ITEMS_PER_SECTION)
    .refine((items) => items.filter((item) => !isPlacedItem(item)).length <= maxEntries, {
      message: `A section can hold at most ${maxEntries} entries.`,
    });
}

/**
 * Discriminated on `type` so `items` is narrowed correctly — a template
 * rendering an "experience" section gets ExperienceItem[] with no casting.
 */
export const sectionSchema = z.discriminatedUnion("type", [
  z.object({ ...sectionBase, type: z.literal("summary"), items: itemsWithText(summaryItemSchema, 1) }),
  z.object({ ...sectionBase, type: z.literal("experience"), items: itemsWithText(experienceItemSchema, 30) }),
  z.object({ ...sectionBase, type: z.literal("education"), items: itemsWithText(educationItemSchema, 30) }),
  z.object({ ...sectionBase, type: z.literal("skills"), items: itemsWithText(skillsItemSchema, 30) }),
  z.object({ ...sectionBase, type: z.literal("projects"), items: itemsWithText(projectItemSchema, 30) }),
  z.object({ ...sectionBase, type: z.literal("certifications"), items: itemsWithText(certificationItemSchema, 30) }),
  z.object({ ...sectionBase, type: z.literal("custom"), items: itemsWithText(customItemSchema, 30) }),
]);

export type Section = z.infer<typeof sectionSchema>;

/** Narrows a Section to one specific type, for template render helpers. */
export type SectionOfType<T extends SectionType> = Extract<Section, { type: T }>;

// --- Freeform blocks: the blank canvas ---

/**
 * What a freely-placed block holds.
 *
 * `text` and `heading` both carry rich text and differ only in their default
 * size and weight, but the distinction earns its keep beyond styling: a blank
 * document has no `personalInfo.name` field, so the export filename falls back to
 * the first `heading` on the page — see `getExportFilename`. That makes "which
 * block is the title" a property of the document rather than a guess.
 */
export const FREEFORM_BLOCK_TYPES = ["text", "heading", "image", "divider"] as const;

export const freeformBlockTypeSchema = z.enum(FREEFORM_BLOCK_TYPES);
export type FreeformBlockType = z.infer<typeof freeformBlockTypeSchema>;

/**
 * Positions and sizes are millimetres from the top-left corner of the page a
 * block sits on.
 *
 * mm because that is the unit the renderer already works in — `PAGE_DIMENSIONS`
 * and `theme.marginSize` are both mm — so one stored position puts a block in the
 * same spot on the editor canvas, in a gallery thumbnail, and in the printed PDF
 * with no DPI or zoom conversion in between.
 *
 * The bound is one generous page rather than a page-size-exact limit, and
 * negatives are allowed. A4 and Letter differ, a saved document's page size can
 * change under it, and a block dragged a hair past the left edge should be
 * clamped by the editor — not rejected by validation, which would fail the
 * autosave and lose the user's work over half a millimetre.
 */
const MM_LIMIT = 400;

const millimetres = z.number().finite().min(-MM_LIMIT).max(MM_LIMIT);

/** A block's own extent. Anything much smaller than this can't be clicked. */
const millimetreSpan = z.number().finite().min(4).max(MM_LIMIT);

/** How many sheets a freeform document may span. */
export const MAX_FREEFORM_PAGES = 10;

/**
 * Per-block overrides, all optional: an absent value means "whatever the theme
 * says", which is what keeps a blank document responsive to the font and colour
 * controls instead of freezing every block at its creation-time appearance.
 */
export const freeformStyleSchema = z.object({
  /** Points, the same unit as the renderer's base type sizes. */
  fontSize: z.number().finite().min(5).max(96).optional(),
  /** CSS numeric weight, hundreds only — bounded so it is safe to interpolate. */
  fontWeight: z.number().int().min(100).max(900).multipleOf(100).optional(),
  textAlign: z.enum(["left", "center", "right", "justify"]).optional(),
  color: hexColorSchema.optional(),
});

export type FreeformStyle = z.infer<typeof freeformStyleSchema>;

export const freeformBlockSchema = z.object({
  id: idSchema,
  type: freeformBlockTypeSchema,
  /**
   * Which sheet the block sits on, 0-based; absent means the first.
   *
   * Not in the spec's sketch, which describes a single page. It's here because a
   * canvas with no way to say "page 2" can only ever be one page long, and adding
   * the field afterwards would mean migrating documents users had already saved.
   */
  page: z.number().int().min(0).max(MAX_FREEFORM_PAGES - 1).optional(),
  position: z.object({ x: millimetres, y: millimetres }),
  /** Absent means "as tall and wide as the content needs". */
  size: z.object({ width: millimetreSpan, height: millimetreSpan }).optional(),
  /**
   * Rich text for `text` and `heading`, an image URL for `image`, unused for
   * `divider`.
   *
   * Capped as rich text — far more than a URL needs and far less than a base64
   * data URL would take, which is deliberate: image bytes belong in blob storage
   * behind `POST /uploads/image`, not inlined into a document that is re-sent on
   * every autosave.
   */
  content: richText(2000),
  style: freeformStyleSchema.optional(),
});

export type FreeformBlock = z.infer<typeof freeformBlockSchema>;

/**
 * How many freely-placed blocks one document may hold. Generous, because a
 * Word-style page of headings, notes and captions genuinely runs to dozens; the
 * cap is here to bound the payload, not to shape the document.
 */
export const MAX_FREEFORM_BLOCKS = 200;

export const resumeContentSchema = z.object({
  personalInfo: personalInfoSchema,
  sections: z.array(sectionSchema).max(20),
  /**
   * Present on blank-canvas resumes, absent on template ones.
   *
   * Optional rather than defaulting to `[]` for two reasons: every document
   * already stored stays byte-identical through a parse round-trip, and "is this
   * a freeform document" keeps an answer that doesn't hinge on telling an empty
   * array apart from a missing one. Exclusivity with `sections` isn't enforced —
   * the template decides which mode the editor shows, and a schema that refused
   * to hold both would make switching a blank resume onto a named template a
   * lossy operation.
   */
  freeformBlocks: z.array(freeformBlockSchema).max(MAX_FREEFORM_BLOCKS).optional(),
});

export type ResumeContent = z.infer<typeof resumeContentSchema>;

/**
 * Freeform blocks in reading order: by page, then top to bottom, then left to
 * right.
 *
 * Array order is insertion order, which is not what "the first heading on the
 * page" means once a block has been dragged above the one that was typed first.
 * Both the renderer and the export-filename fallback want the visual order, so
 * it's defined once here.
 */
export function orderedFreeformBlocks(blocks: readonly FreeformBlock[]): FreeformBlock[] {
  return [...blocks].sort(
    (a, b) =>
      (a.page ?? 0) - (b.page ?? 0) ||
      a.position.y - b.position.y ||
      a.position.x - b.position.x,
  );
}

/** How many sheets a freeform document needs — always at least one. */
export function freeformPageCount(blocks: readonly FreeformBlock[] | undefined): number {
  return Math.max(1, ...(blocks ?? []).map((block) => (block.page ?? 0) + 1));
}

/**
 * Groups a resume's *visible* sections into printed pages, in `order` sequence,
 * starting a new page before any section flagged `pageBreakBefore` (after the
 * first). Returns arrays of section ids. An empty resume yields a single empty
 * page so a canvas always has one sheet.
 *
 * Manual breaks only — it knows nothing about how tall the content is. The real
 * sheet count comes from measuring and packing (`@repo/ui/resume/paginate`);
 * this is the fallback for renderers with nothing measured, i.e. the thumbnails
 * and the gallery, where one flowing sheet is all that's wanted anyway.
 */
export function splitSectionsIntoPages(content: ResumeContent): string[][] {
  const ordered = content.sections
    .filter((section) => section.visible)
    .sort((a, b) => a.order - b.order);

  if (ordered.length === 0) return [[]];

  const pages: string[][] = [[]];
  ordered.forEach((section, i) => {
    if (i > 0 && section.pageBreakBefore) pages.push([]);
    pages[pages.length - 1]!.push(section.id);
  });
  return pages;
}
