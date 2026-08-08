"use client";

import { Button } from "../button";
import { Logo } from "../logo";
import { ThemeToggle } from "../theme-toggle";
import { IconButton, ToolbarDivider } from "../editor/controls";
import { UserMenu } from "../editor/user-menu";
import type { SaveStatus } from "../../lib/use-autosave";

/**
 * Chrome for the PDF editor.
 *
 * Deliberately a sibling of `EditorToolbar` rather than a variant of it: that
 * one's whole second row is document formatting (typeface, colour, spacing,
 * template), and none of it applies here — a PDF-edit session inherits every
 * one of those from the source file. What's left is identity, navigation and
 * export, which fits one row.
 */
export function PdfToolbar({
  title,
  status,
  zoom,
  pageCount,
  activePage,
  exporting,
  onTitleChange,
  onTitleCommit,
  onZoomChange,
  onGoToPage,
  onExport,
  onBack,
}: {
  title: string;
  status: SaveStatus;
  zoom: number;
  pageCount: number;
  activePage: number;
  exporting: boolean;
  onTitleChange: (title: string) => void;
  onTitleCommit: () => void;
  onZoomChange: (zoom: number) => void;
  onGoToPage: (pageIndex: number) => void;
  onExport: () => void;
  onBack: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-paper/85 backdrop-blur-md">
      <div className="flex h-14 items-center gap-3 px-4">
        <button type="button" onClick={onBack} className="shrink-0" aria-label="Back to dashboard">
          <Logo className="h-6 w-auto" />
        </button>

        <div className="mx-1 h-5 w-px shrink-0 bg-rule" aria-hidden />

        <input
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          onBlur={onTitleCommit}
          aria-label="PDF title"
          className="min-w-0 flex-1 truncate rounded-md bg-transparent px-2 py-1 font-display text-lg tracking-tight outline-none transition-colors hover:bg-paper-sunken focus:bg-paper-sunken"
        />

        <SaveIndicator status={status} />

        {pageCount > 1 && (
          <>
            <ToolbarDivider />
            <div className="flex shrink-0 items-center gap-0.5">
              <IconButton
                label="Previous page"
                onClick={() => onGoToPage(activePage - 1)}
                disabled={activePage <= 0}
              >
                <ChevronIcon className="rotate-90" />
              </IconButton>
              <span className="min-w-[4.5rem] text-center font-mono text-[0.6875rem] tabular-nums text-ink-muted">
                {activePage + 1} / {pageCount}
              </span>
              <IconButton
                label="Next page"
                onClick={() => onGoToPage(activePage + 1)}
                disabled={activePage >= pageCount - 1}
              >
                <ChevronIcon className="-rotate-90" />
              </IconButton>
            </div>
          </>
        )}

        <ToolbarDivider />

        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton label="Zoom out" onClick={() => onZoomChange(zoom - 0.1)} disabled={zoom <= 0.5}>
            <MinusIcon />
          </IconButton>
          <button
            type="button"
            onClick={() => onZoomChange(1)}
            title="Reset zoom"
            className="h-8 min-w-[3.25rem] rounded-md px-1 font-mono text-[0.6875rem] tabular-nums text-ink-muted transition-colors hover:bg-paper-sunken hover:text-ink"
          >
            {Math.round(zoom * 100)}%
          </button>
          <IconButton label="Zoom in" onClick={() => onZoomChange(zoom + 0.1)} disabled={zoom >= 2}>
            <PlusIcon />
          </IconButton>
        </div>

        <ThemeToggle />
        <UserMenu />

        <Button size="sm" onClick={onExport} disabled={exporting}>
          {exporting ? "Preparing…" : "Export PDF"}
        </Button>
      </div>
    </header>
  );
}

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: "",
  pending: "Unsaved",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed",
};

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "idle") return null;

  return (
    <span
      role="status"
      aria-live="polite"
      className={`hidden shrink-0 items-center gap-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.1em] sm:inline-flex ${
        status === "error" ? "text-danger" : "text-ink-faint"
      }`}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${
          status === "saving"
            ? "animate-pulse bg-ink-faint"
            : status === "saved"
              ? "bg-positive"
              : status === "error"
                ? "bg-danger"
                : "bg-ink-faint/50"
        }`}
      />
      {STATUS_TEXT[status]}
    </span>
  );
}

const svg = {
  width: 15,
  height: 15,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function MinusIcon() {
  return (
    <svg {...svg}>
      <path d="M5 12h14" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg {...svg}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg {...svg} className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
