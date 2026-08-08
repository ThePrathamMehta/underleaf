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
  /**
   * Whether this account can sign in with a password at all. OAuth-only users
   * have no hash, so settings must offer them "set a password" rather than
   * "change" one, and can't ask for a current password they never chose.
   *
   * A boolean rather than the hash itself — the hash never leaves the server.
   */
  hasPassword: z.boolean(),
  /** `"google"`, `"github"`, or null for a password-only account. */
  oauthProvider: z.string().nullable(),
});

export type PublicUser = z.infer<typeof publicUserSchema>;

// --- Account settings ---

/**
 * Both fields optional so the form can send only what changed, but at least one
 * must be present: an empty PATCH is a mistake on the caller's side, not a
 * no-op worth pretending succeeded.
 */
export const updateProfileBodySchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    email: z.string().email().max(200).optional(),
  })
  .refine((body) => body.name !== undefined || body.email !== undefined, {
    message: "Provide a name or an email to change",
  });

export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>;

/**
 * `currentPassword` is optional here rather than required, because an OAuth-only
 * account has no current password to prove. The route enforces it whenever the
 * account actually has a hash — validation can't see that.
 */
export const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1).max(200).optional(),
  newPassword: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;

/**
 * Deleting is irreversible and cascades to every resume and uploaded PDF, so it
 * needs a proof of intent. Which proof depends on the account: a password user
 * retypes their password, an OAuth-only user — who has none — retypes their own
 * email address. The route picks; both are optional to the schema.
 */
export const deleteAccountBodySchema = z.object({
  password: z.string().min(1).max(200).optional(),
  confirmEmail: z.string().max(200).optional(),
});

export type DeleteAccountBody = z.infer<typeof deleteAccountBodySchema>;

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
  /**
   * Profession slug. Composes with `category` as an AND — the two describe
   * different axes (who it's for vs. what it looks like), so narrowing by both
   * is meaningful rather than contradictory.
   *
   * Free-form rather than an enum: professions are seeded rows the user can
   * extend, unlike categories, which the templates themselves declare.
   */
  profession: z.string().min(1).max(80).optional(),
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

// --- Professions ---

export const professionSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  /** Key into the icon set in @repo/ui. Never an emoji, per the v1 design rules. */
  iconKey: z.string(),
  sortOrder: z.number(),
});

export type ProfessionDto = z.infer<typeof professionSchema>;

// --- Resumes ---

export const createResumeBodySchema = z.object({
  templateId: z.string().min(1),
  title: z.string().min(1).max(160).optional(),
  /**
   * "Start from Blank": create against the given template but with an empty
   * scaffolded content payload instead of the template's sample content.
   */
  blank: z.boolean().optional(),
  /**
   * Profession slug the user was browsing when they picked this template. The
   * new resume then starts from that profession's sample rather than the
   * template's general one — so what they previewed is what they get.
   *
   * A slug, not the content itself: the server resolves it against the seeded
   * row, so a client can't post arbitrary content in as a "sample".
   */
  profession: z.string().min(1).max(80).optional(),
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
