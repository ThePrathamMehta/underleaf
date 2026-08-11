import { complete } from "@repo/ai";
import { AiError, toAiError } from "@repo/ai/errors";
import {
  resumeOutline,
  scoreDocument,
  sortIssues,
  type ResumeFacts,
} from "@repo/scoring";
import {
  ATS_CATEGORIES,
  ATS_SEVERITIES,
  atsCategorySchema,
  atsSeveritySchema,
  type AtsCategoryScores,
  type AtsIssue,
  type ResumeContent,
  type Theme,
} from "@repo/types";
import { z } from "zod";

/**
 * ATS scoring: deterministic rules, then an AI pass that adds what rules can't see.
 *
 * The split is the design. Rules answer questions with a right answer — is the
 * email parseable, do the dates agree, does a bullet contain a number. The model
 * answers the one question a word list can't: whether a bullet that *has* a
 * number is actually describing an outcome, or is a duty with a figure stapled
 * to it. Asking the model to re-derive the mechanical checks would cost money to
 * get a less reliable version of an answer we already have, so the prompt is told
 * what the rules already found and asked not to repeat it.
 *
 * If the provider is unreachable the rule score is returned as-is with
 * `aiAssisted: false`. A partial answer that says it's partial beats an error
 * page, and the panel shows the difference rather than quietly presenting a
 * lower number as if it were the same measurement.
 */

/** Cap on AI issues, so the list stays a prioritized set rather than a dump. */
const MAX_AI_ISSUES = 6;

/**
 * The AI half's own view of the two judgement categories.
 *
 * Only `impact` and `keywords` — formatting and completeness are mechanical, and
 * a model second-guessing "is there an education section" adds variance to a
 * question with a definite answer.
 */
const aiAssessmentSchema = z.object({
  impactScore: z
    .number()
    .min(0)
    .max(100)
    .describe("0-100. How well bullets describe outcomes rather than duties."),
  keywordScore: z
    .number()
    .min(0)
    .max(100)
    .describe("0-100. How well the resume names concrete, role-relevant skills and tools."),
  issues: z
    .array(
      z.object({
        severity: atsSeveritySchema,
        category: atsCategorySchema,
        message: z.string().min(1).max(300).describe("What is wrong, naming the specific text."),
        fix: z.string().min(1).max(400).describe("What to change, concretely."),
        sectionId: z
          .string()
          .nullable()
          .describe("The exact section id this concerns, copied from the outline, or null."),
      }),
    )
    .max(12),
});

type AiAssessment = z.infer<typeof aiAssessmentSchema>;

const SYSTEM_PROMPT = [
  "You are an experienced technical recruiter reviewing a resume for both applicant tracking systems and the human who reads it after.",
  "",
  "You are given a resume, and a list of problems that automated checks have ALREADY found.",
  "Your job is the part those checks cannot do: judging whether the writing describes real outcomes, and whether the skills named are specific enough to match a posting.",
  "",
  "Rules:",
  "1. Do not repeat any issue the automated checks already reported. They are listed for you precisely so you can skip them.",
  "2. Do not report mechanical problems — missing sections, date formats, contact fields, bullet counts. Those are already covered.",
  "3. Quote or paraphrase the specific text you are judging. An issue that could apply to any resume is worthless.",
  "4. `sectionId` must be copied exactly from a `[section: ...]` marker in the outline, or be null. Never invent one.",
  "5. Never invent facts about the candidate, and never suggest they claim experience the resume shows no evidence of.",
  "6. Score honestly. A resume of vague duty statements is a 30, not a 65. A resume of quantified, specific accomplishments is a 90.",
  "7. Return at most 6 issues, the most consequential first.",
  "",
  "Respond with JSON only, matching the schema you are given. No prose outside the JSON.",
].join("\n");

/** Renders the outline with section-id markers, so `sectionId` can be copied not guessed. */
function outlineWithIds(content: ResumeContent): string {
  const header = resumeOutline(content);
  const markers = content.sections
    .filter((section) => section.visible)
    .sort((a, b) => a.order - b.order)
    .map((section) => `[section: ${section.id}] ${section.title || section.type}`)
    .join("\n");

  return `Section ids:\n${markers}\n\nContent:\n${header}`;
}

