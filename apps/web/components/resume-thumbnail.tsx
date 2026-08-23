"use client";

import { useEffect, useRef, useState } from "react";
import type { ResumeContent, Theme } from "@repo/types";
import { ResumeDocument } from "@repo/ui/resume";
import { PAGE_DIMENSIONS } from "@repo/ui/resume/styles";

const MM_TO_PX = 96 / 25.4;

/**
 * Renders a real resume at reduced scale inside a fixed-aspect box.
 *
 * Uses the actual renderer rather than a screenshot so thumbnails can never
 * drift from what the editor produces, and so previews stay crisp at any size.
 * The page itself keeps its mm geometry — only the wrapper is transformed.
 */
export function ResumeThumbnail({
  templateSlug,
  content,
  theme,
  className = "",
}: {
  templateSlug: string;
  content: ResumeContent;
  theme: Theme;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  const page = PAGE_DIMENSIONS[theme.pageSize];
  const pageWidthPx = page.width * MM_TO_PX;
  const pageHeightPx = page.height * MM_TO_PX;

  // Scale to whatever width the card gives us, remeasured on resize.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      if (width > 0) setScale(width / pageWidthPx);
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [pageWidthPx]);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden bg-white ${className}`}
      style={{ aspectRatio: `${page.width} / ${page.height}` }}
    >
      {scale > 0 && (
        <div
          // Inert: the thumbnail must not be focusable or interactive. `inert` on
          // the document is the half CSS can't do — it stops the renderer emitting
          // `<a>` elements at all, which `aria-hidden` would hide from a screen
          // reader but leave as invalid nesting inside the `<Link>` most callers
          // wrap this in.
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 origin-top-left select-none"
          style={{ width: pageWidthPx, height: pageHeightPx, transform: `scale(${scale})` }}
        >
          <ResumeDocument templateSlug={templateSlug} content={content} theme={theme} inert />
        </div>
      )}
    </div>
  );
}
