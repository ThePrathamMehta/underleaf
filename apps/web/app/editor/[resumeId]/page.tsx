"use client";

import { use, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import type { FreeformBlock, PlacedItem, ResumeContent, SectionStarter, SectionType, TemplateDto, Theme } from "@repo/types";
import { isBlankTemplate } from "@repo/types";
import { baseTemplateSlug, type FieldPath } from "@repo/ui/resume";
import {
  canFill,
  canTighten,
  describeDrift,
  describeFit,
  FILL_OFFER_BELOW,
} from "@repo/ui/resume/fit-page";
import { forcedBreakIds } from "@repo/ui/resume/paginate";
import { api, ApiError } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";
import type { Point } from "../../../lib/click-to-edit";
import { editorReducer, initEditorState } from "../../../lib/editor-reducer";
import { takeImportNotice, type ImportNotice } from "../../../lib/import-handoff";
import { IMAGE_ACCEPT, imageUploadError } from "../../../lib/uploads";
import { useAutosave } from "../../../lib/use-autosave";
import { EditorToolbar, type EditorPanel } from "../../../components/editor/toolbar";
import { SelectionToolbar } from "../../../components/editor/selection-toolbar";
import { EditorCanvas, type CanvasHandle, type InsertKind } from "../../../components/editor/canvas";
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
  /**
   * The theme this resume's template was designed around.
   *
   * Kept beside the document rather than in it, because it isn't part of the
   * document: it's the reference point for "your line height is looser than this
   * template asked for", which is the most useful thing to be able to say about a
   * resume that has grown a second page. A resume copies no theme from its
   * template at creation — see the API's create route — so the two can drift, and
   * that drift is worth naming.
   */
  const [templateDefaultTheme, setTemplateDefaultTheme] = useState<Theme | null>(null);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [activePanel, setActivePanel] = useState<EditorPanel | null>(null);
  // Sheet count and current sheet both come from the canvas: they're properties
  // of the measured layout, which only the canvas can compute.
  const [pageCount, setPageCount] = useState(1);
  /**
   * How full sheet one is, straight from the canvas's measurement.
   *
   * Starts at 1 — "full" — so the fill offer can never flash on screen during the
   * first render, before anything has been measured. An empty document briefly
   * claiming to have room to spare would be the one moment the banner is least
   * welcome.
   */
  const [fill, setFill] = useState(1);
  const [activePage, setActivePage] = useState(0);
  const canvas = useRef<CanvasHandle | null>(null);
  /**
   * The file picker behind Insert → Image, and whatever went wrong last time.
   *
   * A hidden input rather than `showOpenFilePicker`, which Safari and Firefox don't
   * have. It stays mounted because `click()` on an element that isn't in the
   * document opens nothing.
   */
  const imageInput = useRef<HTMLInputElement>(null);
  const [insertError, setInsertError] = useState<string | null>(null);
  /**
   * The "you just imported this" banner, if this navigation came from an import.
   *
   * Read once from session storage — see `lib/import-handoff` for why it lives
   * there and not on the resume row.
   */
  const [importNotice, setImportNotice] = useState<ImportNotice | null>(null);
  /**
   * What the last "Fit to one page" did, or why it couldn't.
   *
   * Held separately from the overflow warning because the two are different
   * statements: the warning describes the document, this describes an action the
   * user just took, and it stays on screen after the overflow it fixed is gone.
   */
  const [fitResult, setFitResult] = useState<{ ok: boolean; changes: string[] } | null>(null);
  /**
   * The document revision the fit message describes, captured after it appears.
   *
   * The message clears itself once the user edits past it: "Ctrl+Z puts it back"
   * is true for the moment after the button and misleading ten keystrokes later.
   * Read in an effect rather than computed at dispatch time so it doesn't depend
   * on how much the reducer bumps the revision by.
   */
  const fitRevision = useRef<number | null>(null);
  /**
   * Whether the overflow warning has been waved off.
   *
   * A second page is a legitimate choice — plenty of resumes should be two — so
   * the warning has to be dismissible, and dismissing it has to stick. Reset when
   * the document comes back within its pages, so the next overflow is news again.
   */
  const [overflowDismissed, setOverflowDismissed] = useState(false);
  /**
   * Whether the offer to fill the page has been waved off.
   *
   * A short resume is a legitimate choice too — more so than a long one, since a
   * new graduate's page genuinely has less on it — so this is dismissible on the
   * same terms. Reset when the page fills up, so the next gap is news again.
   */
  const [underfullDismissed, setUnderfullDismissed] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.replace(`/login?next=${encodeURIComponent(`/editor/${resumeId}`)}`);
  }, [authLoading, user, router, resumeId]);

  // Consumed on mount, before anything can navigate away from it.
  useEffect(() => {
    setImportNotice(takeImportNotice(resumeId));
  }, [resumeId]);

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
        setTemplateDefaultTheme(resume.template.defaultTheme);
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

  /**
   * Stable identity on purpose: the canvas subscribes its drag listeners for the
   * life of a gesture and has this in the effect's dependencies, so a new
   * function each render would tear them down and rebuild them mid-drag.
   */
  const onMoveItem = useCallback((itemId: string, toSectionId: string, index: number) => {
    dispatch({ type: "moveItem", itemId, toSectionId, index });
  }, []);

  // The blank canvas's four, stable for the same reason: a move or resize runs off
  // window listeners subscribed once per gesture.
  const onAddBlock = useCallback((block: FreeformBlock) => {
    dispatch({ type: "addFreeformBlock", block });
  }, []);

  const onMoveBlock = useCallback(
    (blockId: string, page: number, position: { x: number; y: number }) => {
      dispatch({ type: "moveFreeformBlock", blockId, page, position });
    },
    [],
  );

  const onResizeBlock = useCallback(
    (
      blockId: string,
      position: { x: number; y: number },
      size: { width: number; height: number },
    ) => {
      dispatch({ type: "resizeFreeformBlock", blockId, position, size });
    },
    [],
  );

  const onRemoveBlock = useCallback((blockId: string) => {
    dispatch({ type: "removeFreeformBlock", blockId });
  }, []);

  // --- Insert (v6 Section 2.4) ---

  const onAddPlacedItem = useCallback((sectionId: string, index: number, item: PlacedItem) => {
    dispatch({ type: "addPlacedItem", sectionId, index, item });
  }, []);

  /** Stable: the resize gesture's window listeners are subscribed once, on grab. */
  const onResizeImage = useCallback((itemId: string, widthPercent: number) => {
    dispatch({ type: "patchImageItem", itemId, patch: { widthPercent } });
  }, []);

  /**
   * Puts an image in the document, in two steps the user sees as one.
   *
   * The frame appears at once with no `src` yet, and the bytes are filled in when
   * the upload lands — which is why the item and block factories both allow an empty
   * one. Uploading first instead would leave a click on "Image" doing nothing visible
   * for as long as the network takes, and on a slow connection that reads as broken.
   *
   * A failed upload takes the placeholder back out. Leaving it would be worse than
   * never having added it: an empty frame is a dashed box that exports into the PDF.
   */
  const insertImageFile = useCallback(async (file: File, at?: Point) => {
    // Locally first, so a 40MB screenshot is refused instantly rather than after a
    // full upload. The API applies the same limits regardless.
    const invalid = imageUploadError(file);
    if (invalid) {
      setInsertError(invalid);
      return;
    }

    const placed = canvas.current?.insert("image", at);
    if (!placed) {
      setInsertError("There's nowhere to put an image yet — add a section first.");
      return;
    }

    setInsertError(null);
    try {
      const { url } = await api.uploadImage(file);
      // `coalesce` folds this into the insert above, so one Ctrl+Z takes the whole
      // image back out rather than first blanking it and then removing the frame.
      if (placed.kind === "block") {
        dispatch({ type: "setFreeformContent", blockId: placed.blockId, content: url, coalesce: true });
      } else {
        dispatch({ type: "patchImageItem", itemId: placed.itemId, patch: { src: url }, coalesce: true });
      }
    } catch (caught) {
      if (placed.kind === "block") {
        dispatch({ type: "removeFreeformBlock", blockId: placed.blockId });
      } else {
        dispatch({ type: "removeItem", sectionId: placed.sectionId, itemId: placed.itemId });
      }
      setInsertError(
        caught instanceof ApiError
          ? `That image couldn't be uploaded. ${caught.message}`
          : "That image couldn't be uploaded. Check your connection and try again.",
      );
    }
  }, []);

  const handleInsert = useCallback((kind: InsertKind) => {
    // An image needs its file before it needs a place, and the picker is modal — so
    // this hands off to the input's change handler rather than inserting now.
    if (kind === "image") {
      imageInput.current?.click();
      return;
    }

    setInsertError(
      canvas.current?.insert(kind)
        ? null
        : "There's nowhere to insert that yet — add a section first.",
    );
  }, []);

  /**
   * A starter section on the canvas. No error path: a canvas always has a sheet, and
   * the canvas makes room by running on to the next one.
   */
  const handleInsertSection = useCallback((kind: SectionStarter) => {
    canvas.current?.insertSection(kind);
  }, []);

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
    // Follows the layout, since it describes the layout: what counts as looser
    // than intended is whatever the template now on screen asked for.
    const previousDefault = templateDefaultTheme;
    setTemplateDefaultTheme(template.defaultTheme);

    // Only the layout changes: content is template-agnostic, and the template's
    // own default theme is deliberately not applied — that would silently
    // discard the fonts and colors the user picked.
    try {
      await api.updateResume(resumeId, { templateId: template.id });
    } catch {
      setTemplateSlug(previous);
      setTemplateDefaultTheme(previousDefault);
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

  /**
   * Whether this resume is a canvas rather than a set of sections.
   *
   * Read from the template, not the content: a blank resume switched onto Jake's
   * keeps its freeform blocks, and the template is what decides which of the two
   * the editor is showing.
   */
  const freeform = isBlankTemplate(baseTemplateSlug(templateSlug));

  // --- One page by default (v6) ---

  /**
   * How many sheets this resume asked for, as opposed to how many it has.
   *
   * A manual break is a sheet the user created on purpose; anything past those is
   * the document outgrowing the page on its own. Counted through `forcedBreakIds`
   * rather than by filtering the sections, because a break flag on the very first
   * section is ignored by the renderer and would otherwise inflate the target.
   */
  const requestedPages = useMemo(
    () => (freeform ? pageCount : 1 + forcedBreakIds(doc.content).size),
    [doc.content, freeform, pageCount],
  );

  /**
   * Whether the document has run past the pages it asked for.
   *
   * Never on a blank canvas: there, every sheet exists because a block was put on
   * it, so there is no overflow to report and no leading to tighten that would
   * change it.
   */
  const overflowing = !freeform && pageCount > requestedPages;

  useEffect(() => {
    if (!overflowing) setOverflowDismissed(false);
  }, [overflowing]);

  /**
   * Whether the last sheet has a band of dead space worth offering to close.
   *
   * The mirror of `overflowing`, and disjoint from it by construction: a document
   * cannot both run past its pages and leave room on them. Never on a canvas, where
   * empty space is exactly where the user chose not to put a block.
   *
   * In practice this only ever fires for a single-sheet document. `fillRatio`
   * measures the whole flow against *one* sheet's usable height, so anything needing
   * a second sheet reports above 1 and can never read as underfull — which is the
   * right outcome: "fill the page" has no clear meaning when there are several, and
   * a resume with manual breaks is long on purpose. The `pageCount` guard is belt and
   * braces on top of that, so an overflowing document is never offered more growth.
   *
   * The threshold is `FILL_OFFER_BELOW`, not `TARGET_FILL`: a fill aims for the
   * target, but a page two lines short of it doesn't need mentioning — and since a
   * template's seeded theme is tuned against the longest sample sharing it, testing
   * against the target would greet many brand new resumes with this banner.
   */
  const underfull = !freeform && pageCount <= requestedPages && fill < FILL_OFFER_BELOW;

  useEffect(() => {
    if (!underfull) setUnderfullDismissed(false);
  }, [underfull]);

  /**
   * Tightens the typography until the resume fits again — on request, never on its
   * own.
   *
   * The search runs in the canvas, against its measuring mirror; all that happens
   * here is applying the winner. One `patchTheme` for the whole fit, so it is one
   * undo step: Ctrl+Z puts back exactly the theme the user had before pressing the
   * button.
   */
  const handleFitToPage = useCallback(() => {
    const fitted = canvas.current?.fitTheme(requestedPages, templateDefaultTheme ?? undefined);
    // Cleared before the new message goes up, so the effect below re-reads which
    // revision this one belongs to rather than inheriting the last fit's.
    fitRevision.current = null;

    if (!fitted) {
      setFitResult({ ok: false, changes: [] });
      return;
    }

    setFitResult({ ok: true, changes: describeFit(doc.theme, fitted) });
    dispatch({ type: "patchTheme", patch: fitted });
  }, [doc.theme, requestedPages, templateDefaultTheme]);

  /**
   * Grows the typography until the page is full — on request, never on its own.
   *
   * The exact mirror of `handleFitToPage`, and it reuses `fitResult` rather than
   * adding a second message channel: from the user's side both buttons do the same
   * kind of thing — change the spacing and say what changed — so one message
   * describing "what the last spacing action did" is the honest model, and the two
   * can never be on screen together anyway.
   *
   * `searchFill` returning null means the document is already as close to full as
   * growing the type gets it, which is not a failure and must not be reported as
   * one. Saying "nothing needed changing" is the truthful answer.
   */
  const handleFillPage = useCallback(() => {
    const filled = canvas.current?.fillTheme(requestedPages, templateDefaultTheme ?? undefined);
    fitRevision.current = null;

    if (!filled) {
      setFitResult({ ok: true, changes: [] });
      return;
    }

    setFitResult({ ok: true, changes: describeFit(doc.theme, filled) });
    dispatch({ type: "patchTheme", patch: filled });
  }, [doc.theme, requestedPages, templateDefaultTheme]);

  // The revision the message belongs to is whatever the fit produced; anything
  // past it is the user's own editing, and the message has outlived its subject.
  useEffect(() => {
    if (!fitResult) return;
    if (fitRevision.current === null) {
      fitRevision.current = revision;
      return;
    }
    if (revision !== fitRevision.current) setFitResult(null);
  }, [fitResult, revision]);

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
        onAddPage={() => dispatch({ type: "addPage", freeform })}
        // A canvas can always take another block; a template resume needs somewhere
        // for the item to go, which means at least one section that is actually shown.
        canInsert={freeform || doc.content.sections.some((section) => section.visible)}
        onInsert={handleInsert}
        // Blank resumes only: the section panel beside the canvas is what a template
        // resume adds sections from, and it isn't shown here.
        onInsertSection={freeform ? handleInsertSection : undefined}
        onTogglePanel={togglePanel}
        onCoverLetter={() => router.push(`/resumes/${resumeId}/cover-letter`)}
      />

      {saveError && (
        <div role="alert" className="border-b border-danger/20 bg-danger-wash px-4 py-2 text-center text-sm text-danger">
          {saveError} Your changes are still here &mdash; we&rsquo;ll keep retrying as you edit.
        </div>
      )}

      {/* Dismissible, unlike the save banner above: an insert that failed is over
          and done with, where an unsaved change is still outstanding. */}
      {insertError && (
        <div
          role="alert"
          className="flex items-center justify-center gap-3 border-b border-danger/20 bg-danger-wash px-4 py-2 text-center text-sm text-danger"
        >
          <span>{insertError}</span>
          <button
            type="button"
            onClick={() => setInsertError(null)}
            className="shrink-0 text-[0.75rem] underline underline-offset-2 hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {importNotice && (
        <ImportBanner notice={importNotice} onDismiss={() => setImportNotice(null)} />
      )}

      {/* One page is the default a resume should have to be talked out of, so an
          overflow says so — and offers the fix without ever applying it unasked.

          Stood down while a failed fit is on screen: that message is about this
          same overflow and says more about it, so showing both would be saying the
          same thing twice in two colours. */}
      {overflowing && !overflowDismissed && !(fitResult && !fitResult.ok) && (
        <OverflowBanner
          pageCount={pageCount}
          requestedPages={requestedPages}
          drift={templateDefaultTheme ? describeDrift(doc.theme, templateDefaultTheme) : []}
          canFit={canTighten(doc.theme, templateDefaultTheme ?? undefined)}
          onFit={handleFitToPage}
          onDismiss={() => setOverflowDismissed(true)}
        />
      )}

      {fitResult && (
        <FitResultBanner result={fitResult} onDismiss={() => setFitResult(null)} />
      )}

      {/* The other half of the same idea. Stood down whenever any spacing message is
          up: having just been told what the last fill changed, being asked again to
          fill the page reads as the button having failed. Gated on `canFill` so the
          offer is never made when the ladder has nothing left to try. */}
      {underfull && !underfullDismissed && !fitResult && (
        <UnderfullBanner
          fill={fill}
          canFill={canFill(doc.theme, templateDefaultTheme ?? undefined)}
          onFill={handleFillPage}
          onDismiss={() => setUnderfullDismissed(true)}
        />
      )}

      {/* The picker behind Insert → Image. Hidden, not absent: click() on an element
          outside the document opens nothing. */}
      <input
        ref={imageInput}
        type="file"
        accept={IMAGE_ACCEPT}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so picking the same file twice running still fires a change.
          event.target.value = "";
          if (file) void insertImageFile(file);
        }}
      />

      <div className="flex min-h-0 flex-1">
        <PageRail
          pageCount={pageCount}
          activePage={activePage}
          onSelect={(pageIndex) => canvas.current?.scrollToPage(pageIndex)}
          // A canvas's sheets exist because blocks say so, so the last one can
          // always be given back — unlike a flowed page, which only exists at all
          // if some section forced a break there.
          canRemoveLastPage={
            freeform ? pageCount > 1 : doc.content.sections.some((section) => section.pageBreakBefore)
          }
          onRemoveLastPage={() => dispatch({ type: "removeLastPage", freeform })}
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
          onAddTextItem={(sectionId, index) => dispatch({ type: "addTextItem", sectionId, index })}
          onMoveItem={onMoveItem}
          onAddPlacedItem={onAddPlacedItem}
          onResizeImage={onResizeImage}
          onImageFile={(file, at) => void insertImageFile(file, at)}
          onAddBlock={onAddBlock}
          onMoveBlock={onMoveBlock}
          onResizeBlock={onResizeBlock}
          onRemoveBlock={onRemoveBlock}
          onPagesChange={setPageCount}
          onFillChange={setFill}
          onActivePageChange={setActivePage}
        />

        {/* Formats whatever is selected inside the canvas; the header toolbar
            above keeps the document-wide equivalents. Portals to the body, so
            it's mounted here rather than nested in the canvas's scroll box. */}
        <SelectionToolbar theme={doc.theme} />

        {/* Sections are what this panel reorders, shows and hides — a canvas has
            none, so it would offer nothing but an "add section" button that adds
            something the blank template doesn't render. Feature 2's Insert Section
            picker is the canvas's answer to the same need. */}
        {!freeform && (
          <SectionPanel
            sections={doc.content.sections}
            onReorder={(fromId, toId) => dispatch({ type: "reorderSections", fromId, toId })}
            onToggle={(sectionId) => dispatch({ type: "toggleSection", sectionId })}
            onRemove={(sectionId) => dispatch({ type: "removeSection", sectionId })}
            onAdd={(sectionType: SectionType) => dispatch({ type: "addSection", sectionType })}
            onFocusSection={scrollToSection}
          />
        )}

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

