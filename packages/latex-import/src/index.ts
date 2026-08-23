/**
 * Reading an existing LaTeX resume, without being a LaTeX interpreter.
 *
 * Nothing here does I/O or calls a provider. Both halves of the import live here —
 * the deterministic parser and the prompt-plus-validation the AI fallback runs on —
 * and the API contributes only the provider call itself. Keeping the split at that
 * boundary is what makes both paths testable against real `.tex` sources and real
 * model replies with no provider configured.
 */

export {
  detex,
  detexPlain,
  hasWords,
  readGroup,
  readGroups,
  stripComments,
} from "./detex";

export { parseLatexResume, type LatexParseOutcome } from "./parse";

export {
  buildLatexImportRequest,
  parseLatexReply,
  LATEX_IMPORT_SYSTEM_PROMPT,
  type LatexReplyOutcome,
} from "./ai";
