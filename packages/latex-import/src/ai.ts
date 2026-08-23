import {
  resumeContentSchema,
  type ResumeContent,
  type Section,
} from "@repo/types";

/**
 * The AI half of the import: the prompt, and the validation that holds a reply to
 * the same schema the deterministic parser fills.
 *
 * Here rather than in the API because none of it does I/O. The provider call
 * belongs to `apps/api`, which owns credentials and metering; asking a model for
 * JSON and deciding whether that JSON is a resume is pure logic, and pure logic
 * in this package is logic under test — including the salvage paths, which are the
 * ones that matter most and the hardest to reach through a live provider.
 */

/**
 * What the model is asked for.
 *
 * Deliberately not the schema itself: ids, the `order` and `visible` bookkeeping
 * and the exact item variants are this codebase's business, and asking a model to
 * invent cuids is asking it to get something wrong. It returns the content;
 * `parseLatexReply` assembles the document.
 */
export const LATEX_IMPORT_SYSTEM_PROMPT = [
  "You convert LaTeX resume source into structured JSON.",
  "",
  "You are given the complete .tex source of one resume. Extract what it says.",
  "",
  "Rules:",
  "1. Copy text from the source. Never write a bullet, a job title, a date or a skill that is not in the source — an empty field is always the correct answer for something the source does not contain.",
  "2. Resolve LaTeX to plain text: `\\&` is '&', `--` is an en dash, `$|$` is a separator, `\\href{url}{label}` is the label. Drop spacing and font commands entirely.",
  "3. You may use only these inline tags, and only where the source emphasises text: <b>, <i>, <u>. No other HTML, and no LaTeX commands, in any field.",
  "4. Classify each section by its heading into one of: summary, experience, education, skills, projects, certifications, custom. Anything that fits none of those is 'custom' — keep its heading as `title`.",
  "5. Split date ranges into `startDate` and `endDate`. Keep them exactly as written, including words like 'Present'. A single date with no range goes in `startDate`.",
  "6. Ignore the preamble: `\\newcommand`, `\\usepackage` and `\\documentclass` define the document, they are not content.",
  "7. Skip commented-out lines. A line starting with `%` is not part of the resume.",
  "",
  "Respond with JSON only. No prose, no markdown fence, no explanation.",
].join("\n");

/** The JSON shape asked for, which a reply is held to before anything else. */
const REPLY_SHAPE = JSON.stringify(
  {
    personalInfo: {
      name: "string",
      title: "string — a tagline under the name, or empty",
      email: "string",
      phone: "string",
      location: "string",
      links: [{ label: "string", url: "string" }],
    },
    sections: [
      {
        type: "summary | experience | education | skills | projects | certifications | custom",
        title: "string — the section's heading, as written",
        items: [
          {
            "// summary": { text: "string" },
            "// experience": {
              org: "string",
              role: "string",
              location: "string",
              startDate: "string",
              endDate: "string",
              bullets: ["string"],
            },
            "// education": {
              institution: "string",
              degree: "string",
              location: "string",
              startDate: "string",
              endDate: "string",
              bullets: ["string"],
            },
            "// skills": { category: "string", skills: ["string"] },
            "// projects": {
              name: "string",
              tech: "string",
              link: "string",
              startDate: "string",
              endDate: "string",
              bullets: ["string"],
            },
            "// certifications": {
              name: "string",
              issuer: "string",
              date: "string",
              link: "string",
            },
            "// custom": {
              heading: "string",
              subheading: "string",
              dateRange: "string",
              bullets: ["string"],
            },
          },
        ],
      },
    ],
  },
  null,
  1,
);

/** The user turn: the shape to fill, then the source to fill it from. */
export function buildLatexImportRequest(latexSource: string): string {
  return [
    "Return JSON of exactly this shape. The `// type` keys show which item",
    "shape belongs to which section type — use the shape, not the comment key:",
    REPLY_SHAPE,
    "",
    "LaTeX source:",
    latexSource,
  ].join("\n");
}

/**
 * The outcome of reading a reply.
 *
 * A result rather than an exception, so the boundary carries no error class: this
 * package doesn't depend on `@repo/ai` and shouldn't have to in order to say "that
 * wasn't a resume". The caller decides what an unusable reply means — which for
 * the import is "fall back to what the pattern-matcher found".
 */
export type LatexReplyOutcome =
  | { ok: true; content: ResumeContent; warnings: string[] }
  | { ok: false; reason: string };

/** Extracts the JSON object from a completion that may be fenced or prefaced. */
function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;

  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** An item has to be an object before its fields mean anything. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const EMPTY_HEADER = {
  name: "",
  title: "",
  email: "",
  phone: "",
  location: "",
  links: [] as { id: string; label: string; url: string }[],
};

/**
 * Every field each item shape requires, empty.
 *
 * The schema requires all of them — `subheading` is not optional just because a
 * given entry has nothing to put there — so a reply that leaves one out would lose
 * its whole section to a missing key. Merged under the model's item instead, which
 * turns "didn't mention it" into "hasn't got one".
 *
 * Deliberately not `createEmptySection`, which fills these with placeholder words
 * like "Company" and "Role". Those are right for a section the user asked for and
 * wrong here: an imported resume must contain the source's words and nothing else,
 * so a field the model didn't fill stays visibly empty.
 */
