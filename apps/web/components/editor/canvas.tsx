"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { ResumeContent, Theme } from "@repo/types";
import { pageCount } from "@repo/types";
import { ResumeDocument, ResumeEditingProvider, type FieldPath } from "@repo/ui/resume";
import { PAGE_DIMENSIONS } from "@repo/ui/resume/styles";

const MM_TO_PX = 96 / 25.4;
/** Screen gap between stacked page sheets, matching the CSS in themeToCss. */
const PAGE_GAP_MM = 6;

/**
 * How far left of the page the per-item actions sit, and how wide their column
 * is. The overlay pads itself back to the page edge with the difference, so the
 * pointer crosses no dead gap on its way to the buttons.
 */
const ITEM_ACTION_OFFSET = 38;
const ITEM_ACTION_WIDTH = 24;

/**
 * Grace period before hover actions disappear.
 *
 * Travelling from the entry to its buttons means leaving the page element, and
 * clearing on that instant made the buttons impossible to click — they vanished
 * as the pointer arrived.
 */
const HOVER_CLEAR_MS = 260;

type Anchor = { top: number; left: number; width: number; height: number };

/**
 * The document canvas.
 *
 * The page keeps its true mm geometry and only the wrapper is scaled, so zoom
 * never changes what the PDF will measure. Contextual controls float in an
 * overlay measured from the DOM rather than being nested inside the page, which
 * keeps non-printing chrome out of the rendered document entirely.
 */
