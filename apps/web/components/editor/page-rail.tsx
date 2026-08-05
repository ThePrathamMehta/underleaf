"use client";

import { useState } from "react";
import { Reorder, useDragControls } from "framer-motion";
import type { ResumeContent } from "@repo/types";
import { splitSectionsIntoPages } from "@repo/types";

/**
 * Left rail for multi-page navigation: one tab per printed page, in order.
 * Click a tab to scroll that page into view; drag the handle to reorder pages;
 * delete removes a page (confirming first when it holds content). Only shown
 * when a resume spans more than one page, so single-page editing is unchanged.
 */
export function PageRail({
  content,
  onMovePage,
  onRemovePage,
}: {
  content: ResumeContent;
  onMovePage: (from: number, to: number) => void;
  onRemovePage: (pageIndex: number) => void;
}) {
  const pageGroups = splitSectionsIntoPages(content);
  if (pageGroups.length < 2) return null;

  // Stable keys for reordering: use the id of each page's first section.
  const pages = pageGroups.map((ids, index) => ({
    key: ids[0] ?? `page-${index}`,
    index,
    ids,
  }));

  function scrollToPage(index: number) {
    document
      .querySelector(`[data-page-index="${index}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /** A page counts as having content if any of its sections has an item. */
  function pageHasContent(ids: string[]): boolean {
    const set = new Set(ids);
    return content.sections.some((s) => set.has(s.id) && s.items.length > 0);
  }

  return (
    <aside className="hidden w-[9.5rem] shrink-0 flex-col border-r border-rule bg-paper lg:flex">
      <div className="px-4 pb-2 pt-5">
        <span className="font-mono text-[0.625rem] uppercase tracking-[0.14em] text-ink-faint">
          Pages
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <Reorder.Group
          axis="y"
          values={pages}
          onReorder={(next: typeof pages) => {
            const from = next.findIndex((p, i) => p.key !== pages[i]?.key);
            if (from === -1) return;
            const to = pages.findIndex((p) => p.key === next[from]?.key);
            if (to !== -1 && from !== to) onMovePage(pages[from]!.index, to);
          }}
          className="space-y-2"
        >
          {pages.map((page) => (
            <PageTab
              key={page.key}
              page={page}
              canDelete={pages.length > 1}
              hasContent={pageHasContent(page.ids)}
              onSelect={() => scrollToPage(page.index)}
              onRemove={() => onRemovePage(page.index)}
            />
          ))}
        </Reorder.Group>
      </div>
    </aside>
  );
}

function PageTab({
  page,
  canDelete,
  hasContent,
  onSelect,
  onRemove,
}: {
  page: { key: string; index: number; ids: string[] };
  canDelete: boolean;
  hasContent: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const controls = useDragControls();
  const [confirming, setConfirming] = useState(false);

  function handleRemove() {
    if (hasContent && !confirming) {
      setConfirming(true);
      return;
    }
    onRemove();
    setConfirming(false);
  }

  return (
    <Reorder.Item
      value={page}
      dragListener={false}
      dragControls={controls}
      layout
      transition={{ type: "spring", stiffness: 520, damping: 38 }}
      whileDrag={{ scale: 1.03, zIndex: 10 }}
      className="group list-none"
    >
      <div className="relative">
        <button
          type="button"
          onClick={onSelect}
          onPointerDown={(event) => controls.start(event)}
          className="flex w-full cursor-grab flex-col items-center gap-1.5 rounded-lg bg-paper-raised p-2 ring-1 ring-inset ring-rule transition-colors hover:ring-rule-strong active:cursor-grabbing"
        >
          {/* Mini sheet, purely indicative. */}
          <span className="flex aspect-[8.5/11] w-full items-center justify-center rounded-sm bg-white ring-1 ring-black/5">
            <span className="font-display text-lg text-ink-faint">{page.index + 1}</span>
          </span>
          <span className="font-mono text-[0.5625rem] uppercase tracking-[0.12em] text-ink-faint">
            Page {page.index + 1}
          </span>
        </button>

        {canDelete && (
          <button
            type="button"
            onClick={handleRemove}
            onBlur={() => setConfirming(false)}
            title={confirming ? "Click again to confirm" : "Delete page"}
            aria-label={`Delete page ${page.index + 1}`}
            className={`absolute right-1 top-1 inline-flex h-6 items-center justify-center rounded-md px-1.5 text-ink-faint opacity-0 shadow-card ring-1 ring-rule transition-all group-hover:opacity-100 ${
              confirming ? "bg-danger text-white opacity-100" : "bg-paper-raised hover:text-danger"
            }`}
          >
            {confirming ? <span className="text-[0.625rem]">Sure?</span> : <TrashIcon />}
          </button>
        )}
      </div>
    </Reorder.Item>
  );
}

function TrashIcon() {
  return (
    <svg
      width={13}
      height={13}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
    </svg>
  );
}
