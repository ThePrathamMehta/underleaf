import { complete } from "@repo/ai";
import { AiError, toAiError } from "@repo/ai/errors";
import {
  diffAgainstResume,
  fallbackSuggestions,
  resumeOutline,
  type JdDiff,
} from "@repo/scoring";
import type { JdSuggestion, PlanKey, ResumeContent } from "@repo/types";
import { z } from "zod";

/**
 * Job-description matching: a deterministic keyword diff, then AI-written
 * suggestions for closing the gaps.
 *
 * The split mirrors ATS scoring, and for the same reason. Whether "Kubernetes"
 * appears in the resume is arithmetic, and arithmetic doesn't need a provider or
 * a network. What to *do* about its absence is judgement — which of the user's
 * existing bullets could honestly name it, and which gaps they should simply
 * accept — and that is what the model is for.
 *
 * When the provider is unreachable the diff still returns, with blunter
 * suggestions computed from the gap alone. The spec's bar is that guidance be
 * resume-anchored, not that it be eloquent, and a fallback that names the section
 * still clears it.
 */

/** Enough to act on in one sitting; more reads as a backlog. */
const MAX_SUGGESTIONS = 5;

/** How many missing terms the model is asked to reason about. */
const GAP_LIMIT = 12;

const suggestionsSchema = z.object({
  suggestions: z
    .array(
      z.object({
        message: z
          .string()
          .min(1)
          .max(280)
          .describe("The gap, in one sentence, naming the specific term and where it belongs."),
        instruction: z
          .string()
          .min(1)
          .max(600)
          .describe("A direct instruction to the resume editing assistant, naming section ids."),
        sectionId: z
          .string()
          .nullable()
          .describe("The exact section id from the outline this concerns, or null."),
      }),
    )
    .max(8),
});

const SYSTEM_PROMPT = [
  "You are a technical recruiter helping a candidate tailor an existing resume to a specific job posting.",
  "",
  "You are given the resume's outline, the posting, and a computed list of terms from the posting that do not appear anywhere in the resume.",
  "For each gap worth closing, write one suggestion.",
  "",
  "Rules:",
  "1. Never suggest claiming experience the resume shows no evidence of. If a gap cannot be closed honestly, skip it — a shorter list is the correct answer.",
  "2. Anchor each suggestion to a section that exists. `sectionId` must be copied exactly from a `[section: ...]` marker, or be null.",
  "3. `message` is for the user: name the term and say where it belongs. Do not write generic advice like 'add more keywords'.",
  "4. `instruction` is for a resume-editing assistant that will carry out the change. Write it as a direct order, name the section, and state explicitly that it must keep every existing fact and number and invent nothing.",
  "5. Prefer rewriting an existing bullet to naming the same work more precisely over adding new claims.",
  "6. Return at most 5 suggestions, the most valuable first.",
  "",
  "Respond with JSON only. No prose outside the JSON.",
].join("\n");

/** The outline with copyable section-id markers, so ids are never guessed. */
function outlineWithIds(content: ResumeContent): string {
  const markers = content.sections
    .filter((section) => section.visible)
    .sort((a, b) => a.order - b.order)
    .map((section) => `[section: ${section.id}] ${section.title || section.type}`)
    .join("\n");

  return `Section ids:\n${markers}\n\nResume:\n${resumeOutline(content)}`;
}

/** Extracts the JSON object from a completion that may be fenced. */
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

async function runAiSuggestions(
  content: ResumeContent,
  jobDescription: string,
  diff: JdDiff,
  userId: string,
  planKey: PlanKey | null | undefined,
): Promise<z.infer<typeof suggestionsSchema>> {
  const gaps = diff.missing
    .slice(0, GAP_LIMIT)
    .map((keyword) => `- ${keyword.term} (weight ${keyword.weight})`)
    .join("\n");

  const completion = await complete(
    { purpose: "jdMatch", userId, planKey },
    {
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            outlineWithIds(content),
            "",
            "Job posting:",
            jobDescription.slice(0, 8000),
            "",
            `Terms from the posting missing from the resume (match score ${diff.matchScore}/100):`,
            gaps || "- (none)",
            "",
            "Return JSON of exactly this shape:",
            '{"suggestions": [{"message": string, "instruction": string, "sectionId": string|null}]}',
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

  const parsed = suggestionsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AiError("invalid_response", "The model's reply did not match the expected shape.");
  }

  return parsed.data;
}

export type CompareOutcome = {
  matchScore: number;
  matched: JdDiff["matched"];
  missing: JdDiff["missing"];
  suggestions: JdSuggestion[];
  /** A specific, user-facing reason the AI half didn't run. Null when it did. */
  aiError: string | null;
  /**
   * Whether a provider call was actually made and answered.
   *
   * Distinct from `aiError === null`, which is also true for the zero-gaps
   * short-circuit below — where no call happens at all. The metering in
   * `routes/jd.ts` needs the difference: a perfectly-matched resume should cost
   * nothing, and conflating "nothing to ask" with "asked and got an answer" would
   * charge for the one case where we spent no tokens.
   */
  aiRan: boolean;
};

export async function compareToJd(options: {
  content: ResumeContent;
  jobDescriptionText: string;
  userId: string;
  /** The caller's tier, which decides which model writes the suggestions. */
  planKey?: PlanKey | null;
}): Promise<CompareOutcome> {
  const diff = diffAgainstResume(options.content, options.jobDescriptionText);

  // Nothing missing is a real result, and asking a model to suggest closing zero
  // gaps would spend a call to be told so.
  if (diff.missing.length === 0) {
    return { ...diff, suggestions: [], aiError: null, aiRan: false };
  }

  try {
    const assessment = await runAiSuggestions(
      options.content,
      options.jobDescriptionText,
      diff,
      options.userId,
      options.planKey,
    );

    // Only ids the resume actually has: a hallucinated ref would render as a
    // suggestion whose "show me" scrolls nowhere.
    const knownIds = new Set(options.content.sections.map((section) => section.id));

    const suggestions: JdSuggestion[] = assessment.suggestions
      .slice(0, MAX_SUGGESTIONS)
      .map((suggestion, index) => ({
        id: `jd-${index + 1}`,
        message: suggestion.message,
        sectionRef:
          suggestion.sectionId && knownIds.has(suggestion.sectionId) ? suggestion.sectionId : null,
        // Kept as the model wrote it, but it never reaches a provider from the
        // browser — the client applies a suggestion by id, and the server reads
        // the instruction back out of the stored row.
        instruction: suggestion.instruction,
      }));

    return { ...diff, suggestions, aiError: null, aiRan: true };
  } catch (error) {
    return {
      ...diff,
      suggestions: fallbackSuggestions(options.content, diff),
      aiError: toAiError(error).message,
      aiRan: false,
    };
  }
}
