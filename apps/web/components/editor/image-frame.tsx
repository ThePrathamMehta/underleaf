"use client";

import { useEffect, useRef, useState } from "react";
import type { Frame } from "./freeform-layer";

/**
 * The selection frame for an image placed in the *flow* of a template resume, and
 * the corner drag that resizes it.
 *
 * A sibling of `FreeformLayer`, kept apart from it because the two resize
 * genuinely different things. A canvas block is a rectangle in millimetres on a
 * sheet, so it has four corners worth dragging. A flowed image is a share of
 * whichever column it landed in — a third of the page in Deedy's sidebar, the whole
 * measure in Jake's — so its size is one number, a percentage, and its height
 * follows the picture's own aspect ratio. One corner is all that number needs.
 *
 * Like every other piece of editor chrome this lives in the canvas overlay rather
 * than inside `.rd-page`: nothing added to the page can be kept out of the exported
 * PDF, and the overlay sits outside the zoom transform, so the handle stays the same
 * size to grab at 50% as at 200%.
 */

/** The narrowest an image may be dragged, as a share of its column. */
const MIN_PERCENT = 5;

type Gesture = {
  /** Where the pointer went down, in client coordinates. */
  fromX: number;
  /** The width it started at, so every frame is computed from total travel. */
  fromPercent: number;
  /** The column the percentage is of, in screen pixels at the current zoom. */
  columnPx: number;
};

export function ImageFrame({
  itemId,
  widthPercent,
  anchor,
  hostRef,
  toLocal,
  onResize,
}: {
  itemId: string;
  /** The item's stored width, or the renderer's default when it has none. */
  widthPercent: number;
  /** The image's measured box, as the canvas last saw it. */
  anchor: Frame;
  /** The zoom host holding the sheets, so the image can be found and painted. */
  hostRef: React.RefObject<HTMLDivElement | null>;
  toLocal: (rect: DOMRect) => Frame;
  onResize: (itemId: string, widthPercent: number) => void;
}) {
  const [gesture, setGesture] = useState<Gesture | null>(null);
  /**
   * The frame while a drag is running, which the parent cannot supply: it
   * re-measures from the document, and the document doesn't change until release.
   */
  const [live, setLive] = useState<Frame | null>(null);
  // Read by the window listeners, which are subscribed once per gesture and so
  // cannot close over the latest percentage.
  const percentRef = useRef(widthPercent);
  percentRef.current = widthPercent;

  useEffect(() => {
    if (!gesture) return;
    const parts = imageParts(hostRef.current, itemId);
    if (!parts) return;

    function percentAt(clientX: number): number {
      const delta = clientX - gesture!.fromX;
      const width = (gesture!.fromPercent / 100) * gesture!.columnPx + delta;
      return Math.round(clamp((width / gesture!.columnPx) * 100, MIN_PERCENT, 100));
    }

    /**
     * Shows the new width on the image itself, without going through React.
     *
     * A pointer move fires dozens of times a second and the image sits in a sheet
     * full of `contentEditable` fields, so re-rendering the document for each frame
     * would rebuild them all and take the caret with them. The renderer writes this
     * exact property inline, so React overwrites it on the next render either way.
     */
    function paint(percent: number) {
      parts!.image.style.width = `${percent}%`;
      setLive(toLocal(parts!.image.getBoundingClientRect()));
    }

    function onPointerMove(event: PointerEvent) {
      paint(percentAt(event.clientX));
    }

    function onPointerUp(event: PointerEvent) {
      const percent = percentAt(event.clientX);
      paint(percent);
      setGesture(null);
      setLive(null);
      onResize(itemId, percent);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      paint(percentRef.current);
      setGesture(null);
      setLive(null);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [gesture, hostRef, itemId, onResize, toLocal]);

  const frame = live ?? anchor;

  return (
    <div
      data-canvas-overlay
      className="pointer-events-none absolute z-10"
      style={{ top: frame.top, left: frame.left, width: frame.width, height: frame.height }}
    >
      <div
        aria-hidden
        className={`absolute -inset-[3px] rounded-[3px] ring-1 ${
          gesture ? "ring-accent" : "ring-accent-ring"
        }`}
      />

      {/*
        One handle, on the corner every editor puts it on. The height isn't a
        separate number — the picture keeps its own proportions inside whatever
        width it is given — so there is nothing for a second handle to change.
      */}
      <button
        type="button"
        title="Resize — drag to change the width"
        aria-label="Resize — drag to change the width"
        onPointerDown={(event) => {
          const parts = imageParts(hostRef.current, itemId);
          if (!parts || event.button !== 0) return;
          // Keeps the press from moving focus out of the document and from starting
          // a text selection that would fight the drag.
          event.preventDefault();

          setGesture({
            fromX: event.clientX,
            fromPercent: widthPercent,
            // Measured now rather than stored: the column is as wide as the layout
            // and the zoom make it, and both can have changed since the last drag.
            columnPx: parts.column.getBoundingClientRect().width,
          });
        }}
        className="pointer-events-auto absolute -bottom-[5px] -right-[5px] h-[9px] w-[9px] touch-none rounded-full bg-paper-raised ring-1 ring-accent"
        style={{ cursor: "se-resize" }}
      />
    </div>
  );
}

/**
 * The image and the column it is a percentage of.
 *
 * Scoped to the canvas host, never `document`: the measuring mirror renders the
 * same document a second time, and painting a drag onto its copy would resize
 * nothing the user can see.
 *
 * The wrapper *is* the column — it's a full-width flex row whose only child is the
 * picture (or the dashed frame standing in for one still uploading), which is what
 * makes the width a share of the column rather than of the page.
 */
function imageParts(
  host: HTMLElement | null,
  itemId: string,
): { column: HTMLElement; image: HTMLElement } | null {
  const column = host?.querySelector<HTMLElement>(`.rd-item-image[data-item-id="${itemId}"]`);
  const image = column?.firstElementChild as HTMLElement | null;
  return column && image ? { column, image } : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
