import { z } from "zod";

/**
 * Dates are free-text strings ("Jun 2023", "2021 – Present", "Expected 2026")
 * rather than real dates. Resumes render them verbatim, and forcing an ISO date
 * would make legitimate values like "Present" unrepresentable.
 */
const dateStringSchema = z.string().max(40);

const idSchema = z.string().min(1);

export const linkSchema = z.object({
  id: idSchema,
  label: z.string().max(80),
  url: z.string().max(300),
});

export type ResumeLink = z.infer<typeof linkSchema>;

export const personalInfoSchema = z.object({
  name: z.string().max(120),
  title: z.string().max(160),
  email: z.string().max(160),
  phone: z.string().max(60),
  location: z.string().max(120),
  links: z.array(linkSchema).max(8),
});

export type PersonalInfo = z.infer<typeof personalInfoSchema>;

// --- Section items, one shape per section type ---

export const summaryItemSchema = z.object({
  id: idSchema,
  text: z.string().max(2000),
});

export const experienceItemSchema = z.object({
  id: idSchema,
  org: z.string().max(160),
  role: z.string().max(160),
  location: z.string().max(120),
  startDate: dateStringSchema,
  endDate: dateStringSchema,
  bullets: z.array(z.string().max(600)).max(12),
});

export const educationItemSchema = z.object({
  id: idSchema,
  institution: z.string().max(160),
  degree: z.string().max(160),
  location: z.string().max(120),
  startDate: dateStringSchema,
  endDate: dateStringSchema,
  bullets: z.array(z.string().max(600)).max(12),
});

export const skillsItemSchema = z.object({
  id: idSchema,
  /** e.g. "Languages", "Frameworks" — rendered as a bold inline label. */
  category: z.string().max(80),
  skills: z.array(z.string().max(80)).max(40),
});

export const projectItemSchema = z.object({
  id: idSchema,
  name: z.string().max(160),
  /** Comma-separated tech list, rendered inline after the project name. */
  tech: z.string().max(200),
  link: z.string().max(300),
  startDate: dateStringSchema,
  endDate: dateStringSchema,
  bullets: z.array(z.string().max(600)).max(12),
});

export const certificationItemSchema = z.object({
  id: idSchema,
  name: z.string().max(160),
  issuer: z.string().max(160),
  date: dateStringSchema,
  link: z.string().max(300),
});

export const customItemSchema = z.object({
  id: idSchema,
  heading: z.string().max(160),
  subheading: z.string().max(160),
  dateRange: dateStringSchema,
  bullets: z.array(z.string().max(600)).max(12),
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
  title: z.string().max(80),
  order: z.number().int().min(0),
  visible: z.boolean(),
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
