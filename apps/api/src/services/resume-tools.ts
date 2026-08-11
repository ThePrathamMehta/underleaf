import {
  createEmptySection,
  makeId,
  resumeContentSchema,
  themeSchema,
  AI_TOOL_SCHEMAS,
  type AddSectionArgs,
  type AddSectionItemArgs,
  type AiToolName,
  type ChatToolOutcome,
  type ResumeContent,
  type ReorderSectionsArgs,
  type RewriteBulletsArgs,
  type Section,
  type SetPersonalInfoArgs,
  type SetThemeArgs,
  type Theme,
  type UpdateSectionArgs,
  type UpdateSectionItemArgs,
} from "@repo/types";

/**
 * Applying a validated tool call to a resume.
 *
 * Pure: takes a document and a call, returns a new document. No database, no
 * network, no mutation of the input. That is what makes the guarantee in the
 * Definition of Done — "an invalid tool call is rejected and surfaced as an
 * error, never partially applied" — mechanically true rather than carefully
 * maintained: a call that fails validation never produces a document, and a call
 * that produces a document has already been checked in full.
 *
 * Two validation gates, both required:
 *   1. The arguments parse against the tool's own schema (`AI_TOOL_SCHEMAS`).
 *   2. The resulting document parses against `resumeContentSchema`.
 *
 * The second gate is not redundant. Valid arguments can still compose into an
 * invalid document — adding a second item to a summary section, which caps at
 * one — and only a whole-document check catches that.
 */

export type ToolDocument = { content: ResumeContent; theme: Theme };

export type ToolApplication =
  | { ok: true; document: ToolDocument; outcome: ChatToolOutcome }
  | { ok: false; outcome: ChatToolOutcome };

// --- Helpers ---

function findSection(content: ResumeContent, sectionId: string): Section | undefined {
  return content.sections.find((section) => section.id === sectionId);
}

/** Renumbers `order` to match array position, the same rule the editor uses. */
function renumber(sections: Section[]): Section[] {
  return sections.map((section, index) => ({ ...section, order: index }));
}

function replaceSection(content: ResumeContent, next: Section): ResumeContent {
  return {
    ...content,
    sections: content.sections.map((section) => (section.id === next.id ? next : section)),
  };
}

/**
 * A short label for a section, used in the one-line summaries the user reads.
 * Falls back to the type when a section has been renamed to nothing.
 */
function sectionLabel(section: Section): string {
  return stripHtml(section.title).trim() || section.type;
}

/**
 * Item fields may arrive carrying inline HTML from a model that decided to be
 * helpful. Summaries are rendered as plain text, so strip it there.
 */
function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

function itemLabel(item: Record<string, unknown>): string {
  for (const key of ["role", "org", "name", "degree", "institution", "category", "heading"]) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return stripHtml(value).trim();
  }
  return "that entry";
}

/**
 * Narrows the flat `item` argument to the fields the section's type actually
 * has, filling anything missing from the type's blank template.
 *
 * The tool schema is deliberately flat — see the note in `ai-tools.ts` — so this
 * is where a `tech` field sent to an education section gets dropped rather than
 * smuggled into the document. Starting from `createEmptySection`'s own item
 * means an AI-created entry is shaped identically to an editor-created one,
 * including its id prefix.
 */
function buildItem(
  section: Section,
  fields: Record<string, unknown>,
  base?: Record<string, unknown>,
): Record<string, unknown> {
  const template = createEmptySection(section.type, section.order).items[0] as Record<
    string,
    unknown
  >;
  const start = base ?? { ...template, id: makeId("item") };

  const next: Record<string, unknown> = { ...start };
  for (const key of Object.keys(template)) {
    if (key === "id") continue;
    if (fields[key] !== undefined) next[key] = fields[key];
  }
  return next;
}

/** Wraps a rejection with the outcome shape the transcript and UI both read. */
function reject(name: AiToolName, error: string): ToolApplication {
  return {
    ok: false,
    outcome: { name, summary: `Couldn't ${describe(name)}`, ok: false, error, sectionRef: null },
  };
}

const VERBS: Record<AiToolName, string> = {
  setPersonalInfo: "update your contact details",
  addSection: "add that section",
  updateSection: "update that section",
  reorderSections: "reorder the sections",
  addSectionItem: "add that entry",
  updateSectionItem: "update that entry",
  rewriteBullets: "rewrite those bullets",
  setTheme: "change the styling",
};

function describe(name: AiToolName): string {
  return VERBS[name];
}

// --- The individual tools ---

function applySetPersonalInfo(doc: ToolDocument, args: SetPersonalInfoArgs): ToolDocument {
  const { links, ...scalars } = args;
  const personalInfo = { ...doc.content.personalInfo };

  for (const [key, value] of Object.entries(scalars)) {
    if (value !== undefined) (personalInfo as Record<string, unknown>)[key] = value;
  }

  if (links) {
    personalInfo.links = links.map((link) => ({ id: makeId("link"), ...link }));
  }

  return { ...doc, content: { ...doc.content, personalInfo } };
}

