/**
 * Deterministic resume analysis: the free, fast, offline half of Features 2 and 3.
 *
 * Nothing here calls a provider or touches I/O. That's a design constraint, not
 * an accident — the spec asks for hybrid scoring, and a hybrid is only honest if
 * the rule-based half still returns a real answer when the AI half can't run.
 */

export {
  toPlainText,
  tokenize,
  isMeaningful,
  resumeChunks,
  resumeText,
  resumeBullets,
  wordCount,
  STOP_WORDS,
  type TextChunk,
  type BulletRef,
} from "./text";

export {
  scoreDocument,
  sortIssues,
  resumeOutline,
  isQuantified,
  startsWithActionVerb,
  dateFormat,
  type RuleCheckResult,
  type ResumeFacts,
} from "./rules";

export {
  extractJdKeywords,
  diffAgainstResume,
  fallbackSuggestions,
  jdExcerpt,
  type JdDiff,
} from "./jd";

export { ACTION_VERBS, WEAK_OPENERS, SKILL_TERMS, STANDARD_HEADINGS, REQUIREMENT_CUES } from "./vocabulary";
