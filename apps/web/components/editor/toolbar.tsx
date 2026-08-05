"use client";

import type { PageSize, Theme } from "@repo/types";
import { FONT_FAMILIES } from "@repo/types";
import { Button } from "../button";
import { Logo } from "../logo";
import type { SaveStatus } from "../../lib/use-autosave";
import { FieldLabel, IconButton, Popover, Segmented, Slider, SwatchRow, ToolbarDivider } from "./controls";
import { UserMenu } from "./user-menu";
import { ThemeToggle } from "../theme-toggle";

/** Human labels for the closed font enum; keys must match FONT_FAMILIES. */
export const FONT_LABELS: Record<Theme["fontFamily"], string> = {
  inter: "Inter",
  lato: "Lato",
  roboto: "Roboto",
  "source-serif": "Source Serif",
  "eb-garamond": "EB Garamond",
  merriweather: "Merriweather",
};

/**
 * Restrained, print-safe palette. Resumes are read by hiring teams and often
 * printed in greyscale, so these are deep and legible rather than vivid — the
 * app's own personality lives in the chrome, not the document.
 */
const ACCENT_COLORS = [
  "#1a1a1a",
  "#1e3a5f",
  "#14532d",
  "#7f1d1d",
  "#4c1d95",
  "#0f766e",
  "#9a3412",
  "#374151",
] as const;

const TEXT_COLORS = ["#1a1a1a", "#000000", "#27272a", "#334155", "#3f3f46"] as const;

const PAGE_SIZE_OPTIONS = [
  { value: "letter" as PageSize, label: "Letter" },
  { value: "a4" as PageSize, label: "A4" },
];