function applyAddSection(doc: ToolDocument, args: AddSectionArgs): ToolDocument {
  const section = createEmptySection(args.type, doc.content.sections.length);
  if (args.title) section.title = args.title;
  // Created empty: the factory seeds one placeholder item so a human has
  // something to type into, but an assistant is about to call addSectionItem
  // with real content and a stray "Company / Role" row would survive it.
  section.items = [];

  const sections = [...doc.content.sections].sort((a, b) => a.order - b.order);
  const at = args.position === undefined ? sections.length : Math.min(args.position, sections.length);
  sections.splice(at, 0, section);

  return { ...doc, content: { ...doc.content, sections: renumber(sections) } };
}

function applyUpdateSection(
  doc: ToolDocument,
  section: Section,
  args: UpdateSectionArgs,
): ToolDocument {
  const next: Section = {
    ...section,
    ...(args.title !== undefined && { title: args.title }),
    ...(args.visible !== undefined && { visible: args.visible }),
  };
  return { ...doc, content: replaceSection(doc.content, next) };
}

function applyReorderSections(doc: ToolDocument, args: ReorderSectionsArgs): ToolDocument {
  const byId = new Map(doc.content.sections.map((section) => [section.id, section]));
  const ordered: Section[] = [];

  for (const id of args.sectionIds) {
    const section = byId.get(id);
    // An id the model invented is skipped rather than failing the call: the
    // user's intent — this order, for the sections that exist — still holds.
    if (section && !ordered.includes(section)) ordered.push(section);
  }

  // Anything the model left out keeps its relative position, at the end.
  const remaining = doc.content.sections
    .filter((section) => !ordered.includes(section))
    .sort((a, b) => a.order - b.order);

  return {
    ...doc,
    content: { ...doc.content, sections: renumber([...ordered, ...remaining]) },
  };
}

function applyAddSectionItem(
  doc: ToolDocument,
  section: Section,
  args: AddSectionItemArgs,
): ToolDocument {
  const item = buildItem(section, args.item as Record<string, unknown>);
  const items = [...(section.items as Record<string, unknown>[])];
  const at = args.position === undefined ? items.length : Math.min(args.position, items.length);
  items.splice(at, 0, item);

  return { ...doc, content: replaceSection(doc.content, { ...section, items } as Section) };
}

function applyUpdateSectionItem(
  doc: ToolDocument,
  section: Section,
  existing: Record<string, unknown>,
  args: UpdateSectionItemArgs,
): ToolDocument {
  const item = buildItem(section, args.item as Record<string, unknown>, existing);
  const items = (section.items as Record<string, unknown>[]).map((candidate) =>
    candidate.id === existing.id ? item : candidate,
  );

  return { ...doc, content: replaceSection(doc.content, { ...section, items } as Section) };
}

function applyRewriteBullets(
  doc: ToolDocument,
  section: Section,
  existing: Record<string, unknown>,
  args: RewriteBulletsArgs,
): ToolDocument {
  const items = (section.items as Record<string, unknown>[]).map((candidate) =>
    candidate.id === existing.id ? { ...candidate, bullets: args.bullets } : candidate,
  );

  return { ...doc, content: replaceSection(doc.content, { ...section, items } as Section) };
}

function applySetTheme(doc: ToolDocument, args: SetThemeArgs): ToolDocument {
  const theme = { ...doc.theme };
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined) (theme as Record<string, unknown>)[key] = value;
  }
  return { ...doc, theme };
}

// --- The entry point ---

/**
 * Validates one tool call and returns the resulting document, or a rejection.
 *
 * `rawArguments` is the JSON text the provider streamed. It is parsed here
 * rather than by the caller so there is exactly one place where untrusted model
 * output becomes a typed value.
 */
