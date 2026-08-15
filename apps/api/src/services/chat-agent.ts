import {
  stream,
  toolFromZod,
  type AiMessage,
  type AiStopReason,
  type AiToolCall,
  type AiToolDef,
  type AiToolResult,
} from "@repo/ai";
import {
  AI_TOOL_DESCRIPTIONS,
  AI_TOOL_NAMES,
  AI_TOOL_SCHEMAS,
  type ChatToolOutcome,
  type PlanKey,
} from "@repo/types";
import { applyToolCall, type ToolDocument } from "./resume-tools.js";

/**
 * The chat assistant's tool-calling loop.
 *
 * Lives here rather than in the route because it has two callers: the chat panel
 * streams it over SSE, and Feature 3's "Apply with AI" hands it a single
 * suggestion. Those must go through the same pipeline — the spec asks that an
 * applied JD suggestion be as undoable and as validated as anything typed into
 * the chat box, and the cheapest way to guarantee that is for there to be one
 * implementation.
 *
 * It computes but never persists. The resulting document is handed back to the
 * caller, which streams it to the browser, where it lands on the existing undo
 * stack as one step. A server-side write would leave the client's history stale
 * and make Ctrl+Z unable to revert an AI edit.
 */

/** How many assistant turns one message may take. Mirrors `callWithTools`. */
const MAX_ROUNDS = 8;

const TOOLS: AiToolDef[] = AI_TOOL_NAMES.map((name) =>
  toolFromZod(name, AI_TOOL_DESCRIPTIONS[name], AI_TOOL_SCHEMAS[name]),
);

const SYSTEM_PROMPT = `You are Underleaf's resume assistant. You work inside a live resume editor: the user's current document is given to you below, and the only way you can change it is by calling the tools you have been given. Prose you write is shown in a chat panel beside the resume — it is never added to the document.

Rules, in order of importance:

1. Never invent facts. Employers, job titles, dates, schools, degrees and above all metrics come from the resume or from what the user has told you. If a rewrite would read better with a number you do not have, write it without the number and ask for it in your reply. A resume that overstates is worse than one that understates, because the user has to defend it in an interview.

2. Use ids exactly as they appear in the document below. Never guess, shorten or invent one.

3. A section you have just created has an id you have not seen yet. Call addSection, read the id back from the tool result, then call addSectionItem. Do not try to do both in the same batch.

4. Text fields render a small inline HTML subset — <strong>, <em>, <u> and <a href="...">. Plain text is fine and usually better. Markdown is not supported and will be printed literally.

5. Dates are printed verbatim, so write them the way they should appear: "Jun 2021", "2019", "Present", "Expected 2026". Never an ISO date.

6. Change only what was asked. If the user asks about their Experience bullets, do not also reorder their sections or restyle the document.

7. Keep replies to two or three sentences. Do not list the changes back — the editor shows the user each one as it happens. Say what you did in a line and, if something is missing, ask one specific question.

Starting from a blank or near-empty resume is a normal request. Build it in order: setPersonalInfo, then a summary, then experience, then the rest. Add each section, then its entries, and stop to ask for anything you would otherwise have to make up.

If the request has nothing to do with the resume, say so in one line and make no tool calls.`;

/** The whole document, as the model sees it. */
function documentPrompt(doc: ToolDocument, templateName: string): string {
  return [
    `Template: ${templateName}.`,
    "",
    "Current resume content — the `id` values are exact, use them verbatim:",
    "```json",
    JSON.stringify(doc.content),
    "```",
    "",
    "Current theme:",
    "```json",
    JSON.stringify(doc.theme),
    "```",
  ].join("\n");
}

/** What one tool call reports back to the model. */
function toolResultContent(outcome: ChatToolOutcome): string {
  return outcome.ok
    ? JSON.stringify({
        ok: true,
        summary: outcome.summary,
        // The id of a section the model just created — without this it has no
        // way to address the section it is about to fill.
        ...(outcome.sectionRef ? { sectionId: outcome.sectionRef } : {}),
      })
    : JSON.stringify({ ok: false, error: outcome.error ?? "Rejected." });
}

