import { z } from "zod";
import { SECTION_TYPES, sectionTypeSchema } from "./content";
import { fontFamilySchema, hexColorSchema, layoutSchema } from "./theme";

/**
 * The tools the chat assistant is allowed to call.
 *
 * These schemas are doing two jobs at once, and that is the point. The JSON
 * Schema the model is shown is generated from them (`toolFromZod` in
 * `@repo/ai`), and the arguments it sends back are validated against the *same*
 * objects before anything touches the document. A tool whose description drifts
 * from what it actually accepts is not expressible.
 *
 * That is why every field carries `.describe()`: those strings are not
 * documentation for us, they are the prompt. A model that writes
 * `startDate: "2021-06-01"` when the renderer wants "Jun 2021" has been told the
 * wrong thing, not made a mistake.
 *
 * Deliberately absent: any tool that replaces the whole document, sets a raw
 * JSON blob, or deletes a section. The first two are the freeform-JSON failure
 * mode the spec rules out; deletion is withheld because an assistant that can
 * silently drop a job the user spent an hour writing is a worse assistant, and
 * hiding a section (`updateSection` with `visible: false`) covers the honest
 * cases without the destructive one.
 */

// --- Shared field vocabulary ---

const sectionIdArg = z
  .string()
  .min(1)
  .describe("The `id` of the section, exactly as given in the current resume.");

const itemIdArg = z
  .string()
  .min(1)
  .describe("The `id` of the item within that section, exactly as given.");

const dateArg = z
  .string()
  .max(60)
  .describe(
    'A human-readable date as it should be printed, e.g. "Jun 2021", "2019", ' +
      '"Present", "Expected 2026". Never an ISO date — resumes render this verbatim.',
  );

const bulletsArg = z
  .array(z.string().min(1).max(600))
  .max(12)
  .describe(
    "Achievement bullets. Each starts with a strong past-tense verb, states an " +
      "outcome rather than a duty, and quantifies it where a real number is known. " +
      "Never invent metrics that are not already in the resume or the user's message. " +
      "Plain text — no leading bullet characters, no markdown.",
  );

// --- setPersonalInfo ---

export const setPersonalInfoArgsSchema = z
  .object({
    name: z.string().max(120).optional().describe("Full name as it should appear at the top."),
    title: z
      .string()
      .max(160)
      .optional()
      .describe('Professional headline, e.g. "Senior Backend Engineer". Not a company name.'),
    email: z.string().max(160).optional(),
    phone: z.string().max(60).optional(),
    location: z.string().max(120).optional().describe('City and region, e.g. "Austin, TX".'),
    links: z
      .array(
        z.object({
          label: z.string().max(80).describe('Short label, e.g. "GitHub", "Portfolio".'),
          url: z.string().max(300),
        }),
      )
      .max(8)
      .optional()
      .describe("Replaces the whole link list when supplied. Omit to leave links alone."),
  })
  .describe(
    "Update the header block. Only the fields you pass are changed; omit anything " +
      "you do not want to touch.",
  );

export type SetPersonalInfoArgs = z.infer<typeof setPersonalInfoArgsSchema>;

// --- addSection ---

export const addSectionArgsSchema = z
  .object({
    type: sectionTypeSchema.describe(`One of: ${SECTION_TYPES.join(", ")}.`),
    title: z
      .string()
      .max(80)
      .optional()
      .describe('Heading text. Defaults to the standard name for the type, e.g. "Experience".'),
    position: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Zero-based position among existing sections. Appends when omitted."),
  })
  .describe(
    "Add an empty section. It is created with no items — follow with addSectionItem " +
      "for each entry. Prefer reusing an existing section of the same type over adding a second one.",
  );

export type AddSectionArgs = z.infer<typeof addSectionArgsSchema>;

// --- updateSection ---

