import { complete } from "@repo/ai";
import { AiError, toAiError } from "@repo/ai/errors";
import {
  buildLatexImportRequest,
  parseLatexResume,
  parseLatexReply,
  LATEX_IMPORT_SYSTEM_PROMPT,
} from "@repo/latex-import";
import type { LatexImportResult, PlanKey, ResumeContent } from "@repo/types";

/**
 * Reading a pasted LaTeX resume, hybrid: pattern-matching first, a model second.
 *
 * The deterministic parser in `@repo/latex-import` handles Jake's Resume and its
 * forks outright, which is most of what gets pasted, and does it with no provider
 * call and no latency. Anything it doesn't recognise — a two-column template with
 * its own layout commands — goes to the model, which is asked for the same JSON
 * the parser would have produced and held to the same schema.
 *
 * This file is deliberately thin: the prompt and the validation live in the
 * package, where they are under test. What's left here is the one thing that can't
 * be — the provider call — plus the decision about what to tell the user when it
 * doesn't work out.
 *
 * Neither half is allowed to fail silently. Whatever comes back is returned with
 * a confidence and a list of what was skipped, and the editor shows both. A user
 * looking at their imported resume should never have to wonder whether a section
 * is missing because they never had it or because the importer dropped it.
 */

async function runAiImport(
  latexSource: string,
  userId: string,
  planKey: PlanKey | null | undefined,
): Promise<{ content: ResumeContent; warnings: string[] }> {
  const completion = await complete(
    { purpose: "latexImport", userId, planKey },
    {
      system: LATEX_IMPORT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildLatexImportRequest(latexSource) }],
    },
  );

  const outcome = parseLatexReply(completion.text);
  // `invalid_response` rather than a bare throw, so the caller's fallback treats
  // an unusable reply exactly as it treats an unreachable provider.
  if (!outcome.ok) throw new AiError("invalid_response", outcome.reason);

  return { content: outcome.content, warnings: outcome.warnings };
}

/**
 * Imports a pasted `.tex` source. Resolves with content in every case — an
 * unreadable source comes back as an empty document with warnings explaining
 * itself, because there is nothing useful the caller could do with a rejection
 * that the editor can't do better with a banner.
 */
export async function importLatexResume(options: {
  latexSource: string;
  userId: string;
  /** The caller's tier, which decides which model reads the source. */
  planKey?: PlanKey | null;
}): Promise<LatexImportResult> {
  const deterministic = parseLatexResume(options.latexSource);

  // Recognised outright: exact, instant, and no reason to ask a model to
  // re-read a document that has already been read correctly.
  if (deterministic.confident) {
    return {
      content: deterministic.content,
      confidence: "deterministic",
      warnings: deterministic.warnings,
    };
  }

  try {
    const assisted = await runAiImport(options.latexSource, options.userId, options.planKey);
    return {
      content: assisted.content,
      confidence: "ai-assisted",
      warnings: assisted.warnings.slice(0, 12),
    };
  } catch (error) {
    /**
     * The model was unavailable or unusable, so what the pattern-matcher *did*
     * find is the answer — labelled `deterministic`, because that is what it is.
     * Calling a fallback "ai-assisted" would misrepresent the one thing the
     * confidence flag exists to tell the user: whether anything in front of them
     * could have been invented.
     */
    const reason = toAiError(error).message;
    return {
      content: deterministic.content,
      confidence: "deterministic",
      warnings: [
        ...deterministic.warnings,
        `Only part of the source could be read automatically (${reason.slice(0, 140)}). Check everything below.`,
      ].slice(0, 12),
    };
  }
}
