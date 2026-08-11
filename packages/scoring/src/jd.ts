import type { JdKeyword, JdSuggestion, ResumeContent } from "@repo/types";
import { isMeaningful, resumeChunks, tokenize, toPlainText, type TextChunk } from "./text";
import { REQUIREMENT_CUES, SKILL_TERMS } from "./vocabulary";

/**
 * Job-description parsing and the resume diff.
 *
 * This lives beside the ATS rules rather than in the JD route because the two
 * features ask the same question in different directions — "does this resume
 * name real skills" and "does it name *these* skills" — and one extraction
 * routine answering both is what keeps their verdicts from contradicting each
 * other in front of the user.
 *
 * Deterministic, like `rules.ts`: the keyword diff is arithmetic over word
 * frequencies, so JD match still produces a real answer with the provider down.
 * The AI half writes the suggestions, which is the part a word count can't do.
 */

/** Multi-word terms worth catching as a unit; a bigram scan would miss the shape. */
const PHRASES = [
  "machine learning", "deep learning", "natural language processing", "computer vision",
  "data engineering", "data science", "data analysis", "business intelligence",
  "project management", "product management", "program management", "stakeholder management",
  "quality assurance", "continuous integration", "continuous delivery", "continuous deployment",
  "test driven development", "object oriented", "distributed systems", "system design",
  "microservices architecture", "event driven", "infrastructure as code", "site reliability",
  "incident response", "on call", "code review", "pair programming", "technical writing",
  "cross functional", "user research", "design systems", "financial modeling", "risk management",
  "supply chain", "customer success", "account management", "public speaking", "grant writing",
  "clinical research", "patient care", "regulatory compliance", "contract negotiation",
];

/** How much more a term counts for appearing in a requirements line. */
const REQUIREMENT_LIFT = 2;

/** Terms scoring below this are noise; including them makes the missing column useless. */
const MIN_WEIGHT = 1;

/** The biggest lists a panel can present without becoming a wall of chips. */
const MAX_MATCHED = 40;
const MAX_MISSING = 25;

type Candidate = { term: string; weight: number };

/** Splits a posting into lines, keeping bullet and sentence boundaries. */
function lines(text: string): string[] {
  return text
    .split(/[\n\r]+|(?<=[.;])\s+/)
    .map((line) => line.replace(/^[\s•\-*·–—o]+/, "").trim())
    .filter(Boolean);
}

function isRequirementLine(line: string): boolean {
  const lower = line.toLowerCase();
  return REQUIREMENT_CUES.some((cue) => lower.includes(cue));
}

/**
 * Pulls weighted keywords out of a posting.
 *
 * Two passes, deliberately. Known skill terms and phrases are trusted outright
 * because a posting that says "Kubernetes" once means it. Everything else has to
 * earn its place by repetition — which is what keeps the company's own name and
 * the benefits paragraph out of the results without a hand-maintained blocklist.
 */
export function extractJdKeywords(jobDescription: string): Candidate[] {
  const rawLines = lines(jobDescription);
  const weights = new Map<string, number>();

  const bump = (term: string, amount: number) => {
    weights.set(term, (weights.get(term) ?? 0) + amount);
  };

  for (const line of rawLines) {
    const lower = line.toLowerCase();
    const lift = isRequirementLine(line) ? REQUIREMENT_LIFT : 1;

    for (const phrase of PHRASES) {
      if (lower.includes(phrase)) bump(phrase, 1.5 * lift);
    }

    for (const token of tokenize(line)) {
      if (!isMeaningful(token)) continue;
      // A known tool counts fully on sight; an ordinary word accrues slowly and
      // needs to recur before it clears MIN_WEIGHT.
      bump(token, SKILL_TERMS.has(token) ? 1.2 * lift : 0.34 * lift);
    }
  }

  return [...weights.entries()]
    .filter(([term, weight]) => weight >= MIN_WEIGHT && term.length > 1 && !/^\d+$/.test(term))
    .map(([term, weight]) => ({ term, weight: Math.round(weight * 10) / 10 }))
    .sort((a, b) => b.weight - a.weight || a.term.localeCompare(b.term));
}

