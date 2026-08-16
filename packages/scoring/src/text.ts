import type {
  ResumeContent,
  Section,
  SectionType,
} from "@repo/types";
import { isTextItem, sectionEntries } from "@repo/types";

/**
 * Turning a resume into text an ATS would see.
 *
 * Every check in this package reasons about *readable* text, never markup. The
 * content schema stores a small subset of inline HTML, so `<strong>Led</strong>
 * a team` has to become `Led a team` before anything counts words in it —
 * otherwise "led" is invisible to the action-verb check and "strong" is a word.
 */

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/** Strips the inline-HTML subset and decodes the entities the editor writes. */
export function toPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lowercased word tokens, apostrophes kept so "don't" doesn't become two words. */
export function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z][a-z0-9'+#./-]*/g);
  return matches ? matches.map((token) => token.replace(/^[-.]+|[-.']+$/g, "")).filter(Boolean) : [];
}

/**
 * Words too common to carry meaning in a keyword diff.
 *
 * Deliberately short. An over-eager stoplist is worse than none here: "lead",
 * "design" and "support" all look like filler and are all real job requirements.
 */
export const STOP_WORDS = new Set([
  "a", "about", "above", "across", "after", "all", "also", "an", "and", "any", "are", "as", "at",
  "be", "been", "being", "both", "but", "by", "can", "come", "could", "do", "does", "doing", "each",
  "either", "else", "etc", "even", "every", "for", "from", "get", "goes", "going", "had", "has",
  "have", "having", "he", "her", "here", "hers", "him", "his", "how", "however", "i", "if", "in",
  "into", "is", "it", "its", "just", "like", "make", "makes", "many", "may", "me", "might", "more",
  "most", "much", "must", "my", "need", "needs", "no", "nor", "not", "now", "of", "off", "on",
  "once", "one", "only", "or", "other", "others", "our", "ours", "out", "over", "own", "per",
  "same", "shall", "she", "should", "since", "so", "some", "such", "take", "than", "that", "the",
  "their", "theirs", "them", "then", "there", "these", "they", "this", "those", "through", "to",
  "too", "under", "until", "up", "upon", "us", "use", "used", "using", "very", "via", "want", "was",
  "we", "well", "were", "what", "when", "where", "whether", "which", "while", "who", "whom", "why",
  "will", "with", "within", "would", "you", "your", "yours",
  // Posting boilerplate that is never a skill.
  "ability", "applicant", "apply", "benefits", "candidate", "candidates", "company", "employer",
  "employment", "equal", "experience", "job", "opportunity", "position", "responsibilities",
  "role", "salary", "team", "work", "working", "years",
]);

export function isMeaningful(token: string): boolean {
  return token.length > 1 && !STOP_WORDS.has(token);
}

// --- Reading a resume as text ---

/** One addressable piece of resume text, tagged with where it came from. */
export type TextChunk = {
  sectionId: string | null;
  sectionType: SectionType | null;
  /** Human label for the place, used verbatim in `evidence` strings. */
  where: string;
  text: string;
};

function label(section: Section): string {
  return toPlainText(section.title) || section.type;
}

/** Every readable string in a section, item by item. */
function sectionChunks(section: Section): TextChunk[] {
  const chunks: TextChunk[] = [];
  const at = (text: string, where: string) => {
    const plain = toPlainText(text);
    if (plain) chunks.push({ sectionId: section.id, sectionType: section.type, where, text: plain });
  };

  const name = label(section);
  at(section.title, name);

  // Free text blocks read the same wherever they sit, so they're collected once
  // here rather than in all seven branches below. They count: a note is printed,
  // so an ATS parses it, and leaving it out would score the document as if the
  // words weren't there.
  section.items.filter(isTextItem).forEach((item) => at(item.text, name));

  // Everything from here on is the section's own entries; the switch narrows
  // `items` to the union of both, so the text blocks are filtered back out.
  switch (section.type) {
    case "summary":
      sectionEntries(section.items).forEach((item) => at(item.text, name));
      break;
    case "experience":
      sectionEntries(section.items).forEach((item) => {
        const where = `${toPlainText(item.role) || "role"} at ${toPlainText(item.org) || name}`;
        at(item.role, where);
        at(item.org, where);
        item.bullets.forEach((bullet) => at(bullet, where));
      });
      break;
    case "education":
      sectionEntries(section.items).forEach((item) => {
        const where = toPlainText(item.institution) || name;
        at(item.degree, where);
        at(item.institution, where);
        item.bullets.forEach((bullet) => at(bullet, where));
      });
      break;
    case "skills":
      sectionEntries(section.items).forEach((item) => {
        const where = toPlainText(item.category) ? `${name} (${toPlainText(item.category)})` : name;
        at(item.category, where);
        item.skills.forEach((skill) => at(skill, where));
      });
      break;
    case "projects":
      sectionEntries(section.items).forEach((item) => {
        const where = toPlainText(item.name) || name;
        at(item.name, where);
        at(item.tech, where);
        item.bullets.forEach((bullet) => at(bullet, where));
      });
      break;
    case "certifications":
      sectionEntries(section.items).forEach((item) => {
        const where = toPlainText(item.name) || name;
        at(item.name, where);
        at(item.issuer, where);
      });
      break;
    case "custom":
      sectionEntries(section.items).forEach((item) => {
        const where = toPlainText(item.heading) || name;
        at(item.heading, where);
        at(item.subheading, where);
        item.bullets.forEach((bullet) => at(bullet, where));
      });
      break;
  }

  return chunks;
}

/**
 * Every chunk of readable text in the resume.
 *
 * Hidden sections are skipped: they don't render, so they aren't in the exported
 * PDF, so an ATS never sees them. Counting them would inflate the score against
 * a document nobody will read.
 */
export function resumeChunks(content: ResumeContent): TextChunk[] {
  const personal: TextChunk[] = [
    { field: "name", text: content.personalInfo.name },
    { field: "title", text: content.personalInfo.title },
    { field: "location", text: content.personalInfo.location },
    ...content.personalInfo.links.map((link) => ({ field: "links", text: link.label })),
  ]
    .map(({ field, text }) => ({
      sectionId: null,
      sectionType: null,
      where: `Header (${field})`,
      text: toPlainText(text),
    }))
    .filter((chunk) => chunk.text.length > 0);

  const sections = content.sections
    .filter((section) => section.visible)
    .sort((a, b) => a.order - b.order)
    .flatMap(sectionChunks);

  return [...personal, ...sections];
}

/** The whole visible resume as one lowercased string, for substring matching. */
export function resumeText(content: ResumeContent): string {
  return resumeChunks(content)
    .map((chunk) => chunk.text)
    .join("\n")
    .toLowerCase();
}

/** Every bullet in the resume, with the item it belongs to. */
export type BulletRef = {
  sectionId: string;
  sectionTitle: string;
  sectionType: SectionType;
  where: string;
  text: string;
};

export function resumeBullets(content: ResumeContent): BulletRef[] {
  const bullets: BulletRef[] = [];

  for (const section of content.sections) {
    if (!section.visible) continue;
    if (section.type === "summary" || section.type === "skills" || section.type === "certifications") {
      continue;
    }

    const sectionTitle = label(section);

    for (const item of section.items) {
      if (!("bullets" in item)) continue;

      const where =
        "role" in item
          ? `${toPlainText(item.role) || "role"} at ${toPlainText(item.org) || sectionTitle}`
          : "institution" in item
            ? toPlainText(item.institution) || sectionTitle
            : "name" in item
              ? toPlainText(item.name) || sectionTitle
              : toPlainText(item.heading) || sectionTitle;

      for (const bullet of item.bullets) {
        const text = toPlainText(bullet);
        if (text) {
          bullets.push({ sectionId: section.id, sectionTitle, sectionType: section.type, where, text });
        }
      }
    }
  }

  return bullets;
}

/** Word count of the visible resume, which is what "one page" is judged against. */
export function wordCount(content: ResumeContent): number {
  return resumeChunks(content).reduce(
    (total, chunk) => total + (chunk.text.match(/\S+/g)?.length ?? 0),
    0,
  );
}
