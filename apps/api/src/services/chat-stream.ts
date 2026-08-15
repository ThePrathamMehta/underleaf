import type { Response } from "express";
import type { AiMessage } from "@repo/ai";
import { prisma } from "@repo/db";
import {
  chatToolOutcomeSchema,
  type ChatMessageDto,
  type ChatStreamEvent,
  type ChatToolOutcome,
} from "@repo/types";
import { z } from "zod";
import { parseContent, parseTheme } from "../serializers.js";
import { runChatTurn } from "./chat-agent.js";
import { checkAndConsumeAiAction } from "./entitlements.js";

/**
 * One assistant turn, delivered over server-sent events.
 *
 * Extracted from the chat route because it has a second caller: "Apply with AI"
 * in the JD panel. The spec asks that an applied suggestion be exactly as
 * validated and exactly as undoable as something typed into the chat box, and the
 * only way to guarantee that is for both to run this function — not two
 * implementations that agree today.
 *
 * It computes and streams but never writes the resume. The browser applies the
 * `document` events through the editor's reducer, which is what puts an AI edit
 * on the same undo stack as a keystroke.
 */

/** How much of the transcript is replayed to the model. */
const HISTORY_LIMIT = 20;

const storedOutcomesSchema = z.array(chatToolOutcomeSchema);

export function parseOutcomes(value: unknown): ChatToolOutcome[] | null {
  if (value == null) return null;
  const parsed = storedOutcomesSchema.safeParse(value);
  // A row written by an older shape is shown as a plain message rather than
  // failing the whole transcript.
  return parsed.success ? parsed.data : null;
}

export function serializeMessage(message: {
  id: string;
  role: string;
  content: string;
  toolCalls: unknown;
  createdAt: Date;
}): ChatMessageDto {
  return {
    id: message.id,
    role:
      message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "user",
    content: message.content,
    toolCalls: parseOutcomes(message.toolCalls),
    createdAt: message.createdAt.toISOString(),
  };
}

/**
 * Replays the transcript as plain text.
 *
 * Prior tool calls are summarized into the assistant's own turn rather than
 * replayed as tool blocks. We never stored the arguments — the resume holds
 * those, and a second copy would disagree with it the moment someone hit undo —
 * so a faithful replay is not available. A one-line note of what changed keeps
 * the model oriented, and the current document, sent fresh every turn, is the
 * authority on what the resume actually says now.
 */
function toAiHistory(messages: ChatMessageDto[]): AiMessage[] {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => {
      const applied = (message.toolCalls ?? []).filter((outcome) => outcome.ok);
      const note = applied.length
        ? `\n\n[Applied: ${applied.map((outcome) => outcome.summary).join("; ")}]`
        : "";

      return {
        role: message.role === "assistant" ? "assistant" : "user",
        content: `${message.content}${note}`.trim() || "(no reply)",
      } satisfies AiMessage;
    });
}

/** One SSE frame. */
function send(res: Response, event: ChatStreamEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/** The turn-level line the panel shows under the reply. */
function turnSummary(outcomes: ChatToolOutcome[]): string | null {
  const applied = outcomes.filter((outcome) => outcome.ok);
  if (applied.length === 0) return null;
  if (applied.length === 1) return applied[0]!.summary;
  return `${applied[0]!.summary}, and ${applied.length - 1} more change${
    applied.length === 2 ? "" : "s"
  }`;
}

/** The fields of a resume row this needs. Structural, so either caller's row fits. */
type TurnResume = {
  id: string;
  content: unknown;
  theme: unknown;
  template: { name: string };
};

export type StreamTurnOptions = {
  res: Response;
  resume: TurnResume;
  userId: string;
  /** What the model is asked to do. */
  message: string;
  /**
   * What the transcript records as the user's turn, when that should read
   * differently from the instruction. "Apply with AI" uses this: the model gets
   * the full instruction, the conversation shows the gap in one line.
   */
  transcriptText?: string;
};

export async function streamChatTurn(options: StreamTurnOptions): Promise<void> {
  const { res, resume, userId, message } = options;

  /**
   * Metered before anything else in the turn, and deliberately before the SSE
   * headers are flushed.
   *
   * Order is the whole point: once `flushHeaders` has run the status is committed
   * to 200 and a refusal could only be delivered as an in-band `error` event,
   * which the panel would render as "the assistant broke" rather than "you're out
   * of actions". Throwing here instead reaches the route's `asyncHandler` and
   * becomes a real 402 carrying the live counter.
   *
   * Both metered chat surfaces come through this function — the chat box and
   * "Apply with AI" — so one call site covers both, and neither can drift into
   * being free.
   */
  const action = await checkAndConsumeAiAction(userId, "chat");

  const document = { content: parseContent(resume.content), theme: parseTheme(resume.theme) };

  const session = await prisma.chatSession.upsert({
    where: { resumeId: resume.id },
    create: { resumeId: resume.id, userId },
    update: {},
  });

  const previous = await prisma.chatMessage.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
  });
  const history = toAiHistory(previous.reverse().map(serializeMessage));

  await prisma.chatMessage.create({
    data: { sessionId: session.id, role: "user", content: options.transcriptText ?? message },
  });

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // Proxies that buffer would hold every token until the turn ended, which is
  // the whole thing this endpoint exists to avoid.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // A user closing the panel or navigating away cancels the provider call rather
  // than leaving it running and billable.
  const aborted = new AbortController();
  res.on("close", () => aborted.abort());

  // Past this point a thrown error can no longer become a status code, so it is
  // caught here and delivered as the same `error` event a provider failure uses —
  // one shape for the panel to handle, never a truncated stream.
  try {
    const turn = await runChatTurn({
      document,
      templateName: resume.template.name,
      history,
      message,
      userId,
      planKey: action.planKey,
      signal: aborted.signal,
      onUpdate: (update) => {
        if (res.writableEnded) return;
        if (update.type === "text") {
          send(res, { type: "text", delta: update.delta });
        } else if (update.type === "tool") {
          send(res, { type: "tool", outcome: update.outcome });
        } else {
          send(res, {
            type: "document",
            content: update.document.content,
            theme: update.document.theme,
          });
        }
      },
    });

    // Written even when the turn errored partway: the reply and the outcomes up
    // to that point are real, and a transcript that silently dropped them would
    // disagree with the resume the user is looking at.
    const assistant = await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "assistant",
        content: turn.text,
        toolCalls: turn.outcomes.length ? turn.outcomes : undefined,
      },
    });

    // Bumps the session's `updatedAt`, which is what history ordering uses.
    await prisma.chatSession.update({
      where: { id: session.id },
      data: { updatedAt: new Date() },
    });

    if (!res.writableEnded) {
      if (turn.error) {
        send(res, { type: "error", code: turn.error.code, message: turn.error.message });
      }
      send(res, {
        type: "done",
        messageId: assistant.id,
        summary: turnSummary(turn.outcomes),
        usage: action.usage,
      });
    }
  } catch (error) {
    console.error("Chat turn failed:", error);
    if (!res.writableEnded) {
      send(res, {
        type: "error",
        code: "provider",
        message: "The assistant stopped unexpectedly. Your resume was not changed.",
      });
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
}