/** Where a term appears in the resume, or null. Word-boundary, metacharacter-safe. */
function findEvidence(term: string, chunks: TextChunk[]): TextChunk | null {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[^a-z0-9+#.])${escaped}([^a-z0-9+#.]|$)`, "i");
  return chunks.find((chunk) => pattern.test(chunk.text)) ?? null;
}

export type JdDiff = {
  matched: JdKeyword[];
  missing: JdKeyword[];
  /**
   * Weighted coverage, 0–100: the share of the posting's *importance* the resume
   * accounts for, not the share of its words. Missing one heavily-weighted
   * requirement should cost more than missing three passing mentions.
   */
  matchScore: number;
};

export function diffAgainstResume(content: ResumeContent, jobDescription: string): JdDiff {
  const chunks = resumeChunks(content);
  const candidates = extractJdKeywords(jobDescription);

  const matched: JdKeyword[] = [];
  const missing: JdKeyword[] = [];

  for (const candidate of candidates) {
    const evidence = findEvidence(candidate.term, chunks);
    if (evidence) {
      matched.push({ term: candidate.term, weight: candidate.weight, evidence: evidence.where });
    } else {
      missing.push({ term: candidate.term, weight: candidate.weight, evidence: null });
    }
  }

  const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  const matchedWeight = matched.reduce((sum, keyword) => sum + keyword.weight, 0);
  const matchScore = totalWeight === 0 ? 0 : Math.round((matchedWeight / totalWeight) * 100);

  return {
    matched: matched.slice(0, MAX_MATCHED),
    missing: missing.slice(0, MAX_MISSING),
    matchScore,
  };
}

/**
 * Fallback suggestions, computed from the diff alone.
 *
 * Used when the provider is unreachable. They are blunter than the AI's — they
 * can only name the gap, not phrase the bullet — but they still point at a
 * specific section, which is the bar the spec sets. Returning nothing here would
 * turn a degraded feature into a broken one.
 */
export function fallbackSuggestions(content: ResumeContent, diff: JdDiff): JdSuggestion[] {
  const skillsSection = content.sections.find((section) => section.visible && section.type === "skills");
  const experienceSection = content.sections.find((section) => section.visible && section.type === "experience");
  const summarySection = content.sections.find((section) => section.visible && section.type === "summary");

  const suggestions: JdSuggestion[] = [];
  const top = diff.missing.slice(0, 6);
  if (top.length === 0) return suggestions;

  // Split by whether the term is a nameable tool: a tool belongs in the skills
  // list, a practice belongs in a bullet that shows you doing it.
  const tools = top.filter((keyword) => SKILL_TERMS.has(keyword.term));
  const practices = top.filter((keyword) => !SKILL_TERMS.has(keyword.term));

  if (tools.length > 0) {
    const names = tools.map((keyword) => keyword.term).join(", ");
    suggestions.push({
      id: "gap-skills",
      message: `The posting asks for ${names}, and ${tools.length === 1 ? "it doesn't" : "they don't"} appear anywhere in your resume.`,
      sectionRef: skillsSection?.id ?? null,
      instruction: skillsSection
        ? `Add these to the skills section, grouped sensibly with what's already there, but only the ones the rest of the resume supports: ${names}. Do not claim experience the resume shows no evidence for.`
        : `Add a skills section listing the tools this resume already shows evidence of, including any of these that apply: ${names}.`,
    });
  }

  for (const keyword of practices.slice(0, 3)) {
    const target = experienceSection ?? summarySection;
    suggestions.push({
      id: `gap-${keyword.term.replace(/\s+/g, "-")}`,
      message: `“${keyword.term}” is central to the posting and isn't mentioned in your resume.`,
      sectionRef: target?.id ?? null,
      instruction: `If the existing experience genuinely involved ${keyword.term}, rewrite the most relevant bullet under the most recent role to name it explicitly, keeping every fact and number already there. If nothing in the resume supports it, make no change and say so.`,
    });
  }

  return suggestions;
}

/** First meaningful line of a posting, for labelling a saved comparison. */
export function jdExcerpt(jobDescription: string, maxLength = 90): string {
  const first = lines(jobDescription)[0] ?? "";
  const text = toPlainText(first);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}