export function EditorToolbar({
  title,
  theme,
  status,
  canUndo,
  canRedo,
  zoom,
  templateSlug,
  templates,
  exporting,
  onTitleChange,
  onTitleCommit,
  onThemeChange,
  onThemeCommit,
  onUndo,
  onRedo,
  onZoomChange,
  onTemplateChange,
  onExport,
  onBack,
  onAddPage,
}: {
  title: string;
  theme: Theme;
  status: SaveStatus;
  canUndo: boolean;
  canRedo: boolean;
  zoom: number;
  templateSlug: string;
  templates: { id: string; slug: string; name: string }[];
  exporting: boolean;
  onTitleChange: (title: string) => void;
  onTitleCommit: () => void;
  onThemeChange: (patch: Partial<Theme>) => void;
  onThemeCommit: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomChange: (zoom: number) => void;
  onTemplateChange: (slug: string) => void;
  onExport: () => void;
  onBack: () => void;
  onAddPage: () => void;
}) {
  const activeTemplate = templates.find((t) => t.slug === templateSlug);

  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-paper/85 backdrop-blur-md">
      {/* Row 1 — document identity and destination-level actions. */}
      <div className="flex h-14 items-center gap-3 px-4">
        <button type="button" onClick={onBack} className="shrink-0" aria-label="Back to dashboard">
          <Logo className="h-6 w-auto" />
        </button>

        <div className="mx-1 h-5 w-px shrink-0 bg-rule" aria-hidden />

        <input
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          onBlur={onTitleCommit}
          aria-label="Resume title"
          className="min-w-0 flex-1 truncate rounded-md bg-transparent px-2 py-1 font-display text-lg tracking-tight outline-none transition-colors hover:bg-paper-sunken focus:bg-paper-sunken"
        />

        <SaveIndicator status={status} />

        <ThemeToggle />
        <UserMenu />

        <Button size="sm" onClick={onExport} disabled={exporting}>
          {exporting ? "Preparing…" : "Export PDF"}
        </Button>
      </div>

      {/* Row 2 — document formatting. Scrolls horizontally on a narrow window;
          its scrollbar is hidden because it would sit across the buttons. */}
      <div className="scrollbar-none flex h-12 items-center gap-1 overflow-x-auto border-t border-rule px-4">
        <IconButton label="Undo" onClick={onUndo} disabled={!canUndo}>
          <UndoIcon />
        </IconButton>
        <IconButton label="Redo" onClick={onRedo} disabled={!canRedo}>
          <RedoIcon className="scale-x-[-1]" />
        </IconButton>

        <ToolbarDivider />

        {/* Font and color apply to the whole document. Per-selection formatting
            (bold/italic/underline on a single word, per-run colour) lives in the
            SelectionToolbar mounted in the editor page. */}

        {/* Typeface */}
        <Popover
          width={300}
          trigger={({ open, toggle }) => (
            <TriggerButton open={open} onClick={toggle}>
              <span className="font-medium">{FONT_LABELS[theme.fontFamily]}</span>
            </TriggerButton>
          )}
        >
          {() => (
            <div className="space-y-4">
              <FontPicker
                label="Body"
                value={theme.fontFamily}
                onChange={(fontFamily) => onThemeChange({ fontFamily })}
              />
              <FontPicker
                label="Headings"
                value={theme.headingFontFamily}
                onChange={(headingFontFamily) => onThemeChange({ headingFontFamily })}
              />
            </div>
          )}
        </Popover>

        {/* Type scale */}
        <Popover
          width={240}
          trigger={({ open, toggle }) => (
            <TriggerButton open={open} onClick={toggle}>
              <TypeSizeIcon />
              <span className="tabular-nums">{Math.round(theme.fontSizeScale * 100)}%</span>
            </TriggerButton>
          )}
        >
          {() => (
            <Slider
              label="Text size"
              value={theme.fontSizeScale}
              min={0.8}
              max={1.3}
              step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(fontSizeScale) => onThemeChange({ fontSizeScale })}
              onCommit={onThemeCommit}
            />
          )}
        </Popover>

        {/* Color */}
        <Popover
          width={230}
          trigger={({ open, toggle }) => (
            <TriggerButton open={open} onClick={toggle}>
              <span
                className="h-3.5 w-3.5 rounded-full ring-1 ring-inset ring-black/15"
                style={{ background: theme.accentColor }}
              />
              <span>Color</span>
            </TriggerButton>
          )}
        >
          {() => (
            <div className="space-y-4">
              <SwatchRow
                label="Accent"
                colors={ACCENT_COLORS}
                value={theme.accentColor}
                onChange={(accentColor) => onThemeChange({ accentColor })}
              />
              <SwatchRow
                label="Body text"
                colors={TEXT_COLORS}
                value={theme.textColor}
                onChange={(textColor) => onThemeChange({ textColor })}
              />
            </div>
          )}
        </Popover>

        {/* Spacing */}
        <Popover
          width={250}
          trigger={({ open, toggle }) => (
            <TriggerButton open={open} onClick={toggle}>
              <SpacingIcon />
              <span>Spacing</span>
            </TriggerButton>
          )}
        >
          {() => (
            <div className="space-y-4">
              <Slider
                label="Line height"
                value={theme.lineSpacing}
                min={1}
                max={2}
                step={0.05}
                format={(v) => v.toFixed(2)}
                onChange={(lineSpacing) => onThemeChange({ lineSpacing })}
                onCommit={onThemeCommit}
              />
              <Slider
                label="Page margin"
                value={theme.marginSize}
                min={8}
                max={30}
                step={0.5}
                format={(v) => `${v} mm`}
                onChange={(marginSize) => onThemeChange({ marginSize })}
                onCommit={onThemeCommit}
              />
            </div>
          )}
        </Popover>

        <ToolbarDivider />

        {/* Template switcher — content is template-agnostic, so this is lossless. */}
        <Popover
          width={230}
          trigger={({ open, toggle }) => (
            <TriggerButton open={open} onClick={toggle}>
              <LayoutIcon />
              <span className="max-w-[10ch] truncate">{activeTemplate?.name ?? "Template"}</span>
            </TriggerButton>
          )}
        >
          {(close) => (
            <div className="space-y-0.5">
              <div className="px-1 pb-2">
                <FieldLabel>Template</FieldLabel>
              </div>
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => {
                    onTemplateChange(template.slug);
                    close();
                  }}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                    template.slug === templateSlug
                      ? "bg-accent-wash text-accent"
                      : "text-ink-muted hover:bg-paper-sunken hover:text-ink"
                  }`}
                >
                  {template.name}
                  {template.slug === templateSlug && <CheckIcon />}
                </button>
              ))}
            </div>
          )}
        </Popover>

        <Segmented
          options={PAGE_SIZE_OPTIONS}
          value={theme.pageSize}
          onChange={(pageSize) => onThemeChange({ pageSize })}
        />

        <ToolbarDivider />

        <button
          type="button"
          onClick={onAddPage}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[0.8125rem] text-ink-muted transition-colors duration-150 hover:bg-paper-sunken hover:text-ink"
        >
          <AddPageIcon />
          <span>Add page</span>
        </button>

        <ToolbarDivider />

        <div className="flex items-center gap-0.5">
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
      </div>
    </header>
  );
}

function TriggerButton({
  open,
  onClick,
  children,
}: {
  open: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[0.8125rem] transition-colors duration-150 ${
        open ? "bg-paper-sunken text-ink" : "text-ink-muted hover:bg-paper-sunken hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function FontPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Theme["fontFamily"];
  onChange: (value: Theme["fontFamily"]) => void;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="mt-2 grid grid-cols-2 gap-1">
        {FONT_FAMILIES.map((family) => (
          <button
            key={family}
            type="button"
            onClick={() => onChange(family)}
            // Previewed in the actual vendored face, so the choice is honest.
            style={{ fontFamily: `'Underleaf ${FONT_LABELS[family]}', serif` }}
            className={`rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
              value === family
                ? "bg-ink text-paper"
                : "text-ink-muted hover:bg-paper-sunken hover:text-ink"
            }`}
          >
            {FONT_LABELS[family]}
          </button>
        ))}
      </div>
    </div>
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

// --- Icons (stroked, 1.5px, to match the app's drawn-not-filled feel) ---

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

function UndoIcon({ className }: { className?: string }) {
  return (
    <svg {...svg} className={className}>
      <path d="M3 7v6h6" />
      <path d="M3 13a9 9 0 1 0 3-7.7L3 8" />
    </svg>
  );
}

function RedoIcon({ className }: { className?: string }) {
  return <UndoIcon className={className} />;
}

function TypeSizeIcon() {
  return (
    <svg {...svg}>
      <path d="M4 7V5h9v2M8.5 5v14M6 19h5" />
      <path d="M14 12v-1h6v1M17 11v8M15.5 19h3" />
    </svg>
  );
}

function SpacingIcon() {
  return (
    <svg {...svg}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function LayoutIcon() {
  return (
    <svg {...svg}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg {...svg} width={13} height={13}>
      <path d="m5 12 4.5 4.5L19 7" />
    </svg>
  );
}

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

function AddPageIcon() {
  return (
    <svg {...svg}>
      <path d="M13 3H7a2 2 0 0 0-2 2v9" />
      <path d="M13 3v5h5" />
      <path d="M18 8v5" />
      <path d="M8.5 19H2.5M5.5 16v6" />
    </svg>
  );
}