const ITEM_DEFAULTS: Record<string, Record<string, unknown>> = {
  summary: { text: "" },
  experience: { org: "", role: "", location: "", startDate: "", endDate: "", bullets: [] },
  education: { institution: "", degree: "", location: "", startDate: "", endDate: "", bullets: [] },
  skills: { category: "", skills: [] },
  projects: { name: "", tech: "", link: "", startDate: "", endDate: "", bullets: [] },
  certifications: { name: "", issuer: "", date: "", link: "" },
  custom: { heading: "", subheading: "", dateRange: "", bullets: [] },
};

/**
 * One item, coerced toward the shape its section needs.
 *
 * Two repairs, both for cases with only one sensible reading: a `null` where a
 * string belongs is the model declining to answer, and a bare string where a list
 * belongs is one entry rather than none. Anything less obvious is left alone to
 * fail validation, because guessing at a shape the model didn't mean is how an
 * import ends up confidently wrong.
 */
function coerceItem(raw: Record<string, unknown>, sectionType: string, id: string) {
  const given = Object.fromEntries(
    Object.entries(raw).filter(([, value]) => value !== null && value !== undefined),
  );

  if (typeof given.bullets === "string") given.bullets = [given.bullets];
  if (typeof given.skills === "string") {
    given.skills = given.skills
      .split(",")
      .map((skill) => skill.trim())
      .filter(Boolean);
  }

  return { ...(ITEM_DEFAULTS[sectionType] ?? ITEM_DEFAULTS.custom), ...given, id };
}

/**
 * Turns a model's reply into a document, salvaging rather than rejecting.
 *
 * A reply that fails validation wholesale is the case the spec is most explicit
 * about: the user still gets an editable pre-fill of whatever *was* extracted,
 * never a bare error. So the assembly is per-section — a section the model
 * mangled is dropped and named in a warning, and the rest of the resume survives
 * it.
 *
 * The `id`/`order`/`visible` bookkeeping is added here rather than asked for,
 * which also means a section can be validated on its own before it is kept.
 */
export function parseLatexReply(reply: string): LatexReplyOutcome {
  const raw = extractJson(reply);
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, reason: "The model's reply did not contain a JSON object." };
  }

  const warnings: string[] = [];
  const source = raw as Record<string, unknown>;

  const info = (source.personalInfo ?? {}) as Record<string, unknown>;
  const links = Array.isArray(info.links) ? info.links : [];
  const personalInfo = {
    name: text(info.name),
    title: text(info.title),
    email: text(info.email),
    phone: text(info.phone),
    location: text(info.location),
    links: links.slice(0, 8).map((link, index) => {
      const entry = (link ?? {}) as Record<string, unknown>;
      return {
        id: `link_${index}`,
        label: text(entry.label) || text(entry.url),
        url: text(entry.url),
      };
    }),
  };

  const sections: Section[] = [];
  const rawSections = Array.isArray(source.sections) ? source.sections : [];

  rawSections.forEach((entry, index) => {
    const section = (entry ?? {}) as Record<string, unknown>;
    const rawItems = Array.isArray(section.items) ? section.items : [];

    // A section the model gave no items for is nothing to report — there is no
    // content here that could have gone missing.
    if (rawItems.length === 0) return;

    const type = text(section.type) || "custom";
    const title = text(section.title) || "Section";
    const items = rawItems
      .filter(isRecord)
      .map((item, position) => coerceItem(item, type, `item_${index}_${position}`));

    // Validated one section at a time, against the real schema, so a shape the
    // model got wrong costs that section and not the import.
    const parsed =
      items.length > 0
        ? resumeContentSchema.pick({ sections: true }).safeParse({
            sections: [{ id: `sec_${index}`, type, title, order: sections.length, visible: true, items }],
          })
        : undefined;

    if (parsed?.success) {
      sections.push(parsed.data.sections[0]!);
      return;
    }
    warnings.push(
      `The "${title.slice(0, 60)}" section couldn't be read and was left out — add it by hand.`,
    );
  });

  // Nothing usable at all is a failed read, not a document. Returning an empty
  // resume here would present the model's silence as a successful import.
  if (sections.length === 0 && personalInfo.name === "") {
    return { ok: false, reason: "The model's reply held no resume content." };
  }

  /**
   * A document with sections but no name.
   *
   * Said out loud rather than left to be noticed. An empty header renders as
   * blank space at the top of the page, which reads as a layout quirk rather than
   * as a field waiting to be filled — and "never fails silently" means the import
   * has to name the one thing every reader of a resume looks for first.
   */
  if (personalInfo.name === "") {
    warnings.push("The name and contact details couldn't be read — fill them in at the top.");
  }

  const content = resumeContentSchema.safeParse({ personalInfo, sections });
  if (content.success) return { ok: true, content: content.data, warnings };

  // The header failed validation outright — a field past its length cap, most
  // likely. The sections above are already proved valid, so the document is
  // rebuilt around an empty header rather than lost.
  return {
    ok: true,
    content: { personalInfo: { ...EMPTY_HEADER }, sections },
    warnings: personalInfo.name === ""
      ? warnings
      : [...warnings, "The name and contact details couldn't be read — fill them in at the top."],
  };
}
