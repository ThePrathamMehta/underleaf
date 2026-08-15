"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { AiUsageDto, ChatToolOutcome, ResumeContent, Theme } from "@repo/types";
import { api, ApiError } from "../../lib/api";
import { useUsage } from "../../lib/usage";
import { AllowanceMeter, AllowanceWall } from "../allowance";
import { FieldLabel, IconButton } from "./controls";

/**
 * The assistant panel.
 *
 * It owns the conversation and nothing else. Document changes arrive as whole
 * `content`/`theme` payloads and are handed straight to `onApplyDocument`, which
 * dispatches them into the editor's reducer — so an AI edit is recorded in the
 * same history stack as a keystroke and reverts with the same Ctrl+Z. The panel
 * never writes to the API itself and never holds a second copy of the document,
 * because two copies is how a canvas and a chat log start disagreeing.
 *
 * `onBeforeTurn` is awaited before every send. It flushes autosave, so the
 * server reasons about what the user is looking at, and marks one undo boundary,
 * so the whole turn — however many edits it makes — collapses into a single step.
 */

const SUGGESTIONS = [
  "Create a resume for a mid-level backend engineer with 4 years of Node and Postgres",
  "Make the bullets under my most recent role more results-driven",
  "Tighten this to one page without cutting any roles",
];

type ChatTurn = {
  key: string;
  role: "user" | "assistant";
  content: string;
  outcomes: ChatToolOutcome[];
  error: { code: string; message: string } | null;
  /**
   * Set instead of `error` when the turn was refused for want of allowance.
   * Kept apart because the two want opposite affordances: an error offers a
   * retry, and retrying an exhausted allowance can only fail the same way.
   */
  blocked: AiUsageDto | null;
  streaming: boolean;
};

