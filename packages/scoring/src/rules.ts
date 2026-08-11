import type {
  AtsCategory,
  AtsCategoryScores,
  AtsIssue,
  AtsSeverity,
  ResumeContent,
  Theme,
} from "@repo/types";
import { ATS_SEVERITY_RANK } from "@repo/types";
import {
  resumeBullets,
  resumeChunks,
  resumeText,
  toPlainText,
  tokenize,
  wordCount,
  type BulletRef,
} from "./text";
import { ACTION_VERBS, SKILL_TERMS, STANDARD_HEADINGS, WEAK_OPENERS } from "./vocabulary";

/**
 * The deterministic half of ATS scoring.
 *
 * Every check here is a pure function of the document. That is the whole point:
 * the spec asks for a hybrid, and a hybrid is only worth building if the free
 * half stands on its own when the paid half is unreachable. So this module has
 * no imports from `@repo/ai`, no I/O, and no clock — the same resume scores the
 * same number every time, which is also what makes "your score went up" a fact
 * rather than provider noise.
 *
 * Scores start at 100 per category and lose points per issue. Penalties are
 * deliberately blunt integers rather than a tuned model: a made-up 0.37 weight
 * would imply a precision this doesn't have.
 */

/** Layouts an ATS parses by column rather than by reading order. */
const MULTI_COLUMN_LAYOUTS = new Set(["sidebar-left", "sidebar-right", "two-column"]);

const PENALTIES: Record<AtsSeverity, number> = {
  critical: 22,
  warning: 11,
  suggestion: 5,
};

/** Reasonable bullet length in words — long enough to say something, short enough to scan. */
const BULLET_MIN_WORDS = 6;
const BULLET_MAX_WORDS = 34;

/** Above this, a resume is being read by nobody in full. */
const LONG_RESUME_WORDS = 950;
const SHORT_RESUME_WORDS = 180;

export type RuleCheckResult = {
  issues: AtsIssue[];
  categoryScores: AtsCategoryScores;
  overallScore: number;
  /** Facts the AI half is given so it doesn't recompute what's already known. */
  facts: ResumeFacts;
};

export type ResumeFacts = {
  wordCount: number;
  bulletCount: number;
  quantifiedBulletCount: number;
  sectionTypes: string[];
  skillTermsFound: string[];
  hasEmail: boolean;
  hasPhone: boolean;
  multiColumn: boolean;
};

/** Detects a number that means something: 40%, $2M, 3x, 12 people, 250ms. */
const QUANTIFIER = /(\$\s?\d|\d+\s?(%|percent|x\b|k\b|m\b|bn\b|million|billion|hours?|days?|weeks?|months?|years?|users?|customers?|clients?|people|engineers?|reports?|ms\b|s\b|qps|rps|req\/s))|(\b\d{2,}\b)/i;

export function isQuantified(text: string): boolean {
  return QUANTIFIER.test(text);
}

/**
 * Whether a bullet opens with an action verb.
 *
 * Matches the listed past-tense form, and also the present tense a current role
 * legitimately uses ("Lead a team of six"), by stemming the opener back to a
 * listed word rather than doubling the size of the list.
 */
export function startsWithActionVerb(text: string): boolean {
  const [first] = tokenize(text);
  if (!first) return false;
  if (ACTION_VERBS.has(first)) return true;

  // "leads"/"leading" → "lead"; "designs"/"designing" → "design" → "designed".
  const stem = first.replace(/(ing|es|s)$/, "");
  return (
    ACTION_VERBS.has(stem) ||
    ACTION_VERBS.has(`${stem}ed`) ||
    ACTION_VERBS.has(`${stem}d`) ||
    // Irregulars whose stem doesn't reach a listed form.
    ["lead", "build", "run", "write", "grow", "drive", "win", "teach", "oversee"].includes(stem)
  );
}

function weakOpener(text: string): string | null {
  const lower = text.toLowerCase();
  return WEAK_OPENERS.find((phrase) => lower.startsWith(phrase) || lower.includes(` ${phrase}`)) ?? null;
}

/**
 * Classifies a free-text date so a document's dates can be checked for
 * consistency. Only the *shape* matters — an ATS parses "Jun 2021" and "06/2021"
 * differently, and a resume that uses both makes at least one of them wrong.
 */
