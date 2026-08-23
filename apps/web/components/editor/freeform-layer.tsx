"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import type { FreeformBlock } from "@repo/types";
import {
  clampPosition,
  fromStackY,
  mmFromPx,
  resizeFromCorner,
  toStackY,
  type Extent,
  type Millimetres,
} from "../../lib/freeform-geometry";

/**
 * The selection frame for a freely-placed block, and the gestures that move and
 * resize it.
 *
 * It lives in the canvas's overlay rather than inside the sheet, for the two
 * reasons the rest of the editor's chrome does: nothing added to `.rd-page` can be
 * kept out of the exported PDF, and the overlay sits outside the zoom transform,
 * so a handle stays the same comfortable size to grab at 50% as at 200%.
 *
 * The frame's interior does not take pointer events. A text block underneath it is
 * still `contentEditable`, and clicking the words has to put the caret between
 * them — so only the ring's own controls are clickable, plus a drag surface added
 * for the block types that hold no text.
 */

const CORNERS = ["nw", "ne", "sw", "se"] as const;
type Corner = (typeof CORNERS)[number];

/** A rectangle in the scrolling container's coordinates, as the canvas measures. */
export type Frame = { top: number; left: number; width: number; height: number };

/**
 * A gesture in flight.
 *
 * `origin` is the block as the document had it when the pointer went down, so every
 * frame of the gesture is computed from the pointer's total travel rather than
 * accumulated per-move deltas — which drift, and which would double-apply a move
 * the reducer clamped.
 */
type Gesture = {
  blockId: string;
  /** `null` for a move; a corner for a resize. */
  corner: Corner | null;
  /** Where the pointer went down, in client coordinates. */
  from: { x: number; y: number };
  page: number;
  origin: { position: Millimetres; size: Extent };
  /** The block's on-screen extent, which is what a move is clamped against. */
  rendered: Extent;
};

/** What a gesture resolves to: a placement ready to be committed. */
type Placement = { page: number; position: Millimetres; size: Extent };