export function ChatPanel({
  resumeId,
  onClose,
  onBeforeTurn,
  onApplyDocument,
  onFocusSection,
}: {
  resumeId: string;
  onClose: () => void;
  onBeforeTurn: () => Promise<void>;
  onApplyDocument: (content: ResumeContent, theme: Theme) => void;
  onFocusSection: (sectionId: string) => void;
}) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { applyUsage } = useUsage();

  const aborter = useRef<AbortController | null>(null);
  const keySeed = useRef(0);
  const scroller = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);
  /** The last thing the user said, so Retry doesn't need them to retype it. */
  const lastMessage = useRef<string | null>(null);

  const nextKey = () => `turn-${(keySeed.current += 1)}`;

  useEffect(() => {
    const controller = new AbortController();

    api
      .chatHistory(resumeId, controller.signal)
      .then(({ messages }) => {
        setTurns(
          messages
            .filter((message) => message.role !== "system")
            .map((message) => ({
              key: message.id,
              role: message.role === "assistant" ? "assistant" : "user",
              content: message.content,
              outcomes: message.toolCalls ?? [],
              error: null,
              blocked: null,
              streaming: false,
            })),
        );
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError(
          error instanceof ApiError ? error.message : "Could not load this conversation.",
        );
        setLoading(false);
      });

    return () => controller.abort();
  }, [resumeId]);

  // Cancels an in-flight turn if the panel closes mid-stream, so the provider
  // call ends with it rather than running on unwatched.
  useEffect(() => () => aborter.current?.abort(), []);

  const scrollToEnd = useCallback(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, []);

  useEffect(scrollToEnd, [turns, scrollToEnd]);

  const send = useCallback(
    async (message: string) => {
      const trimmed = message.trim();
      if (!trimmed || busy) return;

      lastMessage.current = trimmed;
      setBusy(true);
      setDraft("");

      // Flush the autosave and open one undo step, before anything is streamed.
      try {
        await onBeforeTurn();
      } catch {
        // A failed flush is not fatal — the server falls back to the last saved
        // document, which is the same guarantee export already makes.
      }

      const assistantKey = nextKey();
      setTurns((current) => [
        ...current,
        {
          key: nextKey(),
          role: "user",
          content: trimmed,
          outcomes: [],
          error: null,
          blocked: null,
          streaming: false,
        },
        {
          key: assistantKey,
          role: "assistant",
          content: "",
          outcomes: [],
          error: null,
          blocked: null,
          streaming: true,
        },
      ]);

      const update = (change: (turn: ChatTurn) => ChatTurn) =>
        setTurns((current) =>
          current.map((turn) => (turn.key === assistantKey ? change(turn) : turn)),
        );

      const controller = new AbortController();
      aborter.current = controller;

      let lastSectionRef: string | null = null;

      try {
        for await (const event of api.sendChatMessage(
          resumeId,
          { message: trimmed },
          controller.signal,
        )) {
          if (event.type === "text") {
            update((turn) => ({ ...turn, content: turn.content + event.delta }));
          } else if (event.type === "tool") {
            if (event.outcome.ok && event.outcome.sectionRef) {
              lastSectionRef = event.outcome.sectionRef;
            }
            update((turn) => ({ ...turn, outcomes: [...turn.outcomes, event.outcome] }));
          } else if (event.type === "document") {
            // The one line that matters: straight into the editor's reducer.
            onApplyDocument(event.content, event.theme);
          } else if (event.type === "error") {
            update((turn) => ({ ...turn, error: { code: event.code, message: event.message } }));
          } else {
            // `done` carries the counter the server wrote for this turn, so the
            // meter above the composer is current without a second request.
            applyUsage(event.usage);
            update((turn) => ({ ...turn, streaming: false }));
          }
        }
      } catch (error: unknown) {
        const aborted = error instanceof DOMException && error.name === "AbortError";

        // Refused before the stream opened, which is the only reason a 402 can
        // reach a caller that is otherwise reading events. It replaces the empty
        // assistant turn with the wall rather than an error, because there is
        // nothing here to retry.
        if (error instanceof ApiError && error.isAllowanceExhausted && error.usage) {
          applyUsage(error.usage);
          const spent = error.usage;
          update((turn) => ({ ...turn, blocked: spent, streaming: false }));
          return;
        }

        update((turn) => ({
          ...turn,
          error: aborted
            ? null
            : {
                code: "network",
                message:
                  error instanceof ApiError
                    ? error.message
                    : "The connection to the assistant dropped.",
              },
        }));
      } finally {
        update((turn) => ({ ...turn, streaming: false }));
        aborter.current = null;
        setBusy(false);
        // Scrolling the canvas last, so the user's eye lands on the change after
        // the panel has finished narrating it.
        if (lastSectionRef) onFocusSection(lastSectionRef);
      }
    },
    [busy, onApplyDocument, onBeforeTurn, onFocusSection, resumeId, applyUsage],
  );

  const retry = useCallback(() => {
    const message = lastMessage.current;
    if (!message) return;
    // Drops the failed exchange rather than stacking a second copy of the same
    // question under the first.
    setTurns((current) => current.slice(0, -2));
    void send(message);
  }, [send]);

  const clear = useCallback(async () => {
    if (!window.confirm("Clear this conversation? Your resume keeps every change it made.")) return;
    try {
      await api.clearChat(resumeId);
      setTurns([]);
      lastMessage.current = null;
    } catch {
      setLoadError("Could not clear the conversation.");
    }
  }, [resumeId]);

  return (
    <aside
      className="fixed inset-0 z-40 flex flex-col bg-paper md:relative md:inset-auto md:z-auto md:w-[22rem] md:shrink-0 md:border-l md:border-rule"
      aria-label="Resume assistant"
    >
      <div className="flex h-12 items-center justify-between border-b border-rule px-4">
        <FieldLabel>Assistant</FieldLabel>
        <div className="flex items-center gap-0.5">
          <IconButton label="Clear conversation" onClick={() => void clear()} disabled={!turns.length}>
            <BroomIcon />
          </IconButton>
          <IconButton label="Close assistant" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </div>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {loading && <LoadingLines />}

        {loadError && (
          <p role="alert" className="rounded-lg bg-danger-wash px-3 py-2 text-sm text-danger">
            {loadError}
          </p>
        )}

        {!loading && !turns.length && (
          <EmptyState onPick={(text) => void send(text)} disabled={busy} />
        )}

        {turns.map((turn) =>
          turn.role === "user" ? (
            <UserTurn key={turn.key} content={turn.content} />
          ) : (
            <AssistantTurn
              key={turn.key}
              turn={turn}
              onFocusSection={onFocusSection}
              onRetry={retry}
            />
          ),
        )}
      </div>

      <AllowanceMeter className="border-t border-rule px-4 py-2.5" />

      <Composer
        value={draft}
        busy={busy}
        inputRef={input}
        onChange={setDraft}
        onSend={() => void send(draft)}
        onStop={() => aborter.current?.abort()}
      />
    </aside>
  );
}