export const updateSectionArgsSchema = z
  .object({
    sectionId: sectionIdArg,
    title: z.string().max(80).optional(),
    visible: z
      .boolean()
      .optional()
      .describe("False hides the section from the printed resume without deleting its content."),
  })
  .describe("Rename a section or hide it. Does not touch the items inside it.");

export type UpdateSectionArgs = z.infer<typeof updateSectionArgsSchema>;

// --- reorderSections ---

export const reorderSectionsArgsSchema = z
  .object({
    sectionIds: z
      .array(z.string().min(1))
      .min(1)
      .max(20)
      .describe(
        "Every section id, in the order they should appear top to bottom. Any section " +
          "you leave out keeps its current relative position at the end.",
      ),
  })
  .describe(
    "Reorder sections. For most resumes the strongest order is Summary, Experience, " +
      "Projects, Skills, Education — but follow the user's field and instruction over that default.",
  );

export type ReorderSectionsArgs = z.infer<typeof reorderSectionsArgsSchema>;

// --- addSectionItem / updateSectionItem ---

/**
 * One shape covering every section type, with the type-specific fields optional.
 *
 * A discriminated union would be more precise, but both providers flatten
 * `oneOf` unevenly in tool schemas, and a model that picks the wrong branch
 * produces an error the user sees. A flat object with described fields plus a
 * server-side narrowing step (`resume-tools.ts`) is the shape models get right,
 * and the narrowing is where correctness is actually enforced.
 */
const itemFieldsSchema = z.object({
  // summary
  text: z
    .string()
    .max(2000)
    .optional()
    .describe("Summary sections only: 2–4 sentences, first person implied, no pronouns."),

  // experience
  org: z.string().max(160).optional().describe("Experience: the employer's name."),
  role: z.string().max(160).optional().describe("Experience: the job title held."),

  // education
  institution: z.string().max(160).optional().describe("Education: school or university."),
  degree: z
    .string()
    .max(160)
    .optional()
    .describe('Education: e.g. "B.S. Computer Science".'),

  // skills
  category: z
    .string()
    .max(80)
    .optional()
    .describe('Skills: the group label, e.g. "Languages", "Cloud & Infra".'),
  skills: z
    .array(z.string().max(80))
    .max(40)
    .optional()
    .describe("Skills: the individual skills in this group, as separate strings."),

  // projects
  name: z.string().max(160).optional().describe("Projects or certifications: the thing's name."),
  tech: z
    .string()
    .max(200)
    .optional()
    .describe('Projects: comma-separated technologies, e.g. "Go, Postgres, Redis".'),
  link: z.string().max(300).optional().describe("Projects or certifications: a URL."),

  // certifications
  issuer: z.string().max(160).optional().describe("Certifications: the awarding body."),
  date: dateArg.optional().describe("Certifications: when it was awarded."),

  // custom
  heading: z.string().max(160).optional().describe("Custom sections: the entry's main line."),
  subheading: z.string().max(160).optional().describe("Custom sections: the secondary line."),
  dateRange: dateArg.optional().describe("Custom sections: a free-text date range."),

  // shared
  location: z.string().max(120).optional().describe("Experience or education: city and region."),
  startDate: dateArg.optional(),
  endDate: dateArg.optional().describe('End date, or "Present" for a current role.'),
  bullets: bulletsArg.optional(),
});

export const addSectionItemArgsSchema = z
  .object({
    sectionId: sectionIdArg,
    position: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Zero-based position within the section. Appends when omitted."),
    item: itemFieldsSchema.describe(
      "Only the fields belonging to this section's type are kept; the rest are ignored. " +
        "List roles and education most-recent first.",
    ),
  })
  .describe("Add one entry — a job, a degree, a project, a skill group — to a section.");

export type AddSectionItemArgs = z.infer<typeof addSectionItemArgsSchema>;

export const updateSectionItemArgsSchema = z
  .object({
    sectionId: sectionIdArg,
    itemId: itemIdArg,
    item: itemFieldsSchema.describe(
      "Only the fields you pass are changed. Passing `bullets` replaces the whole list.",
    ),
  })
  .describe("Edit one existing entry in place.");