export type ChatTurnUpdate =
  | { type: "text"; delta: string }
  | { type: "tool"; outcome: ChatToolOutcome }
  | { type: "document"; document: ToolDocument };

export type ChatTurnResult = {
  /** Everything the assistant said, across every round. */
  text: string;
  outcomes: ChatToolOutcome[];
  /** The document after every accepted call. Equal to the input if none were. */
  document: ToolDocument;
  changed: boolean;
  error: { code: string; message: string } | null;
};

export type ChatTurnOptions = {
  document: ToolDocument;
  templateName: string;
  /** Prior turns, oldest first. Plain text — see `resume-chat.ts` for why. */
  history: AiMessage[];
  message: string;
  userId: string;
  /** The caller's tier, which decides which model answers (v5 Section 4). */
  planKey?: PlanKey | null;
  signal?: AbortSignal;
  onUpdate: (update: ChatTurnUpdate) => void;
};

/**
 * Runs one user message to completion, calling tools as the model asks for them.
 *
 * Never throws for a provider failure: the turn may have already applied three
 * valid edits before the connection dropped, and those are real work the user
 * should keep. Failures come back on `error` alongside whatever was achieved.
 */
export async function runChatTurn(options: ChatTurnOptions): Promise<ChatTurnResult> {
  const { templateName, history, message, userId, planKey, signal, onUpdate } = options;

  const messages: AiMessage[] = [
    ...history,
    { role: "user", content: `${documentPrompt(options.document, templateName)}\n\n${message}` },
  ];

  let document = options.document;
  let text = "";
  let changed = false;
  const outcomes: ChatToolOutcome[] = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const toolCalls: AiToolCall[] = [];
    let roundText = "";
    let stopReason: AiStopReason = "other";
    let failure: { code: string; message: string } | null = null;

    for await (const event of stream(
      { purpose: "chat", userId, planKey },
      { messages, system: SYSTEM_PROMPT, tools: TOOLS, signal },
    )) {
      if (event.type === "text") {
        roundText += event.text;
        onUpdate({ type: "text", delta: event.text });
      } else if (event.type === "tool_call") {
        toolCalls.push(event.toolCall);
      } else if (event.type === "done") {
        stopReason = event.stopReason;
      } else if (event.type === "error") {
        failure = { code: event.code, message: event.message };
        break;
      }
    }

    text += roundText;

    if (failure) return { text, outcomes, document, changed, error: failure };

    if (toolCalls.length === 0) {
      // A reply cut off by the token ceiling is reported rather than passed off
      // as complete — the user can see the sentence stop mid-word, and telling
      // them why is the difference between a bug and a limit.
      const truncated =
        stopReason === "max_tokens"
          ? {
              code: "invalid_response",
              message: "The reply was cut short by the model's length limit. Ask for less at once.",
            }
          : null;
      return { text, outcomes, document, changed, error: truncated };
    }

    messages.push({ role: "assistant", content: roundText, toolCalls });

    const results: AiToolResult[] = [];
    let roundChanged = false;

    for (const call of toolCalls) {
      // Applied in order against the running document, so two calls in one round
      // compose — a rejection stops that call and nothing else.
      const application = applyToolCall(document, call.name, call.arguments);
      outcomes.push(application.outcome);
      onUpdate({ type: "tool", outcome: application.outcome });

      if (application.ok) {
        document = application.document;
        changed = true;
        roundChanged = true;
      }

      results.push({
        toolCallId: call.id,
        content: toolResultContent(application.outcome),
        isError: !application.ok,
      });
    }

    if (roundChanged) onUpdate({ type: "document", document });

    messages.push({
      role: "user",
      // The whole document again rather than a diff. The model has to address
      // ids it has never seen — a new section's, a new item's — and re-reading
      // costs tokens where guessing costs the user a rejected call and a round.
      content: roundChanged ? documentPrompt(document, templateName) : "",
      toolResults: results,
    });
  }

  return {
    text,
    outcomes,
    document,
    changed,
    error: {
      code: "invalid_response",
      message: "The assistant kept making changes without finishing. Try a smaller request.",
    },
  };
}
