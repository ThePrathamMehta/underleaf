"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UpdateCoverLetterBody } from "@repo/types";
import { api, ApiError } from "./api";
import type { SaveStatus } from "./use-autosave";

const DEBOUNCE_MS = 1200;

/**
 * Debounced autosave for a cover letter.
 *
 * The same contract as `useAutosave` — serialised saves, Ctrl/Cmd+S to flush, a
 * `beforeunload` guard — against a different resource. Kept separate rather than
 * generalised: `useAutosave` is keyed to a resume id and a revision counter from
 * the editor's reducer, and a letter has neither. Threading both through a
 * generic hook would cost more indirection than the forty lines it saved.
 *
 * `letterId` is nullable because the page exists before the first letter does.
 * With no id there is nothing to save to, and edits simply aren't persisted —
 * the textarea is read-only in that state anyway.
 */
export function useLetterAutosave(letterId: string | null, build: () => UpdateCoverLetterBody) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const buildRef = useRef(build);
  buildRef.current = build;

  const inFlight = useRef(false);
  const queued = useRef(false);
  const dirty = useRef(false);
  const [isDirty, setIsDirty] = useState(false);

  const markDirty = useCallback(() => {
    dirty.current = true;
    setIsDirty(true);
  }, []);

  const flush = useCallback(async () => {
    if (!letterId || !dirty.current) return;

    if (inFlight.current) {
      queued.current = true;
      return;
    }

    inFlight.current = true;
    // Cleared before the request, not after: an edit that lands mid-flight has
    // to be able to set this again, or it would be dropped by the settle below.
    dirty.current = false;
    setStatus("saving");

    try {
      await api.updateCoverLetter(letterId, buildRef.current());
      setError(null);
      setStatus(dirty.current ? "pending" : "saved");
      setIsDirty(dirty.current);
    } catch (caught) {
      dirty.current = true;
      setIsDirty(true);
      setStatus("error");
      setError(caught instanceof ApiError ? caught.message : "Could not save your letter.");
    } finally {
      inFlight.current = false;
      if (queued.current) {
        queued.current = false;
        void flush();
      }
    }
  }, [letterId]);

  /** Call after every edit. Schedules the save and drives the status pill. */
  const onEdit = useCallback(() => {
    markDirty();
    setStatus("pending");
  }, [markDirty]);

  // One timer, restarted by each keystroke through the status change above.
  useEffect(() => {
    if (status !== "pending") return;
    const timer = setTimeout(() => void flush(), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [status, flush]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void flush();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [flush]);

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (dirty.current) event.preventDefault();
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  /**
   * Resets after a generation replaces the body wholesale. Without this the
   * pending edit from before the regenerate would save the old text back over
   * the new letter a beat later.
   */
  const reset = useCallback(() => {
    dirty.current = false;
    queued.current = false;
    setIsDirty(false);
    setStatus("idle");
    setError(null);
  }, []);

  return { status, error, isDirty, onEdit, saveNow: flush, reset };
}
