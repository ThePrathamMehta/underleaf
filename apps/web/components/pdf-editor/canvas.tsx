"use client";

import { useEffect, useRef } from "react";
import type { PdfDocumentDto, PdfPageDto, PdfTextRunDto } from "@repo/types";
import { api } from "../../lib/api";

/**
 * The PDF editing surface.
 *
 * The mechanism, and the one genuinely new thing in this feature: each page is a
 * rasterized backdrop image with one absolutely-positioned `contentEditable` per
 * text run laid over it. The parser has already erased those runs from the
 * backdrop, so what looks like the original page is really the backdrop's
 * non-text content plus our own live text on top.
 *
 * Nothing here reflows. A run is a fixed-position label at the coordinates the
 * source PDF put it at, which is the constraint that makes editing an arbitrary
 * third-party PDF tractable at all (spec B.1).
 */
export function PdfCanvas({
  document,
  zoom,
  onRunEdit,
  onActivePageChange,
}: {
  document: PdfDocumentDto;
  zoom: number;
  onRunEdit: (runId: string, text: string) => void;
  onActivePageChange: (pageIndex: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keeps the toolbar's page counter in step with what's actually on screen.
  // An observer rather than a scroll handler: it reports the page crossing the
  // viewport's middle without running on every scroll frame.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (visible) {
          const index = Number((visible.target as HTMLElement).dataset.pdfPage);
          if (Number.isInteger(index)) onActivePageChange(index);
        }
      },
      { root, threshold: [0.1, 0.5, 0.9] },
    );

    for (const element of root.querySelectorAll("[data-pdf-page]")) {
      observer.observe(element);
    }

    return () => observer.disconnect();
  }, [document.pages.length, onActivePageChange]);

  return (
    <>
      {/*
        Embedded font programs, declared before any run that uses them renders.
        Document-level because a face is shared across runs and pages — one
        declaration, which is also how the browser knows they're the same face.
      */}
      <style>{buildFontFaces(document)}</style>

      <div ref={scrollRef} className="flex-1 overflow-auto bg-paper-sunken">
        <div className="flex w-fit min-w-full flex-col items-center gap-8 px-8 py-10">
          {document.pages.map((page) => (
            <PdfPage key={page.id} page={page} zoom={zoom} onRunEdit={onRunEdit} />
          ))}
        </div>
      </div>
    </>
  );
}

/**
 * `@font-face` rules for the document's embedded faces.
 *
 * The family name is sanitized even though it came from our own parser: it's
 * derived from a font name inside a user-uploaded file, and it's being
 * interpolated into a stylesheet. Restricting it to the characters a CSS
 * identifier can hold means a crafted font name can't close the quote and inject
 * rules. Runs whose family gets rewritten here simply fall through to the next
 * font in their stack, which is the same graceful path as a failed download.
 */
function buildFontFaces(document: PdfDocumentDto): string {
  return document.fonts
    .map((font) => {
      const family = font.family.replace(/[^A-Za-z0-9_ -]/g, "");
      if (!family) return "";

      return [
        "@font-face {",
        `  font-family: "${family}";`,
        `  src: url("${api.assetUrl(font.url)}") format("${cssFormat(font.mimeType)}");`,
        // The backdrop is already visible, so a slow font swapping in late is a
        // better experience than invisible text while it loads.
        "  font-display: swap;",
        "}",
      ].join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

const CSS_FORMATS: Record<string, string> = {
  "font/ttf": "truetype",
  "font/otf": "opentype",
  "font/woff": "woff",
  "font/woff2": "woff2",
};

function cssFormat(mimeType: string): string {
  return CSS_FORMATS[mimeType] ?? "truetype";
}

function PdfPage({
  page,
  zoom,
  onRunEdit,
}: {
  page: PdfPageDto;
  zoom: number;
  onRunEdit: (runId: string, text: string) => void;
}) {
  return (
    <div
      data-pdf-page={page.pageIndex}
      className="relative shrink-0 bg-white shadow-page ring-1 ring-black/5"
      style={{
        width: page.width,
        height: page.height,
        // Zoom scales the rendered result rather than recomputing each run's
        // geometry, so run coordinates stay in the PDF's own point space and
        // can't drift from the backdrop at fractional zoom levels.
        transform: `scale(${zoom})`,
        transformOrigin: "top center",
        // `transform` doesn't affect layout, so without this the scaled page
        // would overlap its neighbour instead of pushing it down.
        marginBottom: (zoom - 1) * page.height,
      }}
    >
      {/*
        A plain `img`, not `next/image`: these bytes are owner-scoped and the
        optimizer fetches them server-side without the user's auth cookie, so
        every page would 404. They're also already optimally sized — the parser
        rendered them at exactly this box — and served `immutable`, which is the
        caching `next/image` would otherwise be buying us.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={api.assetUrl(page.backgroundImageUrl)}
        alt=""
        width={page.width}
        height={page.height}
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full select-none"
      />

      {page.runs.map((run) => (
        <EditableRun key={run.id} run={run} onEdit={onRunEdit} />
      ))}
    </div>
  );
}

/**
 * One text run, editable in place.
 *
 * Its font, size and colour come from the source PDF and are never changed by
 * editing — that inheritance is what the fixed-position model buys the user
 * (spec B.1): retype a line without having to re-pick how it looks.
 */
function EditableRun({
  run,
  onEdit,
}: {
  run: PdfTextRunDto;
  onEdit: (runId: string, text: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Seeds the text imperatively, once. React must not own this subtree: it's a
  // contentEditable, and re-rendering children under the user's caret would
  // collapse the selection on every keystroke.
  useEffect(() => {
    const element = ref.current;
    if (element && element.textContent !== run.text) {
      element.textContent = run.text;
    }
    // Deliberately keyed on the run id, not `run.text` — the latter would fight
    // the user's own typing, since each keystroke updates the saved value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id]);

  const isFallback = run.fontSource === "fallback";

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label={`Edit text: ${run.originalText.slice(0, 40)}`}
      spellCheck={false}
      onInput={(event) => onEdit(run.id, event.currentTarget.textContent ?? "")}
      // Enter would insert a <div> or <br> into a fixed-height single-line box,
      // which can't reflow to show it. Blur is the honest thing to do instead.
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      className={`absolute cursor-text whitespace-pre rounded-[1px] outline-none ring-accent/70 transition-shadow hover:ring-1 focus:ring-2 ${
        isFallback ? "decoration-amber-500/60 underline decoration-dotted underline-offset-2" : ""
      }`}
      title={
        isFallback
          ? `The exact font couldn't be preserved for this text — showing a close match for ${run.fontFamily.split(",")[0]}.`
          : undefined
      }
      style={{
        left: run.x,
        top: run.y,
        width: run.width,
        height: run.height,
        fontFamily: run.fontFamily,
        fontSize: run.fontSize,
        color: run.color,
        // The parser built `height` from the font's own ascent + descent at this
        // size, so a line box of exactly that height puts the baseline at
        // `run.baseline` from the top — the same offset the export draws at.
        lineHeight: `${run.height}px`,
      }}
    />
  );
}
