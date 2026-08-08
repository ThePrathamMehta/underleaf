"use client";

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
}: {
  pageCount: number;
  /** Index of the sheet currently filling most of the canvas viewport. */
  activePage: number;
  onSelect: (pageIndex: number) => void;
}) {
  if (pageCount < 2) return null;

  return (
    <aside className="hidden w-[9.5rem] shrink-0 flex-col border-r border-rule bg-paper lg:flex">
      <div className="px-4 pb-2 pt-5">
        <span className="font-mono text-[0.625rem] uppercase tracking-[0.14em] text-ink-faint">
          Pages
        </span>
      </div>

      <nav aria-label="Pages" className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-4">
        {Array.from({ length: pageCount }, (_, index) => {
          const current = index === activePage;
          return (
            <button
              key={index}
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
          );
        })}
      </nav>
    </aside>
  );
}