function factsPrompt(facts: ResumeFacts, issues: AtsIssue[]): string {
  return [
    "Automated checks already found these — do not repeat them:",
    issues.length ? issues.map((issue) => `- ${issue.message}`).join("\n") : "- (nothing)",
    "",
    "Measured facts:",
    `- ${facts.bulletCount} bullets, ${facts.quantifiedBulletCount} of which contain a number`,
    `- ${facts.wordCount} words total`,
    `- sections present: ${facts.sectionTypes.join(", ") || "none"}`,
    `- recognized skill terms found: ${facts.skillTermsFound.slice(0, 30).join(", ") || "none"}`,
  ].join("\n");
}

/**
 * Extracts the JSON object from a completion.
 *
 * Models occasionally wrap JSON in a fenced block despite instructions. Handling
 * that here is cheaper than a retry and doesn't change what is validated — the
 * result still has to satisfy the schema.
 */
function parseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new AiError("invalid_response", "The model's reply did not contain a JSON object.");
  }

  return JSON.parse(candidate.slice(start, end + 1));
}

async function runAiAssessment(
  content: ResumeContent,
  facts: ResumeFacts,
  ruleIssues: AtsIssue[],
  userId: string,
): Promise<AiAssessment> {
  const completion = await complete(
    { purpose: "ats", userId },
    {
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            outlineWithIds(content),
            "",
            factsPrompt(facts, ruleIssues),
            "",
            "Return JSON of exactly this shape:",
            '{"impactScore": number, "keywordScore": number, "issues": [{"severity": "critical"|"warning"|"suggestion", "category": "keywords"|"formatting"|"impact"|"completeness", "message": string, "fix": string, "sectionId": string|null}]}',
          ].join("\n"),
        },
      ],
    },
  );

  let raw: unknown;
  try {
    raw = parseJson(completion.text);
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw new AiError("invalid_response", "The model's reply was not valid JSON.");
  }

  const parsed = aiAssessmentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AiError("invalid_response", "The model's reply did not match the expected shape.");
  }

  return parsed.data;
}

export type ScoreOutcome = {
  overallScore: number;
  categoryScores: AtsCategoryScores;
  issues: AtsIssue[];
  aiAssisted: boolean;
  /** A specific, user-facing reason the AI half didn't run. Null when it did. */
  aiError: string | null;
};

/**
 * Blends the two halves.
 *
 * The rule score is the floor for the mechanical categories and the AI score is
 * averaged into the two judgement categories rather than replacing them — a
 * model that likes a resume can't wave away a missing skills section, and one
 * that dislikes it can't override the fact that the dates are consistent.
 */
export async function scoreResume(options: {
  content: ResumeContent;
  theme: Theme;
  templateSlug: string;
  userId: string;
}): Promise<ScoreOutcome> {
  const rules = scoreDocument(options.content, options.theme, options.templateSlug);

  let assessment: AiAssessment | null = null;
  let aiError: string | null = null;

  try {
    assessment = await runAiAssessment(options.content, rules.facts, rules.issues, options.userId);
  } catch (error) {
    aiError = toAiError(error).message;
  }

  if (!assessment) {
    return {
      overallScore: rules.overallScore,
      categoryScores: rules.categoryScores,
      issues: rules.issues,
      aiAssisted: false,
      aiError,
    };
  }

  // Only ids the resume actually has: a hallucinated ref would render as an
  // issue that scrolls nowhere.
  const knownIds = new Set(options.content.sections.map((section) => section.id));

  const aiIssues: AtsIssue[] = assessment.issues.slice(0, MAX_AI_ISSUES).map((issue, index) => ({
    id: `ai-${index + 1}`,
    severity: ATS_SEVERITIES.includes(issue.severity) ? issue.severity : "suggestion",
    category: ATS_CATEGORIES.includes(issue.category) ? issue.category : "impact",
    message: issue.message,
    fix: issue.fix,
    sectionRef: issue.sectionId && knownIds.has(issue.sectionId) ? issue.sectionId : null,
  }));

  const categoryScores: AtsCategoryScores = {
    // Judgement categories: the mean of both halves.
    impact: Math.round((rules.categoryScores.impact + assessment.impactScore) / 2),
    keywords: Math.round((rules.categoryScores.keywords + assessment.keywordScore) / 2),
    // Mechanical categories: the rules alone, because they are simply right.
    formatting: rules.categoryScores.formatting,
    completeness: rules.categoryScores.completeness,
  };

  const overallScore = Math.round(
    categoryScores.keywords * 0.3 +
      categoryScores.impact * 0.3 +
      categoryScores.formatting * 0.2 +
      categoryScores.completeness * 0.2,
  );

  return {
    overallScore,
    categoryScores,
    issues: sortIssues([...rules.issues, ...aiIssues]),
    aiAssisted: true,
    aiError: null,
  };
}
