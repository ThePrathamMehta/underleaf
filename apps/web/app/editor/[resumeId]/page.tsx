"use client";

import { use, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import type { ResumeContent, SectionType, TemplateDto, Theme } from "@repo/types";
import type { FieldPath } from "@repo/ui/resume";
import { api, ApiError } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";
import { editorReducer, initEditorState } from "../../../lib/editor-reducer";
import { useAutosave } from "../../../lib/use-autosave";
import { EditorToolbar, type EditorPanel } from "../../../components/editor/toolbar";
import { SelectionToolbar } from "../../../components/editor/selection-toolbar";
import { EditorCanvas, type CanvasHandle } from "../../../components/editor/canvas";
import { SectionPanel } from "../../../components/editor/section-panel";
import { ChatPanel } from "../../../components/editor/chat-panel";
import { AtsPanel } from "../../../components/editor/ats-panel";
import { JdPanel } from "../../../components/editor/jd-panel";
import { PageRail } from "../../../components/editor/page-rail";
import { ButtonLink } from "../../../components/button";
import { Logo } from "../../../components/logo";

const EMPTY = initEditorState({
  title: "",
  content: { personalInfo: { name: "", title: "", email: "", phone: "", location: "", links: [] }, sections: [] },
  theme: {
    fontFamily: "inter",
    headingFontFamily: "inter",
    fontSizeScale: 1,
    accentColor: "#1a1a1a",
    textColor: "#1a1a1a",
    lineSpacing: 1.25,
    marginSize: 14,
    layout: "single-column",
    pageSize: "letter",
  },
});

export default function EditorPage({ params }: { params: Promise<{ resumeId: string }> }) {
  const { resumeId } = use(params);
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [state, dispatch] = useReducer(editorReducer, EMPTY);
  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const [templateSlug, setTemplateSlug] = useState<string>("jakes");
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [activePanel, setActivePanel] = useState<EditorPanel | null>(null);
  // Sheet count and current sheet both come from the canvas: they're properties
  // of the measured layout, which only the canvas can compute.
  const [pageCount, setPageCount] = useState(1);
  const [activePage, setActivePage] = useState(0);
  const canvas = useRef<CanvasHandle | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace(`/login?next=${encodeURIComponent(`/editor/${resumeId}`)}`);
  }, [authLoading, user, router, resumeId]);

  /**
   * Opens a dock panel from `?panel=`, so `/editor/:id/ats` and
   * `/editor/:id/jd-match` are real, linkable addresses that still land in the
   * editor with the canvas beside them.
   *
   * Read from `window` in an effect rather than through `useSearchParams`: this
   * runs once on mount, which keeps the page out of a Suspense boundary it
   * otherwise wouldn't need.
   */
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("panel");
    if (requested === "assistant" || requested === "ats" || requested === "jd") {
      setActivePanel(requested);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    Promise.all([api.resume(resumeId), api.templates()])
      .then(([{ resume }, { templates: list }]) => {
        if (cancelled) return;
        dispatch({
          type: "reset",
          doc: { title: resume.title, content: resume.content, theme: resume.theme },
        });
        setTemplateSlug(resume.template.slug);
        setTemplates(list);
        setReady(true);
      })
      .catch((caught) => {
        if (cancelled) return;
        setLoadError(
          caught instanceof ApiError
            ? { status: caught.status, message: caught.message }
            : { status: 0, message: "Could not load this resume." },
        );
      });

    return () => {
      cancelled = true;
    };
  }, [user, resumeId]);

  const { doc, revision, past, future } = state;

  // Autosave reads the document through a ref, so the hook needn't re-subscribe
  // on every keystroke.
  const docRef = useRef(doc);
  docRef.current = doc;
  const buildPatch = useCallback(
    () => ({ title: docRef.current.title, content: docRef.current.content, theme: docRef.current.theme }),
    [],
  );

  const { status, error: saveError, isDirty, saveNow } = useAutosave(
    resumeId,
    ready ? revision : 0,
    buildPatch,
  );

  /**
   * Whether the browser's own undo stack still describes what's on screen.
   *
   * Typing into a field is recorded natively, so Ctrl+Z inside a focused field
   * belongs to the browser — undoing a character at a time is what a user
   * expects mid-sentence. An AI edit is a programmatic re-render, which browsers
   * do not record: after one lands, the native stack describes text that is no
   * longer there, and Ctrl+Z inside a field appears to do nothing at all. From
   * that point the shortcut belongs to our history stack regardless of focus,
   * until the user types again and gives the browser something real to undo.
   */
  const nativeUndoUsable = useRef(true);

  const onFieldChange = useCallback((path: FieldPath, value: string) => {
    nativeUndoUsable.current = true;
    dispatch({ type: "setField", path, value });
  }, []);

  const onFieldCommit = useCallback(() => dispatch({ type: "commit" }), []);

  const onThemeChange = useCallback((patch: Partial<Theme>) => {
    dispatch({ type: "patchTheme", patch });
  }, []);

  // Undo/redo shortcuts. Deferred to the browser only while a focused field's
  // native stack is still trustworthy — see `nativeUndoUsable`.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.isContentEditable && nativeUndoUsable.current) return;

      event.preventDefault();
      dispatch({ type: event.shiftKey ? "redo" : "undo" });
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function handleExport() {
    setExporting(true);
    try {
      // Flush first: the export renders server-side from the saved row, so an
      // unsaved edit would silently be missing from the PDF.
      if (isDirty) await saveNow();
      window.location.assign(api.exportUrl(resumeId, doc.theme.pageSize));
    } finally {
      // The navigation is a file download, so the page stays put.
      setTimeout(() => setExporting(false), 1500);
    }
  }

  /**
   * The toolbar's back-to-dashboard action. The debounced autosave may still
   * have unsaved edits (isDirty) or a save in flight, so leaving needs a
   * confirm rather than silently dropping them. browser-navigation still gets
   * the beforeunload guard in useAutosave; this covers in-app navigation.
   */
  const handleBackToDashboard = useCallback(() => {
    if (isDirty || status === "saving" || status === "pending") {
      const leave = window.confirm(
        "You have unsaved changes. Leave without saving? We'll keep saving in the background, but the latest edits may not have finished.",
      );
      if (!leave) return;
    }
    router.push("/dashboard");
  }, [isDirty, status, router]);

  async function handleTemplateChange(slug: string) {
    const template = templates.find((t) => t.slug === slug);
    if (!template || slug === templateSlug) return;

    const previous = templateSlug;
    setTemplateSlug(slug);

    // Only the layout changes: content is template-agnostic, and the template's
    // own default theme is deliberately not applied — that would silently
    // discard the fonts and colors the user picked.
    try {
      await api.updateResume(resumeId, { templateId: template.id });
    } catch {
      setTemplateSlug(previous);
    }
  }

  const scrollToSection = useCallback((sectionId: string) => {
    setFocusedSectionId(sectionId);
    canvas.current?.scrollToSection(sectionId);
  }, []);

  /**
   * Runs once before each assistant turn, and does two things that both have to
   * happen before the request leaves.
   *
   * The flush is the same one export does: the server reads the *saved* resume,
   * so an unsaved keystroke would otherwise be invisible to the model. The commit
   * is the undo boundary — `applyAiEdit` coalesces, so pushing the pre-turn
   * document onto `past` here is what makes a turn that rewrote four bullets
   * revert in a single Ctrl+Z.
   */
  const handleBeforeTurn = useCallback(async () => {
    dispatch({ type: "commit" });
    if (isDirty) await saveNow();
  }, [isDirty, saveNow]);

  /**
   * The flush without the undo boundary, for panels that read the document
   * rather than change it. Scoring and JD matching both run server-side against
   * the saved row, so an unsaved keystroke would be measured as absent.
   */
  const handleFlush = useCallback(async () => {
    if (isDirty) await saveNow();
  }, [isDirty, saveNow]);

  const handleApplyDocument = useCallback((content: ResumeContent, theme: Theme) => {
    // React rewrote the fields, so whatever the browser had queued for the
    // focused one no longer matches the screen. Claim Ctrl+Z until the user
    // types and the native stack becomes meaningful again.
    nativeUndoUsable.current = false;
    dispatch({ type: "applyAiEdit", content, theme });
  }, []);

  /** One dock, one panel: clicking the open one closes it, another swaps. */
  const togglePanel = useCallback((panel: EditorPanel) => {
    setActivePanel((current) => (current === panel ? null : panel));
  }, []);

  const templateOptions = useMemo(
    () => templates.map((t) => ({ id: t.id, slug: t.slug, name: t.name })),
    [templates],
  );

  if (loadError) {
    return (
      <ErrorScreen
        title={loadError.status === 404 ? "We couldn't find that resume" : "Something went wrong"}
        message={
          loadError.status === 404
            ? "It may have been deleted, or it belongs to another account."
            : loadError.message
        }
      />
    );
  }

  if (!ready) return <LoadingScreen />;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-paper">
      <EditorToolbar
        title={doc.title}
        theme={doc.theme}
        status={status}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        zoom={zoom}
        templateSlug={templateSlug}
        templates={templateOptions}
        exporting={exporting}
        activePanel={activePanel}
        onTitleChange={(title) => dispatch({ type: "setTitle", title })}
        onTitleCommit={() => dispatch({ type: "commit" })}
        onThemeChange={onThemeChange}
        onThemeCommit={() => dispatch({ type: "commit" })}
        onUndo={() => dispatch({ type: "undo" })}
        onRedo={() => dispatch({ type: "redo" })}
        onZoomChange={(next) => setZoom(Math.min(2, Math.max(0.5, Number(next.toFixed(2)))))}
        onTemplateChange={(slug) => void handleTemplateChange(slug)}
        onExport={() => void handleExport()}
        onBack={handleBackToDashboard}
        onAddPage={() => dispatch({ type: "addPage" })}
        onTogglePanel={togglePanel}
        onCoverLetter={() => router.push(`/resumes/${resumeId}/cover-letter`)}
      />

      {saveError && (
        <div role="alert" className="border-b border-danger/20 bg-danger-wash px-4 py-2 text-center text-sm text-danger">
          {saveError} Your changes are still here &mdash; we&rsquo;ll keep retrying as you edit.
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <PageRail
          pageCount={pageCount}
          activePage={activePage}
          onSelect={(pageIndex) => canvas.current?.scrollToPage(pageIndex)}
          canRemoveLastPage={doc.content.sections.some((section) => section.pageBreakBefore)}
          onRemoveLastPage={() => dispatch({ type: "removeLastPage" })}
          collapseForAssistant={activePanel === "assistant"}
        />

        <EditorCanvas
          templateSlug={templateSlug}
          content={doc.content}
          theme={doc.theme}
          zoom={zoom}
          focusedSectionId={focusedSectionId}
          handleRef={canvas}
          onFieldChange={onFieldChange}
          onFieldCommit={onFieldCommit}
          onFocusSection={setFocusedSectionId}
          onAddItem={(sectionId) => dispatch({ type: "addItem", sectionId })}
          onRemoveItem={(sectionId, itemId) => dispatch({ type: "removeItem", sectionId, itemId })}
          onAddBullet={(sectionId, itemId) => dispatch({ type: "addBullet", sectionId, itemId })}
          onPagesChange={setPageCount}
          onActivePageChange={setActivePage}
        />

        {/* Formats whatever is selected inside the canvas; the header toolbar
            above keeps the document-wide equivalents. Portals to the body, so
            it's mounted here rather than nested in the canvas's scroll box. */}
        <SelectionToolbar theme={doc.theme} />

        <SectionPanel
          sections={doc.content.sections}
          onReorder={(fromId, toId) => dispatch({ type: "reorderSections", fromId, toId })}
          onToggle={(sectionId) => dispatch({ type: "toggleSection", sectionId })}
          onRemove={(sectionId) => dispatch({ type: "removeSection", sectionId })}
          onAdd={(sectionType: SectionType) => dispatch({ type: "addSection", sectionType })}
          onFocusSection={scrollToSection}
        />

        {/* Unmounted when closed rather than hidden: an in-flight turn is aborted
            on unmount, so closing the panel really does end the provider call.
            The transcript lives on the server, so reopening restores it. */}
        {activePanel === "assistant" && (
          <ChatPanel
            resumeId={resumeId}
            onClose={() => setActivePanel(null)}
            onBeforeTurn={handleBeforeTurn}
            onApplyDocument={handleApplyDocument}
            onFocusSection={scrollToSection}
          />
        )}

        {activePanel === "ats" && (
          <AtsPanel
            resumeId={resumeId}
            onClose={() => setActivePanel(null)}
            onBeforeCheck={handleFlush}
            onFocusSection={scrollToSection}
          />
        )}

        {/* Two different pre-flight hooks, deliberately: comparing only reads the
            document, while "Apply with AI" edits it and so needs the undo
            boundary opened first. */}
        {activePanel === "jd" && (
          <JdPanel
            resumeId={resumeId}
            onClose={() => setActivePanel(null)}
            onBeforeRun={handleFlush}
            onBeforeApply={handleBeforeTurn}
            onApplyDocument={handleApplyDocument}
            onFocusSection={scrollToSection}
          />
        )}
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-paper">
      <motion.div
        animate={{ opacity: [0.35, 1, 0.35] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      >
        <Logo className="h-7 w-auto" />
      </motion.div>
      <p className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ink-faint">
        Opening your document
      </p>
    </div>
  );
}

function ErrorScreen({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-5 bg-paper px-6 text-center">
      <Logo className="h-7 w-auto" />
      <div className="max-w-[42ch]">
        <h1 className="font-display text-2xl tracking-tight">{title}</h1>
        <p className="mt-2 text-ink-muted">{message}</p>
      </div>
      <ButtonLink href="/dashboard" variant="secondary" size="sm">
        Back to your resumes
      </ButtonLink>
    </div>
  );
}