// --- Turns ---

function UserTurn({ content }: { content: string }) {
  return (
    <motion.p
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="ml-6 whitespace-pre-wrap rounded-xl rounded-br-sm bg-paper-sunken px-3 py-2 text-sm text-ink"
    >
      {content}
    </motion.p>
  );
}

/** What the panel says while it waits, so a slow turn never looks like a hang. */
function pendingLabel(turn: ChatTurn): string {
  if (turn.outcomes.length > 0) return "Editing your resume";
  if (turn.content.trim()) return "Writing";
  return "Thinking";
}

function AssistantTurn({
  turn,
  onFocusSection,
  onRetry,
}: {
  turn: ChatTurn;
  onFocusSection: (sectionId: string) => void;
  onRetry: () => void;
}) {
  const applied = turn.outcomes.filter((outcome) => outcome.ok).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="space-y-2"
    >
      {turn.content && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">{turn.content}</p>
      )}

      {turn.outcomes.length > 0 && (
        <ul className="space-y-1">
          {turn.outcomes.map((outcome, index) => (
            <ToolRow
              key={`${outcome.name}-${index}`}
              outcome={outcome}
              onFocusSection={onFocusSection}
            />
          ))}
        </ul>
      )}

      {turn.streaming && (
        <p className="flex items-center gap-2 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-ink-faint">
          <motion.span
            aria-hidden
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
            className="h-1.5 w-1.5 rounded-full bg-accent"
          />
          {pendingLabel(turn)}
        </p>
      )}

      {!turn.streaming && applied > 0 && !turn.error && (
        <p className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-positive">
          {applied} change{applied === 1 ? "" : "s"} applied &middot; Ctrl+Z to undo
        </p>
      )}

      {turn.blocked && <AllowanceWall usage={turn.blocked} />}

      {turn.error && (
        <div role="alert" className="rounded-lg bg-danger-wash px-3 py-2">
          {/* The specific message, never "something went wrong" — a rate limit is
              worth retrying and a bad key is not, and only the text says which. */}
          <p className="text-sm text-danger">{turn.error.message}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-danger underline underline-offset-2 transition-opacity hover:opacity-70"
          >
            Try again
          </button>
        </div>
      )}
    </motion.div>
  );
}

function ToolRow({
  outcome,
  onFocusSection,
}: {
  outcome: ChatToolOutcome;
  onFocusSection: (sectionId: string) => void;
}) {
  const target = outcome.ok ? outcome.sectionRef : null;

  return (
    <li>
      <button
        type="button"
        disabled={!target}
        onClick={() => target && onFocusSection(target)}
        className={`flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-[0.8125rem] transition-colors ${
          target ? "hover:bg-paper-sunken" : "cursor-default"
        }`}
      >
        <span className={`mt-[0.1875rem] shrink-0 ${outcome.ok ? "text-positive" : "text-danger"}`}>
          {outcome.ok ? <CheckIcon /> : <CrossIcon />}
        </span>
        <span className="min-w-0">
          <span className={outcome.ok ? "text-ink" : "text-danger"}>{outcome.summary}</span>
          {!outcome.ok && outcome.error && (
            <span className="block text-[0.75rem] text-ink-faint">{outcome.error}</span>
          )}
        </span>
      </button>
    </li>
  );
}