export type UpdateSectionItemArgs = z.infer<typeof updateSectionItemArgsSchema>;

// --- rewriteBullets ---

export const rewriteBulletsArgsSchema = z
  .object({
    sectionId: sectionIdArg,
    itemId: itemIdArg,
    bullets: bulletsArg.describe(
      "The full replacement list for this entry, in order. Keep every fact from the " +
        "originals — rewriting is about phrasing and emphasis, not inventing new experience.",
    ),
  })
  .describe(
    "Replace the bullets under one entry. Use this rather than updateSectionItem when " +
      "bullets are all that changes, so the summary shown to the user is specific.",
  );

export type RewriteBulletsArgs = z.infer<typeof rewriteBulletsArgsSchema>;

// --- setTheme ---

export const setThemeArgsSchema = z
  .object({
    fontFamily: fontFamilySchema.optional().describe("Body typeface."),
    headingFontFamily: fontFamilySchema.optional(),
    fontSizeScale: z
      .number()
      .min(0.8)
      .max(1.3)
      .optional()
      .describe("Multiplier on every type size. Lower to fit more on a page."),
    accentColor: hexColorSchema.optional().describe("Hex, e.g. #1a1a1a. Used for headings and rules."),
    textColor: hexColorSchema.optional(),
    lineSpacing: z.number().min(1).max(2).optional(),
    marginSize: z.number().min(8).max(30).optional().describe("Page margin in millimetres."),
    layout: layoutSchema
      .optional()
      .describe(
        "Column arrangement. Single-column parses most reliably in applicant-tracking " +
          "systems; only move away from it if the user asks.",
      ),
  })
  .describe(
    "Adjust the document's visual theme. Only change what the user asked about — " +
      "restyling a resume nobody asked to restyle is not helpful.",
  );

export type SetThemeArgs = z.infer<typeof setThemeArgsSchema>;

// --- The registry ---

export const AI_TOOL_NAMES = [
  "setPersonalInfo",
  "addSection",
  "updateSection",
  "reorderSections",
  "addSectionItem",
  "updateSectionItem",
  "rewriteBullets",
  "setTheme",
] as const;

export const aiToolNameSchema = z.enum(AI_TOOL_NAMES);
export type AiToolName = z.infer<typeof aiToolNameSchema>;

/**
 * Name → schema, so the tool list handed to a provider and the validator used on
 * the way back are indexed by the same key. Adding a tool means adding one entry
 * here and one case in `applyToolCall`; there is no third place to forget.
 */
export const AI_TOOL_SCHEMAS = {
  setPersonalInfo: setPersonalInfoArgsSchema,
  addSection: addSectionArgsSchema,
  updateSection: updateSectionArgsSchema,
  reorderSections: reorderSectionsArgsSchema,
  addSectionItem: addSectionItemArgsSchema,
  updateSectionItem: updateSectionItemArgsSchema,
  rewriteBullets: rewriteBulletsArgsSchema,
  setTheme: setThemeArgsSchema,
} as const satisfies Record<AiToolName, z.ZodType<unknown>>;

/** The one-line descriptions shown to the model as each tool's purpose. */
export const AI_TOOL_DESCRIPTIONS: Record<AiToolName, string> = {
  setPersonalInfo: "Set or update the name, headline, contact details and links at the top.",
  addSection: "Add a new, empty section to the resume.",
  updateSection: "Rename a section, or show/hide it.",
  reorderSections: "Change the top-to-bottom order of sections.",
  addSectionItem: "Add one entry (job, degree, project, skill group) to a section.",
  updateSectionItem: "Change fields on one existing entry.",
  rewriteBullets: "Replace the bullet points under one entry.",
  setTheme: "Change fonts, colours, spacing, margins or column layout.",
};
