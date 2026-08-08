"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import type { SaveStatus } from "./use-autosave";

const DEBOUNCE_MS = 800;

/**
 * Debounced autosave for uploaded-PDF edits.
 *
 * Differs from `useAutosave` in what a save *is*: a resume PATCHes one document,
 * while a PDF PATCHes each edited run individually. So this hook accumulates a
 * map of dirty runs and drains it on one shared timer — batching a burst of
 * typing across several boxes into a single round of requests rather than one
 * per keystroke per box.
 *
 * Saves are serialised for the same reason the resume's are: a drain that
 * overlapped its predecessor could land out of order and persist stale text.
 */
export function usePdfRunAutosave(documentId: string) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  // Latest text per edited run, drained on flush. A ref because it changes on
  // every keystroke and must not re-render the page or re-run effects.
  const dirty = useRef(new Map<string, string>());
  const inFlight = useRef(false);
  const queued = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (inFlight.current) {
      // A drain is already running; let it pick up what's accumulated since.
      queued.current = true;
      return;
    }
    if (dirty.current.size === 0) return;

    // Snapshot and clear before awaiting, so edits made during the drain are
    // recorded as newly dirty rather than silently dropped by the clear.
    const batch = [...dirty.current.entries()];
    dirty.current.clear();

    inFlight.current = true;
    setStatus("saving");

    try {
      await Promise.all(batch.map(([runId, text]) => api.updatePdfRun(documentId, runId, { text })));
      setError(null);
      setStatus(dirty.current.size > 0 ? "pending" : "saved");
    } catch (caught) {
      // Put the batch back so a retry — or the next keystroke's drain — resends
      // it. Existing entries win: they're newer than what we snapshotted.
      for (const [runId, text] of batch) {
        if (!dirty.current.has(runId)) dirty.current.set(runId, text);
      }
      setStatus("error");
      setError(caught instanceof ApiError ? caught.message : "Could not save your changes.");
    } finally {
      inFlight.current = false;
      if (queued.current) {
        queued.current = false;
        void flush();
      }
    }
  }, [documentId]);

  /** Records an edit and restarts the debounce window. */
  const save = useCallback(
    (runId: string, text: string) => {
      dirty.current.set(runId, text);
      setStatus("pending");

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void flush();
      }, DEBOUNCE_MS);
    },
    [flush],
  );

  /** Drains immediately, bypassing the debounce. Used before export. */
  const saveNow = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    await flush();
  }, [flush]);

  // Ctrl/Cmd+S saves rather than opening the browser's "save page" dialog.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveNow();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveNow]);

  // A tab closed mid-debounce would lose the last edit outright.
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (dirty.current.size > 0 || inFlight.current) event.preventDefault();
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Unmount mid-debounce is the in-app equivalent of closing the tab. The
  // request outlives this component, so the edit still lands.
  useEffect(() => {
    // Captured at setup, not read in cleanup: the Map instance is created once
    // and never reassigned, so this is the same object either way — and it's
    // the form the exhaustive-deps rule can verify.
    const pending = dirty.current;

    return () => {
      if (!timer.current) return;
      clearTimeout(timer.current);

      for (const [runId, text] of pending) {
        void api.updatePdfRun(documentId, runId, { text }).catch(() => {});
      }
      pending.clear();
    };
  }, [documentId]);

  return { status, error, save, saveNow };
}