/**
 * The post-import review banner.
 *
 * Not styled as an error, because nothing failed — an import is a starting point,
 * and the honest thing to say is "check this", not "something went wrong". But it
 * doesn't stop at "check this" either: when the import knows what it couldn't do,
 * it names those things, so reviewing means looking at three specific places
 * rather than re-reading the whole document suspiciously.
 *
 * `ai-assisted` gets the stronger wording. A pattern-matched miss leaves a field
 * empty, which is visible; a model's miss can be a plausible sentence that isn't
 * in the source, which is not.
 */
function ImportBanner({
  notice,
  onDismiss,
}: {
  notice: ImportNotice;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasWarnings = notice.warnings.length > 0;

  return (
    <div
      role="status"
      className="border-b border-accent/20 bg-accent-wash px-4 py-2.5 text-sm text-ink"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-center">
        <span className="text-pretty">
          <span className="font-medium">Imported from LaTeX</span> &mdash; review your
          resume below, some formatting may need adjusting.
          {notice.confidence === "ai-assisted" &&
            " This one needed AI to read, so check the wording against your original."}
        </span>

        {hasWarnings && (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
            className="shrink-0 text-[0.75rem] text-accent underline underline-offset-2 hover:no-underline"
          >
            {expanded
              ? "Hide details"
              : `What to check (${notice.warnings.length})`}
          </button>
        )}

        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-[0.75rem] text-ink-muted underline underline-offset-2 hover:text-ink hover:no-underline"
        >
          Dismiss
        </button>
      </div>

      {expanded && hasWarnings && (
        <ul className="mx-auto mt-2 max-w-5xl list-disc space-y-1 pl-5 text-left text-[0.8125rem] text-ink-muted">
          {notice.warnings.map((warning, index) => (
            <li key={index} className="text-pretty">
              {warning}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The overflow warning.
 *
 * A resume should be one page unless its author decides otherwise, so a document
 * that grew a page on its own is worth saying out loud — a second sheet is easy to
 * miss in a zoomed-out canvas, and it is the single most common reason a resume
 * gets skimmed past. But it is a warning, not a correction: nothing here changes
 * the document until the button is pressed.
 *
 * When the theme has drifted looser than the template's own settings, those are
 * named. That's the difference between "your resume is too long" — which may not
 * be true — and "your line height is 1.30 where this template sets 1.19", which
 * points at the slider that would fix it.
 */
function OverflowBanner({
  pageCount,
  requestedPages,
  drift,
  canFit,
  onFit,
  onDismiss,
}: {
  pageCount: number;
  /** Sheets the user actually asked for: one, plus any manual breaks. */
  requestedPages: number;
  drift: string[];
  canFit: boolean;
  onFit: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="border-b border-accent/20 bg-accent-wash px-4 py-2.5 text-sm text-ink"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-center">
        <span className="text-pretty">
          <span className="font-medium">
            {requestedPages === 1
              ? `This resume runs onto ${pageCount === 2 ? "a second page" : `${pageCount} pages`}.`
              : `This resume runs past the ${requestedPages} pages you set up.`}
          </span>{" "}
          {drift.length > 0
            ? `Its ${joinWords(drift)}.`
            : "One page is the usual advice, but a longer resume is your call."}
        </span>

        {canFit && (
          <button
            type="button"
            onClick={onFit}
            className="shrink-0 rounded-md bg-ink px-2.5 py-1 text-[0.75rem] font-medium text-paper transition-opacity hover:opacity-90"
          >
            {requestedPages === 1 ? "Fit to one page" : `Fit to ${requestedPages} pages`}
          </button>
        )}

        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-[0.75rem] text-ink-muted underline underline-offset-2 hover:text-ink hover:no-underline"
        >
          Keep as is
        </button>
      </div>
    </div>
  );
}

/**
 * The offer to close a band of dead space at the foot of the page.
 *
 * Worded as an observation with an option attached, not as a problem. A short
 * resume is often the right resume — a student's, a career changer's — and telling
 * someone their document is too empty would be both rude and frequently wrong. So
 * this says where the space is and offers to use it, and "Keep as is" is a real
 * answer rather than a way of silencing a complaint.
 *
 * The fraction is deliberately not shown. "84% full" invites the user to chase a
 * number that was never the point; "room for about three more lines" is the same
 * fact in terms they can act on, and rounds honestly at any width.
 */
function UnderfullBanner({
  fill,
  canFill,
  onFill,
  onDismiss,
}: {
  /** How full the sheet is, as a fraction of its usable height. */
  fill: number;
  canFill: boolean;
  onFill: () => void;
  onDismiss: () => void;
}) {
  // A page holds roughly 45 lines of body text, so the gap in lines is the shortfall
  // times that. Floored at one: the banner only shows below target, and "room for
  // about 0 more lines" would be nonsense.
  const lines = Math.max(1, Math.round((1 - fill) * 45));

  return (
    <div role="status" className="border-b border-rule bg-paper-raised px-4 py-2.5 text-sm text-ink">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-center">
        <span className="text-pretty">
          <span className="font-medium">There&rsquo;s space left on this page.</span> Room for about{" "}
          {lines === 1 ? "one more line" : `${lines} more lines`} &mdash; add to it, or let the
          spacing open up to fill it.
        </span>

        {canFill && (
          <button
            type="button"
            onClick={onFill}
            className="shrink-0 rounded-md bg-ink px-2.5 py-1 text-[0.75rem] font-medium text-paper transition-opacity hover:opacity-90"
          >
            Fill the page
          </button>
        )}

        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-md px-2.5 py-1 text-[0.75rem] font-medium text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink"
        >
          Keep as is
        </button>
      </div>
    </div>
  );
}

/** What a fit did, or why it couldn't. Dismissible; never blocks editing. */
function FitResultBanner({
  result,
  onDismiss,
}: {
  result: { ok: boolean; changes: string[] };
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className={`border-b px-4 py-2.5 text-sm ${
        result.ok ? "border-rule bg-paper-raised text-ink" : "border-danger/20 bg-danger-wash text-danger"
      }`}
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-center">
        <span className="text-pretty">
          {result.ok ? (
            <>
              <span className="font-medium">Fitted.</span>{" "}
              {result.changes.length > 0
                ? `Changed ${joinWords(result.changes)}. Ctrl+Z puts it back.`
                : "Nothing needed changing."}
            </>
          ) : (
            <>
              <span className="font-medium">This won&rsquo;t fit by spacing alone.</span> Even at
              the tightest readable settings there&rsquo;s more here than a page holds &mdash; try
              cutting a bullet or two, or keep the extra page.
            </>
          )}
        </span>

        <button
          type="button"
          onClick={onDismiss}
          className={`shrink-0 text-[0.75rem] underline underline-offset-2 hover:no-underline ${
            result.ok ? "text-ink-muted hover:text-ink" : ""
          }`}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

/** "a, b and c" — for reading a list of settings out as a sentence. */
function joinWords(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
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
