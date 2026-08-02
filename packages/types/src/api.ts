import { z } from "zod";
import { resumeContentSchema } from "./content";
import { themeSchema } from "./theme";

// --- Auth ---

export const signupBodySchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  name: z.string().min(1).max(120),
});

export type SignupBody = z.infer<typeof signupBodySchema>;

export const loginBodySchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

export type LoginBody = z.infer<typeof loginBodySchema>;

export const publicUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  createdAt: z.string(),
});

export type PublicUser = z.infer<typeof publicUserSchema>;

// --- Templates ---

export const TEMPLATE_CATEGORIES = [
  "Software Engineer",
  "Academic",
  "Creative",
  "Minimal",
  "Corporate",
] as const;

export const templateCategorySchema = z.enum(TEMPLATE_CATEGORIES);
export type TemplateCategory = z.infer<typeof templateCategorySchema>;

export const templateListQuerySchema = z.object({
  category: templateCategorySchema.optional(),
});

export const templateSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  previewImageUrl: z.string().nullable(),
  category: z.string(),
  isPremium: z.boolean(),
  defaultTheme: themeSchema,
  /** Drives the gallery's live preview, so thumbnails use the real renderer. */
  sampleContent: resumeContentSchema,
});

export type TemplateDto = z.infer<typeof templateSchema>;

// --- Resumes ---

export const createResumeBodySchema = z.object({
  templateId: z.string().min(1),
  title: z.string().min(1).max(160).optional(),
});

export type CreateResumeBody = z.infer<typeof createResumeBodySchema>;

/**
 * Autosave target. Every field optional so the editor can PATCH just what
 * changed, but `.refine` rejects an empty body rather than silently no-oping.
 */
export const updateResumeBodySchema = z
  .object({
    title: z.string().min(1).max(160).optional(),
    content: resumeContentSchema.optional(),
    theme: themeSchema.optional(),
    /** Switching layout. Content is template-agnostic, so this is lossless. */
    templateId: z.string().min(1).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Provide at least one of title, content or theme",
  });

export type UpdateResumeBody = z.infer<typeof updateResumeBodySchema>;

export const resumeSchema = z.object({
  id: z.string(),
  userId: z.string(),
  templateId: z.string(),
  title: z.string(),
  content: resumeContentSchema,
  theme: themeSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ResumeDto = z.infer<typeof resumeSchema>;

/** Resume plus its template's slug, so the client knows which layout to render. */
export const resumeWithTemplateSchema = resumeSchema.extend({
  template: templateSchema,
});

export type ResumeWithTemplateDto = z.infer<typeof resumeWithTemplateSchema>;

export const exportQuerySchema = z.object({
  pageSize: z.enum(["a4", "letter"]).optional(),
});

// --- Errors ---

export const apiErrorSchema = z.object({
  error: z.string(),
  details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