// --- Empty and loading states ---

function EmptyState({
  onPick,
  disabled,
}: {
  onPick: (text: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-3 pt-2">
      <p className="text-sm leading-relaxed text-ink-muted">
        Ask for a change and I&rsquo;ll make it on the page. I can build a resume from scratch,
        rewrite bullets, or reorganise what&rsquo;s already here &mdash; every edit undoes like
        any other.
      </p>
      <div className="space-y-1.5">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            disabled={disabled}
            onClick={() => onPick(suggestion)}
            className="w-full rounded-lg px-3 py-2 text-left text-[0.8125rem] leading-snug text-ink-muted ring-1 ring-inset ring-rule transition-colors hover:bg-paper-sunken hover:text-ink disabled:opacity-50"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}

function LoadingLines() {
  return (
    <div className="space-y-2" aria-hidden>
      {[0, 1, 2].map((row) => (
        <motion.div
          key={row}
          animate={{ opacity: [0.4, 0.8, 0.4] }}
          transition={{ duration: 1.6, repeat: Infinity, delay: row * 0.15 }}
          className="h-3 rounded bg-paper-sunken"
          style={{ width: `${90 - row * 18}%` }}
        />
      ))}
    </div>
  );
}

// --- Composer ---

function Composer({
  value,
  busy,
  inputRef,
  onChange,
  onSend,
  onStop,
}: {
  value: string;
  busy: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
}) {
  // Grows with the message up to a ceiling, then scrolls — a six-line request
  // shouldn't push the transcript off the screen.
  useEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 160)}px`;
  }, [value, inputRef]);

  return (
    <div className="border-t border-rule p-3">
      <div className="rounded-xl bg-paper-sunken p-2 ring-1 ring-inset ring-transparent transition-shadow focus-within:ring-rule-strong">
        <textarea
          ref={inputRef}
          rows={1}
          value={value}
          maxLength={4000}
          placeholder="Ask for a change…"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is a newline. The panel is a conversation,
            // not a document, so the common case gets the bare key.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
          className="block w-full resize-none bg-transparent px-1.5 py-1 text-sm text-ink outline-none placeholder:text-ink-faint"
        />

        <div className="flex items-center justify-between pl-1.5 pt-1">
          <span className="font-mono text-[0.625rem] uppercase tracking-[0.12em] text-ink-faint">
            {busy ? "Working" : "Enter to send"}
          </span>

          <AnimatePresence mode="wait" initial={false}>
            {busy ? (
              <motion.button
                key="stop"
                type="button"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onStop}
                className="h-7 rounded-lg px-2.5 text-[0.75rem] text-ink-muted ring-1 ring-inset ring-rule-strong transition-colors hover:bg-paper hover:text-ink"
              >
                Stop
              </motion.button>
            ) : (
              <motion.button
                key="send"
                type="button"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onSend}
                disabled={!value.trim()}
                className="h-7 rounded-lg bg-ink px-3 text-[0.75rem] text-paper transition-opacity hover:opacity-90 disabled:opacity-30"
              >
                Send
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// --- Icons ---

const svg = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function CheckIcon() {
  return (
    <svg {...svg} width={12} height={12} strokeWidth={2.25}>
      <path d="m5 12 4.5 4.5L19 7" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg {...svg} width={12} height={12} strokeWidth={2.25}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg {...svg}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function BroomIcon() {
  return (
    <svg {...svg}>
      <path d="M14 4 9.5 8.5" />
      <path d="m12.5 7 4.5 4.5" />
      <path d="M15.5 10 8 17.5a3 3 0 0 1-4.2 0L3 16.8l7.5-7.5" />
      <path d="M6.5 14.5 9 17" />
    </svg>
  );
}
