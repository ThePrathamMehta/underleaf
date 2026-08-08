import type { Profession, Resume, Template } from "@repo/db";
import {
  resumeContentSchema,
  themeSchema,
  type ProfessionDto,
  type ResumeContent,
  type ResumeDto,
  type TemplateDto,
  type Theme,
} from "@repo/types";

/**
 * Prisma types `Json` columns as `JsonValue`, so the shape has to be re-checked
 * at the boundary. Parsing here means a row written by an older schema surfaces
 * as a clear 500 rather than rendering a broken resume.
 */
export function parseTheme(value: unknown): Theme {
  return themeSchema.parse(value);
}

export function parseContent(value: unknown): ResumeContent {
  return resumeContentSchema.parse(value);
}

/**
 * @param sampleOverride Sample content to show instead of the template's own —
 * the selected profession's, when the gallery is filtered by one. Templates are
 * shared across professions (the Classic layout is a curated pick for six), so
 * the profession-specific document can't live on the template row and has to be
 * substituted here.
 *
 * Ignored if it fails validation: a preview showing the general sample is a far
 * better outcome than a 500 that empties the gallery.
 */
export function serializeTemplate(template: Template, sampleOverride?: unknown): TemplateDto {
  const override = sampleOverride == null ? null : resumeContentSchema.safeParse(sampleOverride);

  return {
    id: template.id,
    name: template.name,
    slug: template.slug,
    description: template.description,
    previewImageUrl: template.previewImageUrl,
    category: template.category,
    isPremium: template.isPremium,
    defaultTheme: parseTheme(template.defaultTheme),
    sampleContent: override?.success ? override.data : parseContent(template.sampleContent),
  };
}

export function serializeProfession(profession: Profession): ProfessionDto {
  return {
    id: profession.id,
    name: profession.name,
    slug: profession.slug,
    description: profession.description,
    iconKey: profession.iconKey,
    sortOrder: profession.sortOrder,
  };
}

export function serializeResume(resume: Resume): ResumeDto {
  return {
    id: resume.id,
    userId: resume.userId,
    templateId: resume.templateId,
    title: resume.title,
    content: parseContent(resume.content),
    theme: parseTheme(resume.theme),
    createdAt: resume.createdAt.toISOString(),
    updatedAt: resume.updatedAt.toISOString(),
  };
}

export function serializeResumeWithTemplate(resume: Resume & { template: Template }) {
  return {
    ...serializeResume(resume),
    template: serializeTemplate(resume.template),
  };
}