export function dateFormat(value: string): string | null {
  const text = toPlainText(value).trim();
  if (!text) return null;
  if (/^(present|current|ongoing|now)$/i.test(text)) return null;
  if (/^\d{4}$/.test(text)) return "year";
  if (/^[a-z]{3,9}\.?\s+\d{4}$/i.test(text)) return "month-name";
  if (/^\d{1,2}[/-]\d{4}$/.test(text)) return "numeric";
  if (/^\d{4}[/-]\d{1,2}$/.test(text)) return "iso-ish";
  if (/^[a-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}$/i.test(text)) return "long";
  return "other";
}

let issueCounter = 0;

function issue(
  severity: AtsSeverity,
  category: AtsCategory,
  message: string,
  fix: string,
  sectionRef: string | null,
): AtsIssue {
  issueCounter += 1;
  return { id: `rule-${issueCounter}`, severity, category, message, fix, sectionRef };
}

// --- The checks ---

function checkContact(content: ResumeContent, add: (issue: AtsIssue) => void): { hasEmail: boolean; hasPhone: boolean } {
  const { personalInfo } = content;
  const email = toPlainText(personalInfo.email);
  const phone = toPlainText(personalInfo.phone);
  const name = toPlainText(personalInfo.name);

  if (!name) {
    add(issue("critical", "completeness", "Your resume has no name in the header.",
      "Add your full name — a parser uses it as the record's primary field.", null));
  }

  const hasEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
  if (!email) {
    add(issue("critical", "completeness", "There's no email address in the header.",
      "Add a professional email address. Most applicant systems reject a record they can't reply to.", null));
  } else if (!hasEmail) {
    add(issue("critical", "formatting", `"${email}" isn't a parseable email address.`,
      "Write it plainly as name@domain.com — no spaces, and no “at” spelled out.", null));
  }

  // Loose on purpose: international formats vary, so this only asks for enough
  // digits to be a phone number at all.
  const hasPhone = (phone.match(/\d/g)?.length ?? 0) >= 7;
  if (!phone) {
    add(issue("warning", "completeness", "There's no phone number in the header.",
      "Add one. Recruiters call, and its absence reads as an incomplete application.", null));
  } else if (!hasPhone) {
    add(issue("warning", "formatting", `"${phone}" doesn't look like a complete phone number.`,
      "Include the full number with area or country code, digits only apart from separators.", null));
  }

  if (!toPlainText(personalInfo.location)) {
    add(issue("suggestion", "completeness", "No location in the header.",
      "Add at least a city and region — many filters screen on it before a human reads anything.", null));
  }

  if (!toPlainText(personalInfo.title)) {
    add(issue("suggestion", "keywords", "No professional title under your name.",
      "Add the title you're applying for. It's the first keyword a scanner reads.", null));
  }

  return { hasEmail, hasPhone };
}

function checkSections(content: ResumeContent, add: (issue: AtsIssue) => void): string[] {
  const visible = content.sections.filter((section) => section.visible);
  const types = visible.map((section) => section.type);

  if (visible.length === 0) {
    add(issue("critical", "completeness", "This resume has no visible sections.",
      "Add an experience section first, then education and skills.", null));
    return types;
  }

  if (!types.includes("experience")) {
    add(issue("critical", "completeness", "There's no experience section.",
      "Add one, even for internships or freelance work. Its absence is the single biggest scoring gap.", null));
  }
  if (!types.includes("education")) {
    add(issue("warning", "completeness", "There's no education section.",
      "Add one with your highest qualification. Many parsers expect the field and score its absence.", null));
  }
  if (!types.includes("skills")) {
    add(issue("critical", "keywords", "There's no skills section.",
      "Add one listing your tools and technologies. It's where keyword matching does most of its work.", null));
  }
  if (!types.includes("summary")) {
    add(issue("suggestion", "completeness", "There's no summary at the top.",
      "Add two or three lines naming your role, years of experience and strongest skills.", null));
  }

  // Non-standard headings: rendered fine, filed under nothing.
  for (const section of visible) {
    const title = toPlainText(section.title).toLowerCase();
    if (!title) {
      add(issue("warning", "formatting", "One section has no heading.",
        "Give it a standard heading so a parser knows what it's reading.", section.id));
      continue;
    }

    const expected = STANDARD_HEADINGS[section.type] ?? [];
    if (section.type !== "custom" && expected.length && !expected.some((word) => title.includes(word))) {
      add(issue("warning", "formatting", `“${toPlainText(section.title)}” isn't a heading an ATS recognizes.`,
        `Rename it to something standard like “${expected[0]!.replace(/\b\w/g, (c) => c.toUpperCase())}”. Creative headings often file under nothing.`,
        section.id));
    }

    if (section.items.length === 0) {
      add(issue("warning", "completeness", `“${toPlainText(section.title) || section.type}” is empty.`,
        "Fill it in or hide it — an empty heading looks like an unfinished document.", section.id));
    }
  }

  return types;
}