export function EditorCanvas({
  templateSlug,
  content,
  theme,
  zoom,
  focusedSectionId,
  onFieldChange,
  onFieldCommit,
  onFocusSection,
  onAddItem,
  onRemoveItem,
  onAddBullet,
}: {
  templateSlug: string;
  content: ResumeContent;
  theme: Theme;
  zoom: number;
  focusedSectionId: string | null;
  onFieldChange: (path: FieldPath, value: string) => void;
  onFieldCommit: () => void;
  onFocusSection: (id: string | null) => void;
  onAddItem: (sectionId: string) => void;
  onRemoveItem: (sectionId: string, itemId: string) => void;
  onAddBullet: (sectionId: string, itemId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [sectionAnchor, setSectionAnchor] = useState<Anchor | null>(null);
  const [hoveredItem, setHoveredItem] = useState<{ id: string; anchor: Anchor } | null>(null);
  const hoverClearRef = useRef<number | null>(null);

  const page = PAGE_DIMENSIONS[theme.pageSize];
  const pageWidthPx = page.width * MM_TO_PX;
  const pageHeightPx = page.height * MM_TO_PX;
  // Reserve height for every page plus the on-screen gaps between them; the
  // transform doesn't affect flow, so the wrapper must account for the stack.
  const pages = pageCount(content);
  const stackHeightPx = pages * pageHeightPx + (pages - 1) * PAGE_GAP_MM * MM_TO_PX;

  /** Converts a client rect into coordinates within the scrolling container. */
  const toLocal = useCallback((rect: DOMRect): Anchor => {
    const container = scrollRef.current!;
    const base = container.getBoundingClientRect();
    return {
      top: rect.top - base.top + container.scrollTop,
      left: rect.left - base.left + container.scrollLeft,
      width: rect.width,
      // Without this the overlay box collapsed to zero height, which put the
      // focus ring and the "Add entry" button over the section heading instead
      // of around and below the section.
      height: rect.height,
    };
  }, []);

  const cancelHoverClear = useCallback(() => {
    if (hoverClearRef.current === null) return;
    window.clearTimeout(hoverClearRef.current);
    hoverClearRef.current = null;
  }, []);

  const scheduleHoverClear = useCallback(() => {
    cancelHoverClear();
    hoverClearRef.current = window.setTimeout(() => setHoveredItem(null), HOVER_CLEAR_MS);
  }, [cancelHoverClear]);

  useEffect(() => cancelHoverClear, [cancelHoverClear]);

  // Re-measure whenever the focused section, content or zoom changes — all three
  // can move the anchor, and a stale overlay points at the wrong place.
  useLayoutEffect(() => {
    if (!focusedSectionId || !scrollRef.current) {
      setSectionAnchor(null);
      return;
    }

    const element = pageRef.current?.querySelector(`[data-section-id="${focusedSectionId}"]`);
    setSectionAnchor(element ? toLocal(element.getBoundingClientRect()) : null);
  }, [focusedSectionId, content, zoom, theme, toLocal]);

  // Clicking away from the page clears the selection.
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement;
      if (target.closest("[data-canvas-overlay]") || pageRef.current?.contains(target)) return;
      onFocusSection(null);
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onFocusSection]);

  const focusedSection = content.sections.find((s) => s.id === focusedSectionId) ?? null;
  // Summary sections hold at most one item, so offering "add entry" would only
  // produce a value the schema rejects.
  const canAddItem = focusedSection !== null && focusedSection.type !== "summary";

  function handleCanvasPointerOver(event: React.PointerEvent) {
    const itemEl = (event.target as HTMLElement).closest<HTMLElement>("[data-item-id]");
    if (!itemEl || !scrollRef.current) {
      // Still inside the page, just between entries — give the same grace as
      // leaving it, so crossing a gap doesn't dismiss the buttons.
      scheduleHoverClear();
      return;
    }
    cancelHoverClear();
    setHoveredItem({ id: itemEl.dataset.itemId!, anchor: toLocal(itemEl.getBoundingClientRect()) });
  }

  function handleCanvasFocusIn(event: React.FocusEvent) {
    const sectionEl = (event.target as HTMLElement).closest<HTMLElement>("[data-section-id]");
    if (sectionEl) onFocusSection(sectionEl.dataset.sectionId!);
  }

  const hoveredItemSection = hoveredItem
    ? content.sections.find((s) => s.items.some((item) => item.id === hoveredItem.id))
    : null;
  const hoveredItemSupportsBullets =
    hoveredItemSection !== null &&
    hoveredItemSection !== undefined &&
    hoveredItemSection.type !== "summary" &&
    hoveredItemSection.type !== "skills" &&
    hoveredItemSection.type !== "certifications";

  return (
    <div
      ref={scrollRef}
      className="scrollbar-on-dark relative min-h-0 flex-1 overflow-auto bg-canvas"
    >
      {/* Faint grid, so the page reads as a sheet resting on a surface. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(var(--canvas-grid) 1px, transparent 1px), linear-gradient(90deg, var(--canvas-grid) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      <div className="relative flex justify-center px-10 py-12">
        <div
          style={{
            width: pageWidthPx * zoom,
            // Reserve the scaled height of the whole page stack; the transform
            // alone doesn't affect flow.
            height: stackHeightPx * zoom,
          }}
        >
          <div
            ref={pageRef}
            onPointerOver={handleCanvasPointerOver}
            onPointerLeave={scheduleHoverClear}
            onFocus={handleCanvasFocusIn}
            style={{
              width: pageWidthPx,
              transform: `scale(${zoom})`,
              transformOrigin: "top left",
            }}
            // Per-sheet shadow lives on each .rd-page (see canvas page styles),
            // so multi-page stacks show a shadow around every sheet.
            className="rd-canvas-host"
          >
            <ResumeEditingProvider value={{ onFieldChange, onFieldCommit }}>
              <ResumeDocument templateSlug={templateSlug} content={content} theme={theme} />
            </ResumeEditingProvider>
          </div>
        </div>
      </div>

      {/* Overlay: never inside .rd-page, so it can't reach the PDF. */}
      <AnimatePresence>
        {sectionAnchor && focusedSection && (
          <motion.div
            key={focusedSection.id}
            data-canvas-overlay
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="pointer-events-none absolute z-10"
            style={{
              top: sectionAnchor.top,
              left: sectionAnchor.left,
              width: sectionAnchor.width,
              height: sectionAnchor.height,
            }}
          >
            <div
              className="absolute -inset-x-2 -inset-y-1.5 rounded-md ring-1 ring-accent-ring"
              aria-hidden
            />
            {canAddItem && (
              <button
                type="button"
                onClick={() => onAddItem(focusedSection.id)}
                className="pointer-events-auto absolute -bottom-3.5 left-0 inline-flex h-7 items-center gap-1.5 rounded-full bg-paper-raised px-2.5 text-[0.75rem] text-ink-muted shadow-card ring-1 ring-rule transition-colors hover:text-accent"
              >
                <PlusIcon /> Add entry
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {hoveredItem && hoveredItemSection && (
          <motion.div
            key={hoveredItem.id}
            data-canvas-overlay
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -4 }}
            transition={{ duration: 0.12 }}
            // Keeping the pointer here keeps the buttons alive; the strip runs
            // the full height of the entry and all the way back to the page
            // edge, so there's a continuous hover path from text to button.
            onPointerEnter={cancelHoverClear}
            onPointerLeave={scheduleHoverClear}
            className="absolute z-10 flex flex-col items-start gap-1"
            style={{
              top: hoveredItem.anchor.top,
              left: hoveredItem.anchor.left - ITEM_ACTION_OFFSET,
              minHeight: hoveredItem.anchor.height,
              // The bridge: padding, not margin, so it's part of the hover area.
              paddingRight: ITEM_ACTION_OFFSET - ITEM_ACTION_WIDTH,
            }}
          >
            {hoveredItemSupportsBullets && (
              <ItemAction
                label="Add bullet"
                onClick={() => onAddBullet(hoveredItemSection.id, hoveredItem.id)}
              >
                <PlusIcon />
              </ItemAction>
            )}
            <ItemAction
              label="Delete entry"
              danger
              onClick={() => {
                onRemoveItem(hoveredItemSection.id, hoveredItem.id);
                cancelHoverClear();
                setHoveredItem(null);
              }}
            >
              <TrashIcon />
            </ItemAction>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ItemAction({
  label,
  danger = false,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md bg-paper-raised text-ink-faint shadow-card ring-1 ring-rule transition-colors ${
        danger ? "hover:text-danger" : "hover:text-accent"
      }`}
    >
      {children}
    </button>
  );
}

const svg = {
  width: 13,
  height: 13,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function PlusIcon() {
  return (
    <svg {...svg}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg {...svg} strokeWidth={1.75}>
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
    </svg>
  );
}
