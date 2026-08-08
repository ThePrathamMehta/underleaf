"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import type { PdfDocumentDto } from "@repo/types";
import { api, ApiError } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";
import { usePdfRunAutosave } from "../../../lib/use-pdf-autosave";
import { PdfToolbar } from "../../../components/pdf-editor/toolbar";
import { PdfCanvas } from "../../../components/pdf-editor/canvas";
import { PdfPageRail } from "../../../components/pdf-editor/page-rail";
import { ButtonLink } from "../../../components/button";
import { Logo } from "../../../components/logo";

export default function PdfEditorPage({ params }: { params: Promise<{ pdfId: string }> }) {
  const { pdfId } = use(params);
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [document, setDocument] = useState<PdfDocumentDto | null>(null);
  const [title, setTitle] = useState("");
  const [titleDirty, setTitleDirty] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [activePage, setActivePage] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [ready, setReady] = useState(false);

  const { status, error: saveError, save, saveNow } = usePdfRunAutosave(pdfId);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace(`/login?next=${encodeURIComponent(`/pdf-editor/${pdfId}`)}`);
    }
  }, [authLoading, user, router, pdfId]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    api
      .pdf(pdfId)
      .then(({ document: doc }) => {
        if (cancelled) return;
        setDocument(doc);
        setTitle(doc.title);
        setReady(true);
      })
      .catch((caught) => {
        if (cancelled) return;
        setLoadError(
          caught instanceof ApiError
            ? { status: caught.status, message: caught.message }
            : { status: 0, message: "Could not load this PDF." },
        );
      });

    return () => {
      cancelled = true;
    };
  }, [user, pdfId]);

  /** How many runs fell back to an approximate font — surfaced once, not per run. */
  const fallbackCount = useMemo(
    () =>
      document?.pages.reduce(
        (total, page) => total + page.runs.filter((run) => run.fontSource === "fallback").length,
        0,
      ) ?? 0,
    [document],
  );

  async function handleTitleCommit() {
    if (!titleDirty) return;
    setTitleDirty(false);

    try {
      await api.updatePdfTitle(pdfId, { title });
    } catch {
      // Low-stakes next to run text; the next commit retries.
      setTitleDirty(true);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      // Flush first: the export redraws from the saved rows, so an unsaved edit
      // would silently be missing from the file the user downloads.
      await saveNow();
      window.location.assign(api.pdfExportUrl(pdfId));
    } finally {
      // The navigation is a file download, so this page stays mounted.
      setTimeout(() => setExporting(false), 1500);
    }
  }

  const handleBack = useCallback(() => {
    if (status === "pending" || status === "saving") {
      const leave = window.confirm(
        "You have unsaved changes. Leave without saving? We'll keep saving in the background, but the latest edits may not have finished.",
      );
      if (!leave) return;
    }
    router.push("/dashboard");
  }, [status, router]);

  const scrollToPage = useCallback((pageIndex: number) => {
    window.document
      .querySelector(`[data-pdf-page="${pageIndex}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  if (loadError) {
    return (
      <ErrorScreen
        title={loadError.status === 404 ? "We couldn't find that PDF" : "Something went wrong"}
        message={
          loadError.status === 404
            ? "It may have been deleted, or it belongs to another account."
            : loadError.message
        }
      />
    );
  }

  if (!ready || !document) return <LoadingScreen />;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-paper">
      <PdfToolbar
        title={title}
        status={status}
        zoom={zoom}
        pageCount={document.pageCount}
        activePage={activePage}
        exporting={exporting}
        onTitleChange={(next) => {
          setTitle(next);
          setTitleDirty(true);
        }}
        onTitleCommit={() => void handleTitleCommit()}
        onZoomChange={(next) => setZoom(Math.min(2, Math.max(0.5, Number(next.toFixed(2)))))}
        onGoToPage={scrollToPage}
        onExport={() => void handleExport()}
        onBack={handleBack}
      />

      {saveError && (
        <div
          role="alert"
          className="border-b border-danger/20 bg-danger-wash px-4 py-2 text-center text-sm text-danger"
        >
          {saveError} Your changes are still here &mdash; we&rsquo;ll keep retrying as you edit.
        </div>
      )}

      {/* Honest, non-blocking, and stated once. Per-run the same information is
          carried by the dotted underline the canvas draws on those runs. */}
      {fallbackCount > 0 && (
        <div className="border-b border-rule bg-paper-sunken px-4 py-2 text-center text-[0.8125rem] text-ink-muted">
          Exact fonts couldn&rsquo;t be preserved for{" "}
          <span className="text-ink">
            {fallbackCount} {fallbackCount === 1 ? "line" : "lines"}
          </span>{" "}
          &mdash; those are underlined below and use a close match.
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {document.pages.length > 1 && (
          <PdfPageRail
            pages={document.pages}
            activePage={activePage}
            onSelect={(pageIndex) => {
              setActivePage(pageIndex);
              scrollToPage(pageIndex);
            }}
          />
        )}

        <PdfCanvas
          document={document}
          zoom={zoom}
          onRunEdit={save}
          onActivePageChange={setActivePage}
        />
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
        Back to your documents
      </ButtonLink>
    </div>
  );
}