function checkDates(content: ResumeContent, add: (issue: AtsIssue) => void): void {
  const formats = new Map<string, { count: number; sectionId: string; sample: string }>();

  for (const section of content.sections) {
    if (!section.visible) continue;

    for (const item of section.items) {
      const values: string[] = [];
      if ("startDate" in item) values.push(item.startDate, item.endDate);
      if ("date" in item) values.push(item.date);
      if ("dateRange" in item) values.push(item.dateRange);

      for (const value of values) {
        const format = dateFormat(value);
        if (!format) continue;
        const existing = formats.get(format);
        if (existing) existing.count += 1;
        else formats.set(format, { count: 1, sectionId: section.id, sample: toPlainText(value) });
      }
    }

    // Undated experience is a real parsing gap, not a style preference.
    if (section.type === "experience" || section.type === "education") {
      for (const item of section.items) {
        if (!toPlainText(item.startDate) && !toPlainText(item.endDate)) {
          const what =
            "role" in item
              ? toPlainText(item.role) || toPlainText(item.org) || "An entry"
              : toPlainText(item.degree) || toPlainText(item.institution) || "An entry";
          add(issue("warning", "formatting", `“${what}” has no dates.`,
            "Add a start and end date. Parsers compute total years of experience from these, and a missing range counts as zero.",
            section.id));
        }
      }
    }
  }

  if (formats.size > 1) {
    const used = [...formats.entries()].sort((a, b) => b[1].count - a[1].count);
    const [dominant, ...rest] = used;
    add(issue("warning", "formatting",
      `Your dates use ${formats.size} different formats — for example “${dominant![1].sample}” and “${rest[0]![1].sample}”.`,
      `Pick one and use it everywhere. “${dominant![1].sample}” is already the most common here.`,
      rest[0]![1].sectionId));
  }
}

function checkBullets(bullets: BulletRef[], add: (issue: AtsIssue) => void): number {
  let quantified = 0;
  const noVerb: BulletRef[] = [];
  const tooLong: BulletRef[] = [];
  const tooShort: BulletRef[] = [];
  const weak = new Map<string, BulletRef>();

  for (const bullet of bullets) {
    if (isQuantified(bullet.text)) quantified += 1;

    const phrase = weakOpener(bullet.text);
    if (phrase && !weak.has(phrase)) weak.set(phrase, bullet);
    else if (!startsWithActionVerb(bullet.text)) noVerb.push(bullet);

    const words = bullet.text.split(/\s+/).length;
    if (words > BULLET_MAX_WORDS) tooLong.push(bullet);
    else if (words < BULLET_MIN_WORDS) tooShort.push(bullet);
  }

  if (bullets.length === 0) {
    add(issue("critical", "impact", "None of your roles have bullet points.",
      "Add two to four bullets per role describing what you did and what came of it.", null));
    return 0;
  }

  const quantifiedShare = quantified / bullets.length;
  if (quantifiedShare === 0) {
    add(issue("critical", "impact", "No bullet contains a number.",
      "Quantify at least a third of them — team size, percentage improvement, revenue, users, latency. Numbers are what separate a contribution from a job description.",
      bullets[0]!.sectionId));
  } else if (quantifiedShare < 0.3) {
    add(issue("warning", "impact",
      `Only ${quantified} of ${bullets.length} bullets contain a number.`,
      "Aim for roughly a third. Pick the bullets describing your biggest wins and add the measurable result.",
      bullets.find((bullet) => !isQuantified(bullet.text))?.sectionId ?? null));
  }

  for (const [phrase, bullet] of weak) {
    add(issue("warning", "impact",
      `A bullet under ${bullet.where} opens with “${phrase}”.`,
      `Cut the phrase and start with the verb: “${phrase} building X” becomes “Built X”. It describes the same work as something you did.`,
      bullet.sectionId));
  }

  if (noVerb.length > 0) {
    const share = Math.round((noVerb.length / bullets.length) * 100);
    add(issue(share > 40 ? "warning" : "suggestion", "impact",
      `${noVerb.length} of ${bullets.length} bullets don't start with an action verb.`,
      `Rewrite them to open with one — the first bullet under ${noVerb[0]!.where} is a good place to start.`,
      noVerb[0]!.sectionId));
  }

  if (tooLong.length > 0) {
    add(issue("suggestion", "formatting",
      `${tooLong.length} bullet${tooLong.length === 1 ? " runs" : "s run"} past ${BULLET_MAX_WORDS} words.`,
      `Trim to one or two lines. The long one under ${tooLong[0]!.where} probably holds two separate accomplishments.`,
      tooLong[0]!.sectionId));
  }

  if (tooShort.length > 2) {
    add(issue("suggestion", "impact",
      `${tooShort.length} bullets are shorter than ${BULLET_MIN_WORDS} words.`,
      `Expand them to say what changed as a result — the ones under ${tooShort[0]!.where} read as labels rather than accomplishments.`,
      tooShort[0]!.sectionId));
  }

  return quantified;
}