export function FreeformLayer({
  blocks,
  selectedId,
  page,
  pageCount,
  zoom,
  hostRef,
  toLocal,
  onMove,
  onResize,
  onRemove,
}: {
  blocks: readonly FreeformBlock[];
  selectedId: string | null;
  /** The sheet, in millimetres. */
  page: Extent;
  pageCount: number;
  zoom: number;
  /** The zoom host holding the sheets, so blocks can be found and painted. */
  hostRef: React.RefObject<HTMLDivElement | null>;
  toLocal: (rect: DOMRect) => Frame;
  onMove: (blockId: string, page: number, position: Millimetres) => void;
  onResize: (blockId: string, position: Millimetres, size: Extent) => void;
  onRemove: (blockId: string) => void;
}) {
  const [frame, setFrame] = useState<Frame | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);

  const selected = blocks.find((block) => block.id === selectedId) ?? null;
  const element = useCallback(
    (blockId: string) => blockElement(hostRef.current, blockId),
    [hostRef],
  );

  /** Fits the frame to whatever the selected block currently measures. */
  const measure = useCallback(() => {
    const el = selectedId ? element(selectedId) : null;
    setFrame(el ? toLocal(el.getBoundingClientRect()) : null);
  }, [element, selectedId, toLocal]);

  // Layout effect so the frame is never painted a beat behind the block. `blocks`
  // is in the dependencies because typing changes a block's height, and a ring
  // that doesn't follow reads as a rendering bug.
  useLayoutEffect(measure, [measure, blocks, zoom, page.width, page.height]);

  const begin = useCallback(
    (event: React.PointerEvent, corner: Corner | null) => {
      if (!selected || event.button !== 0) return;
      const el = element(selected.id);
      if (!el) return;

      // Keeps the press from moving focus out of the block being dragged, and from
      // starting a text selection that would fight the gesture.
      event.preventDefault();

      const box = el.getBoundingClientRect();
      const rendered = {
        width: mmFromPx(box.width, zoom),
        height: mmFromPx(box.height, zoom),
      };

      setGesture({
        blockId: selected.id,
        corner,
        from: { x: event.clientX, y: event.clientY },
        page: selected.page ?? 0,
        origin: geometryOf(selected, rendered),
        rendered,
      });
    },
    [element, selected, zoom],
  );

  // Live only while a gesture runs. The listeners are on the window so the pointer
  // may leave the handle — and the sheet — without the gesture dying, and Escape
  // abandons it with the block back where it started.
  useEffect(() => {
    if (!gesture) return;
    const active = gesture;
    const el = blockElement(hostRef.current, active.blockId);

    function resolve(event: PointerEvent): Placement {
      const delta = {
        x: mmFromPx(event.clientX - active.from.x, zoom),
        y: mmFromPx(event.clientY - active.from.y, zoom),
      };

      if (active.corner) {
        return { page: active.page, ...resizeFromCorner(active.corner, active.origin, delta, page) };
      }

      // A move is measured down the whole stack of sheets, so a block can be
      // dragged onto the page below and lands with that page's own coordinates.
      const stackY = toStackY(active.page, active.origin.position.y + delta.y, page.height);
      const landing = fromStackY(stackY, page.height, pageCount);

      return {
        page: landing.page,
        position: clampPosition(
          { x: active.origin.position.x + delta.x, y: landing.y },
          active.rendered,
          page,
        ),
        size: active.origin.size,
      };
    }

    /**
     * Shows the placement on the block itself, without going through React.
     *
     * A pointer move fires dozens of times a second, and re-rendering the document
     * for each one would rebuild every `contentEditable` in the sheet — taking the
     * caret with it. Writing the two properties the gesture changes straight onto
     * the element costs nothing and reads identically.
     *
     * Safe to leave behind, which is why there is no cleanup: what is painted is
     * always exactly what is about to be committed. If the commit changes the
     * document React overwrites these values on the next render, and if it doesn't
     * — a gesture the clamps swallowed — the painted value already equals the one
     * React is holding.
     */
    function paint(placement: Placement) {
      if (!el) return;
      // The block still belongs to the sheet it started on until the move is
      // committed, so a drag towards the next page is painted as an overhang.
      const top =
        placement.position.y +
        toStackY(placement.page, 0, page.height) -
        toStackY(active.page, 0, page.height);

      el.style.left = `${placement.position.x}mm`;
      el.style.top = `${top}mm`;

      if (!active.corner) return;
      el.style.width = `${placement.size.width}mm`;
      // Matching the renderer: a text box's height is a floor it may grow past,
      // while an image or a rule is exactly as tall as it was drawn.
      const exact = el.dataset.freeType === "image" || el.dataset.freeType === "divider";
      el.style[exact ? "height" : "minHeight"] = `${placement.size.height}mm`;
    }

    function show(placement: Placement) {
      paint(placement);
      if (el) setFrame(toLocal(el.getBoundingClientRect()));
    }

    function onPointerMove(event: PointerEvent) {
      show(resolve(event));
    }

    function onPointerUp(event: PointerEvent) {
      const placement = resolve(event);
      // Painted before dispatching so the two agree even if React decides the
      // document didn't change.
      show(placement);
      if (active.corner) onResize(active.blockId, placement.position, placement.size);
      else onMove(active.blockId, placement.page, placement.position);
      setGesture(null);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      show({ page: active.page, ...active.origin });
      setGesture(null);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [gesture, hostRef, onMove, onResize, page, pageCount, toLocal, zoom]);

  if (!selected || !frame) return null;

  // Text is edited in place, so its interior has to stay clickable. An image or a
  // rule holds nothing to edit, so once selected the whole of it becomes the grip —
  // which is how every other editor moves an object.
  const bodyDrags = selected.type === "image" || selected.type === "divider";

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

      {bodyDrags && (
        <div
          role="presentation"
          className="pointer-events-auto absolute inset-0 cursor-move touch-none"
          onPointerDown={(event) => begin(event, null)}
        />
      )}

      {/* Above the block rather than beside it: a resume runs the width of the
          sheet, and a grip hung off the left edge would sit under the per-entry
          action strip the template canvas puts there. */}
      <button
        type="button"
        title="Move — drag to reposition"
        aria-label="Move — drag to reposition"
        onPointerDown={(event) => begin(event, null)}
        className="pointer-events-auto absolute -top-[26px] left-[-3px] inline-flex h-[19px] w-[26px] cursor-grab touch-none items-center justify-center rounded-[4px] bg-paper-raised text-ink-faint shadow-card ring-1 ring-rule transition-colors hover:text-accent active:cursor-grabbing"
      >
        <GripIcon />
      </button>

      <button
        type="button"
        title="Delete this block"
        aria-label="Delete this block"
        onClick={() => onRemove(selected.id)}
        className="pointer-events-auto absolute -top-[26px] left-[26px] inline-flex h-[19px] w-[22px] items-center justify-center rounded-[4px] bg-paper-raised text-ink-faint shadow-card ring-1 ring-rule transition-colors hover:text-danger"
      >
        <TrashIcon />
      </button>

      {CORNERS.map((corner) => (
        <button
          key={corner}
          type="button"
          title="Resize"
          aria-label={`Resize from the ${CORNER_LABELS[corner]} corner`}
          onPointerDown={(event) => begin(event, corner)}
          className={`pointer-events-auto absolute h-[9px] w-[9px] touch-none rounded-full bg-paper-raised ring-1 ring-accent ${CORNER_POSITION[corner]}`}
          style={{ cursor: `${corner}-resize` }}
        />
      ))}
    </div>
  );
}

