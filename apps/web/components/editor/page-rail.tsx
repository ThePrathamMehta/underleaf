"use client";

import { useEffect, useState } from "react";

/**
 * Left rail for multi-page navigation: one tab per rendered sheet, in order.
 * Click a tab to scroll that sheet into view. Only shown when a resume spans
 * more than one sheet, so single-page editing is unchanged.
 *
 * Navigation only, by design. Sheets are a consequence of how much content
 * there is — the packer decides where each one ends — so there is no durable
 * "page" to reorder or delete. Reordering and removing content happens in the
 * section panel, on the unit that actually exists.
 */
export function PageRail({
  pageCount,
  activePage,
  onSelect,
  canRemoveLastPage,
  onRemoveLastPage,
  collapseForAssistant,
}: {
  pageCount: number;
  /** Index of the sheet currently filling most of the canvas viewport. */
  activePage: number;
  onSelect: (pageIndex: number) => void;
  canRemoveLastPage: boolean;
  onRemoveLastPage: () => void;
  collapseForAssistant: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);

  // Collapse once when the Assistant opens. This is intentionally not a
  // permanently controlled state: the user can immediately reopen Pages while
  // continuing to work with the Assistant beside the canvas.
  useEffect(() => {
    if (collapseForAssistant) setCollapsed(true);
  }, [collapseForAssistant]);

  if (pageCount < 2) return null;

  if (collapsed) {
    return (
      <aside className="hidden w-10 shrink-0 border-r border-rule bg-paper lg:flex lg:flex-col lg:items-center">
        <button type="button" onClick={() => setCollapsed(false)} title="Show pages" aria-label="Show pages" className="mt-4 rounded-md p-2 text-ink-faint transition-colors hover:bg-paper-sunken hover:text-ink">
          <ChevronRightIcon />
        </button>
      </aside>
    );
  }

  return (
    <aside className="hidden w-[9.5rem] shrink-0 flex-col border-r border-rule bg-paper lg:flex">
      <div className="flex items-center justify-between px-4 pb-2 pt-5">
        <span className="font-mono text-[0.625rem] uppercase tracking-[0.14em] text-ink-faint">
          Pages
        </span>
        <button type="button" onClick={() => setCollapsed(true)} title="Hide pages" aria-label="Hide pages" className="rounded p-1 text-ink-faint transition-colors hover:text-ink">
          <ChevronLeftIcon />
        </button>
      </div>

      <nav aria-label="Pages" className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-4">
        {Array.from({ length: pageCount }, (_, index) => {
          const current = index === activePage;
          return (
            <div key={index} className="group relative">
              <button
                type="button"
                onClick={() => onSelect(index)}
                aria-current={current ? "true" : undefined}
                className={`flex w-full flex-col items-center gap-1.5 rounded-lg bg-paper-raised p-2 ring-1 ring-inset transition-colors ${
                current ? "ring-accent-ring" : "ring-rule hover:ring-rule-strong"
              }`}
              >
              {/* Mini sheet, purely indicative. */}
              <span className="flex aspect-[8.5/11] w-full items-center justify-center rounded-sm bg-white ring-1 ring-black/5">
                <span className={`font-display text-lg ${current ? "text-accent" : "text-ink-faint"}`}>
                  {index + 1}
                </span>
              </span>
              <span
                className={`font-mono text-[0.5625rem] uppercase tracking-[0.12em] ${
                  current ? "text-ink-muted" : "text-ink-faint"
                }`}
              >
                Page {index + 1}
              </span>
              </button>
              {index === pageCount - 1 && canRemoveLastPage && (
                <button type="button" onClick={onRemoveLastPage} title="Remove last page" aria-label="Remove last page" className="absolute right-2 top-2 rounded-md bg-paper-raised p-1.5 text-ink-faint opacity-0 shadow-card ring-1 ring-rule transition-all hover:text-danger group-hover:opacity-100 focus:opacity-100">
                  <TrashIcon />
                </button>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

const svg = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
function ChevronLeftIcon() { return <svg {...svg}><path d="m15 18-6-6 6-6" /></svg>; }
function ChevronRightIcon() { return <svg {...svg}><path d="m9 18 6-6-6-6" /></svg>; }
function TrashIcon() { return <svg {...svg}><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></svg>; }
