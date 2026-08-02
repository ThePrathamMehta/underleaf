"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UpdateResumeBody } from "@repo/types";
import { api, ApiError } from "./api";

export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

const DEBOUNCE_MS = 1200;

/**
 * Debounced autosave for the editor.
 *
 * Saves are serialised: while one PATCH is in flight, later edits queue up and
 * fire once it settles. Overlapping saves could otherwise land out of order and
 * persist a stale document.
 */
export function useAutosave(resumeId: string, revision: number, build: () => UpdateResumeBody) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  // Refs, not state: these change on every keystroke and must not re-run effects.
  const buildRef = useRef(build);
  buildRef.current = build;

  const inFlight = useRef(false);
  const queued = useRef(false);
  const savedRevision = useRef(revision);
  const latestRevision = useRef(revision);
  latestRevision.current = revision;

  const flush = useCallback(async () => {
    if (inFlight.current) {
      queued.current = true;
      return;
    }

    const revisionBeingSaved = latestRevision.current;
    inFlight.current = true;
    setStatus("saving");

    try {
      await api.updateResume(resumeId, buildRef.current());
      savedRevision.current = revisionBeingSaved;
      setError(null);
      // Another edit arrived mid-flight, so we're already dirty again.
      setStatus(latestRevision.current === revisionBeingSaved ? "saved" : "pending");
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof ApiError ? caught.message : "Could not save your changes.");
    } finally {
      inFlight.current = false;
      if (queued.current) {
        queued.current = false;
        void flush();
      }
    }
  }, [resumeId]);

  useEffect(() => {
    if (revision === savedRevision.current) return;

    setStatus("pending");
    const timer = setTimeout(() => void flush(), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [revision, flush]);

  // Ctrl/Cmd+S saves immediately rather than letting the browser show its
  // "save page" dialog, which is never what someone means in a document editor.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (latestRevision.current !== savedRevision.current) void flush();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [flush]);

  // A tab closed during the debounce window would lose the last edit outright.
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (latestRevision.current !== savedRevision.current) event.preventDefault();
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const isDirty = revision !== savedRevision.current;

  return { status, error, isDirty, saveNow: flush };
}