/**
 * The rendered element for a block, or null when this sheet doesn't show it.
 *
 * Scoped to the canvas host, never `document`: the measuring mirror renders the
 * same document a second time, and painting a gesture onto its copy would move
 * nothing the user can see.
 */
function blockElement(host: HTMLElement | null, blockId: string): HTMLElement | null {
  return host?.querySelector<HTMLElement>(`[data-free-block="${blockId}"]`) ?? null;
}

/**
 * A block's stored geometry, as the plain numbers the gesture arithmetic needs.
 *
 * `fallback` stands in for an absent `size`, so the first pull of a handle
 * continues from whatever the text came to on screen rather than jumping to some
 * arbitrary default.
 *
 * Copied out member by member rather than passed through, because the repo's two
 * tsconfigs disagree about the shape Zod infers here: apps/web compiles without
 * `strictNullChecks`, under which `z.infer` marks these members optional, while the
 * geometry helpers take them as required.
 */
function geometryOf(
  block: FreeformBlock,
  fallback: Extent,
): { position: Millimetres; size: Extent } {
  return {
    position: { x: block.position.x, y: block.position.y },
    size: block.size ? { width: block.size.width, height: block.size.height } : fallback,
  };
}

/** Centred on the corner, so the handle straddles it rather than sitting inside. */
const CORNER_POSITION: Record<Corner, string> = {
  nw: "-left-[5px] -top-[5px]",
  ne: "-right-[5px] -top-[5px]",
  sw: "-bottom-[5px] -left-[5px]",
  se: "-bottom-[5px] -right-[5px]",
};

const CORNER_LABELS: Record<Corner, string> = {
  nw: "top left",
  ne: "top right",
  sw: "bottom left",
  se: "bottom right",
};

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

function GripIcon() {
  return (
    <svg {...svg}>
      <circle cx="9" cy="6" r="0.6" fill="currentColor" />
      <circle cx="9" cy="12" r="0.6" fill="currentColor" />
      <circle cx="9" cy="18" r="0.6" fill="currentColor" />
      <circle cx="15" cy="6" r="0.6" fill="currentColor" />
      <circle cx="15" cy="12" r="0.6" fill="currentColor" />
      <circle cx="15" cy="18" r="0.6" fill="currentColor" />
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