function checkKeywords(content: ResumeContent, add: (issue: AtsIssue) => void): string[] {
  const text = resumeText(content);
  const found = [...SKILL_TERMS].filter((term) => {
    // Word-boundary match, but terms contain regex metacharacters (c++, .net,
    // ci/cd), so the boundary is checked around an escaped literal.
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9+#.])${escaped}([^a-z0-9+#.]|$)`, "i").test(text);
  });

  const skillsSection = content.sections.find((section) => section.visible && section.type === "skills");

  if (found.length === 0) {
    add(issue("critical", "keywords", "No recognizable tools, technologies or named skills appear anywhere.",
      "List the specific software, languages and methods you use by name. Scanners match literal terms, not descriptions of them.",
      skillsSection?.id ?? null));
  } else if (found.length < 6) {
    add(issue("warning", "keywords",
      `Only ${found.length} recognizable skill term${found.length === 1 ? "" : "s"} appear${found.length === 1 ? "s" : ""} in the whole resume.`,
      "Name more of the specific tools you've used, in the skills section and inside your bullets.",
      skillsSection?.id ?? null));
  }

  if (skillsSection && skillsSection.type === "skills") {
    const uncategorized = skillsSection.items.some((item) => !toPlainText(item.category));
    const total = skillsSection.items.reduce((sum, item) => sum + item.skills.length, 0);

    if (total > 0 && total < 6) {
      add(issue("warning", "keywords", `Your skills section lists only ${total} item${total === 1 ? "" : "s"}.`,
        "Expand it to 10–20, grouped by category. This is the cheapest keyword coverage on the page.",
        skillsSection.id));
    }
    if (uncategorized && skillsSection.items.length > 1) {
      add(issue("suggestion", "formatting", "Some skill groups have no category label.",
        "Label them — “Languages”, “Frameworks”, “Tools”. Grouped skills survive parsing more reliably than one long line.",
        skillsSection.id));
    }
  }

  return found;
}

