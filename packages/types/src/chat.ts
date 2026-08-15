import { z } from "zod";
import { resumeContentSchema } from "./content";
import { themeSchema } from "./theme";
import { aiToolNameSchema } from "./ai-tools";
import { aiUsageSchema } from "./billing";

/**
 * Wire types for the chat assistant.
 *
 * The interesting decision here is what the client sends: just a message. The
 * server reads the resume from the database, so the document the model reasons
 * about is the saved one. The editor flushes its autosave before sending, which
 * makes "the saved one" and "the one on screen" the same thing without shipping
 * the whole document up on every turn.
 */

// --- Stored messages ---

export const CHAT_ROLES = ["user", "assistant", "system"] as const;
export const chatRoleSchema = z.enum(CHAT_ROLES);
export type ChatRole = z.infer<typeof chatRoleSchema>;

/**
 * What one tool call did, as the user sees it.
 *
 * A summary and an outcome, never the arguments. The arguments are the resume's
 * new contents; the resume already holds those, and a second copy in the
 * transcript would disagree with it the moment someone hits undo.
 */
export const chatToolOutcomeSchema = z.object({
  name: aiToolNameSchema,
  /** One line, past tense, naming what changed. */
  summary: z.string(),
  ok: z.boolean(),
  /** Why it was rejected, when `ok` is false. */
  error: z.string().nullable().optional(),
  /** The section the change landed in, so the UI can scroll the canvas to it. */
  sectionRef: z.string().nullable().optional(),
});

export type ChatToolOutcome = z.infer<typeof chatToolOutcomeSchema>;

export const chatMessageSchema = z.object({
  id: z.string(),
  role: chatRoleSchema,
  content: z.string(),
  toolCalls: z.array(chatToolOutcomeSchema).nullable(),
  createdAt: z.string(),
});

export type ChatMessageDto = z.infer<typeof chatMessageSchema>;

export const chatHistoryResponseSchema = z.object({
  messages: z.array(chatMessageSchema),
});

export type ChatHistoryResponse = z.infer<typeof chatHistoryResponseSchema>;

// --- Request ---

export const sendChatBodySchema = z.object({
  message: z.string().min(1).max(4000),
});

export type SendChatBody = z.infer<typeof sendChatBodySchema>;

// --- Stream events ---

/**
 * The normalized SSE payloads, one `data:` line each.
 *
 * `document` carries the whole content/theme rather than a patch. A patch would
 * be smaller, but the client would have to apply it to a document that may have
 * drifted, and a mis-applied patch corrupts the resume silently. Sending the
 * full computed document makes the client's job an assignment, which cannot
 * half-succeed.
 */
export const chatStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), delta: z.string() }),
  z.object({ type: z.literal("tool"), outcome: chatToolOutcomeSchema }),
  z.object({
    type: z.literal("document"),
    content: resumeContentSchema,
    theme: themeSchema,
  }),
  z.object({
    type: z.literal("done"),
    messageId: z.string(),
    /** Absent when the turn only talked and changed nothing. */
    summary: z.string().nullable(),
    /**
     * The allowance after this turn was charged for (v5 Section 6).
     *
     * Rides along on the event that already ends the stream rather than costing
     * the panel a second request: the counter above the chat box would otherwise
     * be one turn stale exactly when the user is watching it approach zero.
     */
    usage: aiUsageSchema.optional(),
  }),
  z.object({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
  }),
]);

export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>;
