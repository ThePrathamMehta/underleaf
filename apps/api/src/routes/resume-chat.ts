import { Router } from "express";
import { prisma } from "@repo/db";
import { sendChatBodySchema } from "@repo/types";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { asyncHandler, validateBody } from "../middleware/errors.js";
import { serializeMessage, streamChatTurn } from "../services/chat-stream.js";
import { findOwnedResume } from "./resumes.js";

/**
 * The chat assistant's endpoints.
 *
 * Mounted under `/resumes` beside `resumesRouter` rather than inside it, so the
 * streaming response's lifecycle stays out of the CRUD file where every other
 * handler ends in a single `res.json`.
 *
 * The turn itself lives in `services/chat-stream.ts`, because the JD panel's
 * "Apply with AI" runs the same one.
 */

export const resumeChatRouter = Router();

resumeChatRouter.use(requireAuth);

resumeChatRouter.get(
  "/:id/chat",
  asyncHandler<AuthedRequest>(async (req, res) => {
    // Ownership first: the transcript is as private as the resume it belongs to.
    await findOwnedResume(req.params.id!, req.userId);

    const session = await prisma.chatSession.findUnique({
      where: { resumeId: req.params.id! },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });

    res.json({ messages: (session?.messages ?? []).map(serializeMessage) });
  }),
);

resumeChatRouter.delete(
  "/:id/chat",
  asyncHandler<AuthedRequest>(async (req, res) => {
    await findOwnedResume(req.params.id!, req.userId);
    // Cascades to the messages. The resume is untouched — clearing the
    // conversation is not undoing the edits it made.
    await prisma.chatSession.deleteMany({ where: { resumeId: req.params.id! } });
    res.status(204).end();
  }),
);

resumeChatRouter.post(
  "/:id/chat",
  validateBody(sendChatBodySchema),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { message } = req.body as { message: string };

    // Everything that can fail with a status code happens before a single byte of
    // the stream is written. Once the headers are out, a 404 is no longer
    // expressible and the client would be left parsing HTML as SSE.
    const resume = await findOwnedResume(req.params.id!, req.userId);

    await streamChatTurn({ res, resume, userId: req.userId, message });
  }),
);
