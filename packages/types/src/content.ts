import { z } from "zod";

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

export type SummaryItem = z.infer<typeof summaryItemSchema>;
export type ExperienceItem = z.infer<typeof experienceItemSchema>;
export type EducationItem = z.infer<typeof educationItemSchema>;
export type SkillsItem = z.infer<typeof skillsItemSchema>;
export type ProjectItem = z.infer<typeof projectItemSchema>;
export type CertificationItem = z.infer<typeof certificationItemSchema>;
export type CustomItem = z.infer<typeof customItemSchema>;

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

/**
 * Discriminated on `type` so `items` is narrowed correctly — a template
 * rendering an "experience" section gets ExperienceItem[] with no casting.
 */
export const sectionSchema = z.discriminatedUnion("type", [
  z.object({ ...sectionBase, type: z.literal("summary"), items: z.array(summaryItemSchema).max(1) }),
  z.object({ ...sectionBase, type: z.literal("experience"), items: z.array(experienceItemSchema).max(30) }),
  z.object({ ...sectionBase, type: z.literal("education"), items: z.array(educationItemSchema).max(30) }),
  z.object({ ...sectionBase, type: z.literal("skills"), items: z.array(skillsItemSchema).max(30) }),
  z.object({ ...sectionBase, type: z.literal("projects"), items: z.array(projectItemSchema).max(30) }),
  z.object({ ...sectionBase, type: z.literal("certifications"), items: z.array(certificationItemSchema).max(30) }),
  z.object({ ...sectionBase, type: z.literal("custom"), items: z.array(customItemSchema).max(30) }),
]);

export type Section = z.infer<typeof sectionSchema>;

/** Narrows a Section to one specific type, for template render helpers. */
export type SectionOfType<T extends SectionType> = Extract<Section, { type: T }>;

export const resumeContentSchema = z.object({
  personalInfo: personalInfoSchema,
  sections: z.array(sectionSchema).max(20),
});

export type ResumeContent = z.infer<typeof resumeContentSchema>;

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