export function applyToolCall(
  doc: ToolDocument,
  name: string,
  rawArguments: string,
): ToolApplication {
  if (!(name in AI_TOOL_SCHEMAS)) {
    return {
      ok: false,
      outcome: {
        // Cast is safe for display only: the name is echoed back so the model
        // can see what it got wrong, and the call is refused either way.
        name: name as AiToolName,
        summary: "Unknown tool",
        ok: false,
        error: `There is no tool called "${name}".`,
        sectionRef: null,
      },
    };
  }

  const toolName = name as AiToolName;

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawArguments || "{}");
  } catch {
    return reject(toolName, "The arguments weren't valid JSON.");
  }

  const parsed = AI_TOOL_SCHEMAS[toolName].safeParse(parsedJson);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return reject(toolName, detail);
  }

  let next: ToolDocument;
  let summary: string;
  let sectionRef: string | null = null;

  switch (toolName) {
    case "setPersonalInfo": {
      const args = parsed.data as SetPersonalInfoArgs;
      next = applySetPersonalInfo(doc, args);
      const fields = Object.keys(args).filter(
        (key) => args[key as keyof SetPersonalInfoArgs] !== undefined,
      );
      summary = `Updated your ${listFields(fields)}`;
      break;
    }

    case "addSection": {
      const args = parsed.data as AddSectionArgs;
      next = applyAddSection(doc, args);
      const added = next.content.sections.find(
        (section) => !doc.content.sections.some((old) => old.id === section.id),
      );
      sectionRef = added?.id ?? null;
      summary = `Added a ${added ? sectionLabel(added) : args.type} section`;
      break;
    }

    case "updateSection": {
      const args = parsed.data as UpdateSectionArgs;
      const section = findSection(doc.content, args.sectionId);
      if (!section) return reject(toolName, `No section with id "${args.sectionId}".`);

      next = applyUpdateSection(doc, section, args);
      sectionRef = section.id;
      summary =
        args.visible === false
          ? `Hid the ${sectionLabel(section)} section`
          : args.visible === true
            ? `Showed the ${sectionLabel(section)} section`
            : `Renamed ${sectionLabel(section)} to ${stripHtml(args.title ?? "")}`;
      break;
    }

    case "reorderSections": {
      next = applyReorderSections(doc, parsed.data as ReorderSectionsArgs);
      summary = "Reordered the sections";
      break;
    }

    case "addSectionItem": {
      const args = parsed.data as AddSectionItemArgs;
      const section = findSection(doc.content, args.sectionId);
      if (!section) return reject(toolName, `No section with id "${args.sectionId}".`);

      next = applyAddSectionItem(doc, section, args);
      sectionRef = section.id;
      summary = `Added ${itemLabel(args.item as Record<string, unknown>)} to ${sectionLabel(section)}`;
      break;
    }

    case "updateSectionItem": {
      const args = parsed.data as UpdateSectionItemArgs;
      const section = findSection(doc.content, args.sectionId);
      if (!section) return reject(toolName, `No section with id "${args.sectionId}".`);

      const existing = (section.items as Record<string, unknown>[]).find(
        (item) => item.id === args.itemId,
      );
      if (!existing) {
        return reject(toolName, `No entry with id "${args.itemId}" in ${sectionLabel(section)}.`);
      }

      next = applyUpdateSectionItem(doc, section, existing, args);
      sectionRef = section.id;
      summary = `Updated ${itemLabel(existing)} in ${sectionLabel(section)}`;
      break;
    }

    case "rewriteBullets": {
      const args = parsed.data as RewriteBulletsArgs;
      const section = findSection(doc.content, args.sectionId);
      if (!section) return reject(toolName, `No section with id "${args.sectionId}".`);

      const existing = (section.items as Record<string, unknown>[]).find(
        (item) => item.id === args.itemId,
      );
      if (!existing) {
        return reject(toolName, `No entry with id "${args.itemId}" in ${sectionLabel(section)}.`);
      }
      if (!("bullets" in existing)) {
        return reject(toolName, `${sectionLabel(section)} entries don't have bullets.`);
      }

      next = applyRewriteBullets(doc, section, existing, args);
      sectionRef = section.id;
      const count = args.bullets.length;
      summary = `Rewrote ${count} bullet${count === 1 ? "" : "s"} under ${itemLabel(existing)}`;
      break;
    }

    case "setTheme": {
      const args = parsed.data as SetThemeArgs;
      next = applySetTheme(doc, args);
      summary = `Adjusted the ${listFields(Object.keys(args))}`;
      break;
    }
  }

  // Gate two: the whole document, not just the arguments. This is what catches
  // valid-but-incompatible calls, e.g. a second item in a summary section.
  const content = resumeContentSchema.safeParse(next.content);
  if (!content.success) {
    const detail = content.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return reject(toolName, `That would have made the resume invalid — ${detail}`);
  }

  const theme = themeSchema.safeParse(next.theme);
  if (!theme.success) {
    return reject(toolName, "That would have made the theme invalid.");
  }

  return {
    ok: true,
    document: { content: content.data, theme: theme.data },
    outcome: { name: toolName, summary, ok: true, error: null, sectionRef },
  };
}

/** "name, headline and email" — an Oxford-comma-free list for one-line summaries. */
function listFields(fields: string[]): string {
  const labels: Record<string, string> = {
    name: "name",
    title: "headline",
    email: "email",
    phone: "phone",
    location: "location",
    links: "links",
    fontFamily: "body font",
    headingFontFamily: "heading font",
    fontSizeScale: "type size",
    accentColor: "accent colour",
    textColor: "text colour",
    lineSpacing: "line spacing",
    marginSize: "margins",
    layout: "layout",
  };

  const named = fields.map((field) => labels[field] ?? field);
  if (named.length === 0) return "styling";
  if (named.length === 1) return named[0]!;
  return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}