function checkLayout(
  content: ResumeContent,
  theme: Theme,
  templateSlug: string,
  add: (issue: AtsIssue) => void,
): boolean {
  const multiColumn = MULTI_COLUMN_LAYOUTS.has(theme.layout);

  if (multiColumn) {
    // Said plainly rather than hedged: the honesty is the point, and the user
    // may well decide the design is worth the risk.
    add(issue("warning", "formatting",
      `This template uses a ${theme.layout.replace("-", " ")} layout, which some older applicant systems read straight across, interleaving the two columns.`,
      "Most modern parsers handle it. If you're applying somewhere that likely runs older software, switch to a single-column template — your content carries over unchanged.",
      null));
  }

  if (theme.fontSizeScale < 0.9) {
    add(issue("suggestion", "formatting", `Text is scaled to ${Math.round(theme.fontSizeScale * 100)}%, below comfortable reading size.`,
      "Raise it to at least 90% and cut a weaker bullet instead. Shrinking type to fit is the most common way a resume becomes unreadable.", null));
  }

  if (theme.marginSize < 10) {
    add(issue("suggestion", "formatting", `Page margins are ${theme.marginSize}mm, tighter than most printers handle.`,
      "Use at least 10mm. Anything narrower risks clipping when a recruiter prints it.", null));
  }

  const words = wordCount(content);
  if (words > LONG_RESUME_WORDS) {
    add(issue("warning", "formatting", `The resume runs to roughly ${words} words, which is long for a two-page document.`,
      "Cut the oldest roles down to one or two bullets each. Recruiters spend well under a minute on a first pass.", null));
  } else if (words > 0 && words < SHORT_RESUME_WORDS) {
    add(issue("warning", "completeness", `There are only about ${words} words of content here.`,
      "Add detail to your roles. A resume this short reads as unfinished regardless of what's in it.", null));
  }

  // Honest about what this can't see: the checks above read the model, not the
  // rendered PDF, so an image-only resume isn't representable here at all.
  if (templateSlug.startsWith("deedy") && !multiColumn) {
    add(issue("suggestion", "formatting", "This template is designed around a sidebar, but the theme is set to a single column.",
      "Either switch the layout back or pick a template built for one column, so the spacing matches the design.", null));
  }

  return multiColumn;
}

// --- Scoring ---

function scoreFor(issues: AtsIssue[], category: AtsCategory): number {
  const penalty = issues
    .filter((entry) => entry.category === category)
    .reduce((total, entry) => total + PENALTIES[entry.severity], 0);
  return Math.max(0, 100 - penalty);
}

/**
 * Weights across categories.
 *
 * Keywords and impact are weighted above formatting because a well-formatted
 * resume that says nothing measurable still loses to a plain one that does.
 */
const CATEGORY_WEIGHTS: Record<AtsCategory, number> = {
  keywords: 0.3,
  impact: 0.3,
  formatting: 0.2,
  completeness: 0.2,
};

export function scoreDocument(
  content: ResumeContent,
  theme: Theme,
  templateSlug: string,
): RuleCheckResult {
  issueCounter = 0;

  const issues: AtsIssue[] = [];
  const add = (entry: AtsIssue) => issues.push(entry);

  const { hasEmail, hasPhone } = checkContact(content, add);
  const sectionTypes = checkSections(content, add);
  checkDates(content, add);
  const bullets = resumeBullets(content);
  const quantified = checkBullets(bullets, add);
  const skillTermsFound = checkKeywords(content, add);
  const multiColumn = checkLayout(content, theme, templateSlug, add);

  const categoryScores: AtsCategoryScores = {
    keywords: scoreFor(issues, "keywords"),
    formatting: scoreFor(issues, "formatting"),
    impact: scoreFor(issues, "impact"),
    completeness: scoreFor(issues, "completeness"),
  };

  const overallScore = Math.round(
    (Object.keys(CATEGORY_WEIGHTS) as AtsCategory[]).reduce(
      (total, category) => total + categoryScores[category] * CATEGORY_WEIGHTS[category],
      0,
    ),
  );

  return {
    issues: sortIssues(issues),
    categoryScores,
    overallScore,
    facts: {
      wordCount: wordCount(content),
      bulletCount: bullets.length,
      quantifiedBulletCount: quantified,
      sectionTypes,
      skillTermsFound,
      hasEmail,
      hasPhone,
      multiColumn,
    },
  };
}

/** Severity first, then a stable order so two runs of the same resume agree. */
export function sortIssues(issues: AtsIssue[]): AtsIssue[] {
  return [...issues].sort((a, b) => {
    const bySeverity = ATS_SEVERITY_RANK[a.severity] - ATS_SEVERITY_RANK[b.severity];
    return bySeverity !== 0 ? bySeverity : a.id.localeCompare(b.id);
  });
}

/** A compact plain-text rendering of the resume, for prompting. */
export function resumeOutline(content: ResumeContent): string {
  return resumeChunks(content)
    .map((chunk) => `${chunk.where}: ${chunk.text}`)
    .join("\n");
}
