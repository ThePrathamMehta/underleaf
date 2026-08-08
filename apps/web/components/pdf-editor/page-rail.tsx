"use client";

import type { PdfPageDto } from "@repo/types";
import { api } from "../../lib/api";

/**
 * Thumbnail navigation for a multi-page upload.
 *
 * A sibling of the resume editor's `PageRail` rather than a reuse of it: that
 * one's items are reorderable and removable because a resume's pages are ours to
 * restructure. An uploaded PDF's pages are fixed — the whole feature rests on not
 * moving things — so this rail only navigates.
 *
 * The thumbnails are the same backdrop images the canvas uses, so they cost
 * nothing extra: the browser has them cached from the page render, and the
 * immutable cache headers mean even a fresh load fetches each one once.
 */
export function PdfPageRail({
  pages,
  activePage,
  onSelect,
}: {
  pages: PdfPageDto[];
  activePage: number;
  onSelect: (pageIndex: number) => void;
}) {
  return (
    <nav
      aria-label="Pages"
      className="hidden w-[7.5rem] shrink-0 overflow-y-auto border-r border-rule bg-paper px-3 py-4 lg:block"
    >
      <ul className="space-y-3">
        {pages.map((page) => {
          const isActive = page.pageIndex === activePage;

          return (
            <li key={page.id}>
              <button
                type="button"
                onClick={() => onSelect(page.pageIndex)}
                aria-current={isActive ? "true" : undefined}
                className="block w-full text-left"
              >
                <span
                  className={`block overflow-hidden rounded-sm bg-white ring-1 transition-all duration-200 ${
                    isActive
                      ? "ring-2 ring-accent"
                      : "ring-rule hover:ring-rule-strong"
                  }`}
                  style={{ aspectRatio: `${page.width} / ${page.height}` }}
                >
                  {/* Plain `img` for the same reason as the canvas: these are
                      owner-scoped bytes that next/image's server-side fetch
                      would request without the auth cookie. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={api.assetUrl(page.backgroundImageUrl)}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    className="h-full w-full select-none object-contain"
                  />
                </span>
                <span
                  className={`mt-1.5 block text-center font-mono text-[0.625rem] tabular-nums transition-colors ${
                    isActive ? "text-accent" : "text-ink-faint"
                  }`}
                >
                  {page.pageIndex + 1}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
