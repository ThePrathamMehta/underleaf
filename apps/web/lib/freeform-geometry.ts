/**
 * Geometry for the blank canvas: turning a pointer gesture into the millimetre
 * position and size a `FreeformBlock` stores.
 *
 * Millimetres, because that is what the renderer works in — the same numbers
 * describe the screen, the thumbnail and the PDF. The only conversion in here is
 * from the pixels a pointer event reports, and it accounts for the canvas zoom,
 * which scales the sheet without changing the document's real geometry.
 *
 * Clamping lives here rather than in the schema on purpose. `freeformBlockSchema`
 * accepts a generous range so that a block nudged a hair off the sheet is still a
 * valid document — failing validation there would fail the autosave and lose the
 * user's work over half a millimetre. Keeping a block reachable is an editor
 * concern, and this is the editor's half of that split.
 */

/** CSS pixels per millimetre at the 96dpi the browser assumes. */
export const MM_TO_PX = 96 / 25.4;

/** Screen gap between stacked sheets, matching the CSS in `themeToCss`. */
export const PAGE_GAP_MM = 6;

/**
 * How much of a block must stay on the sheet.
 *
 * A block may hang over an edge — that is a real thing to want, and the schema
 * allows the negative coordinate it takes — but it may never be dragged so far
 * that there is nothing left to grab. Six millimetres is about a line of text.
 */
const MIN_ON_SHEET_MM = 6;

/** The smallest block a resize handle can produce, comfortably above the schema's floor. */
const MIN_BLOCK_MM = 6;

export type Millimetres = { x: number; y: number };
export type Extent = { width: number; height: number };

/** Pointer travel in screen pixels, as the millimetres a document moved. */
export function mmFromPx(px: number, zoom: number): number {
  return px / zoom / MM_TO_PX;
}

/** Keeps `value` within [`min`, `max`], tolerating an inverted range. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Rounds to a hundredth of a millimetre — finer than any printer, and short in JSON. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * A dropped block's position, kept partly on the sheet.
 *
 * `rendered` is the block's on-screen extent, which for an unsized block is
 * whatever its text came to — a heading's own height is what decides how far down
 * the page it may go.
 */
export function clampPosition(position: Millimetres, rendered: Extent, page: Extent): Millimetres {
  return {
    x: round(clamp(position.x, MIN_ON_SHEET_MM - rendered.width, page.width - MIN_ON_SHEET_MM)),
    y: round(clamp(position.y, MIN_ON_SHEET_MM - rendered.height, page.height - MIN_ON_SHEET_MM)),
  };
}

/**
 * A resized block's extent: at least grabbable, at most one sheet.
 *
 * The upper bound is the page rather than the schema's limit because a block
 * larger than the sheet it sits on has no meaning — every part of it past the edge
 * is clipped out of the PDF.
 */
export function clampSize(size: Extent, page: Extent): Extent {
  return {
    width: round(clamp(size.width, MIN_BLOCK_MM, page.width)),
    height: round(clamp(size.height, MIN_BLOCK_MM, page.height)),
  };
}

/**
 * Resizing from a corner: which corner is held decides whether the far edge stays
 * put or the origin moves with the pointer.
 *
 * Dragging the north-west handle left has to widen the block *and* move it left,
 * because the south-east corner is the one the user expects to stay nailed down.
 * The size is clamped first, and the position derived from the clamped size, so a
 * handle dragged past the minimum stops dead instead of walking the block across
 * the page.
 */
export function resizeFromCorner(
  corner: "nw" | "ne" | "sw" | "se",
  origin: { position: Millimetres; size: Extent },
  delta: Millimetres,
  page: Extent,
): { position: Millimetres; size: Extent } {
  const west = corner === "nw" || corner === "sw";
  const north = corner === "nw" || corner === "ne";

  const size = clampSize(
    {
      width: origin.size.width + (west ? -delta.x : delta.x),
      height: origin.size.height + (north ? -delta.y : delta.y),
    },
    page,
  );

  return {
    size,
    position: {
      // The held edge moves by however much the size actually changed, which is
      // not the same as how far the pointer went once clamping bites.
      x: round(west ? origin.position.x + (origin.size.width - size.width) : origin.position.x),
      y: round(north ? origin.position.y + (origin.size.height - size.height) : origin.position.y),
    },
  };
}

/**
 * A comfortable line length for a text box the user conjured with a click, and the
 * one line of height it starts at.
 *
 * The height is a floor rather than a limit — the renderer gives a text block
 * `min-height`, so it grows as they type, like a Word text box set to resize to fit.
 */
const NEW_TEXT = { width: 90, height: 6 };

/**
 * The box for a new text block at the point that was clicked.
 *
 * The click is the block's top-left corner, so the caret appears under the pointer
 * rather than somewhere nearby. The width is trimmed to whatever room is left to
 * the right of it: a click near the outer edge should still produce a box on the
 * page, and shrinking it keeps the text where they pointed, where moving it left
 * would put the caret somewhere they didn't click.
 */
export function newTextBlockBox(
  point: Millimetres,
  page: Extent,
): { position: Millimetres; size: Extent } {
  const room = page.width - MIN_ON_SHEET_MM - point.x;

  return {
    position: { x: round(point.x), y: round(point.y) },
    size: clampSize({ width: Math.min(NEW_TEXT.width, room), height: NEW_TEXT.height }, page),
  };
}

/**
 * The size an Insert-menu block starts at, per kind.
 *
 * A text box matches what a click produces, so the two ways of getting one agree.
 * An image is a little under a third of the sheet's width in a 4:3 frame — big
 * enough to see, small enough that nobody has to shrink a headshot that arrived
 * filling the page; the frame is authoritative and the picture fits inside it
 * whole, so a portrait photo simply letterboxes until the handles are pulled. A
 * divider is a line the width of a paragraph, in a box tall enough to grab.
 */
export const INSERTED_BLOCK_MM: Record<"text" | "image" | "divider", Extent> = {
  text: { width: NEW_TEXT.width, height: NEW_TEXT.height },
  image: { width: 60, height: 45 },
  divider: { width: 90, height: 4 },
};

/**
 * The box for a block placed *at* a point rather than dragged out from one — an
 * Insert-menu block, or an image dropped onto the sheet.
 *
 * Centred on the point, unlike `newTextBlockBox`: a click that becomes a text box
 * wants the caret to appear under the pointer, but something inserted whole should
 * land around where it was aimed, which is what dropping a file anywhere else does.
 *
 * Kept wholly on the sheet, also unlike a drag. A block may be *moved* half off the
 * page — that is a real thing to want — but arriving that way would look like a bug,
 * so an insert near the edge slides back on instead.
 */
export function centredBox(
  point: Millimetres,
  size: Extent,
  page: Extent,
): { position: Millimetres; size: Extent } {
  const fitted = clampSize(size, page);

  return {
    position: {
      x: round(clamp(point.x - fitted.width / 2, 0, page.width - fitted.width)),
      y: round(clamp(point.y - fitted.height / 2, 0, page.height - fitted.height)),
    },
    size: fitted,
  };
}

/**
 * The inset a stacked block lines up on when the sheet has nothing to line up
 * with, and the room kept clear at the foot of the page.
 *
 * 20mm, matching the pre-placed name heading, so the first section inserted on a
 * new canvas lands squarely under the name rather than beside it.
 */
export const STACK_INSET_MM = 20;

/** Air between one stacked block and the next. */
export const STACK_GAP_MM = 6;

/**
 * Where a block goes when it is stacked under what is already on the sheet, rather
 * than dropped at a point.
 *
 * Null when it would run off the foot of the page, which the caller answers by
 * trying the next sheet — a section is a column of text that belongs *below* the
 * last one, so sliding it up to fit would put it on top of something.
 *
 * `at` comes from the rendered page rather than from stored geometry, because half
 * the blocks on a canvas carry no explicit size and a text block's real height is
 * whatever its words came to.
 */
export function stackedPosition(at: Millimetres, size: Extent, page: Extent): Millimetres | null {
  const position = {
    x: round(clamp(at.x, 0, Math.max(0, page.width - size.width))),
    y: round(at.y),
  };

  return position.y + size.height > page.height - STACK_INSET_MM ? null : position;
}

/** Millimetres from the top of one sheet to the top of the next, gap included. */
export function stackStepMm(pageHeight: number): number {
  return pageHeight + PAGE_GAP_MM;
}/** How far a block sits from the top of the first sheet, across the whole stack. */
export function toStackY(page: number, y: number, pageHeight: number): number {
  return page * stackStepMm(pageHeight) + y;
}

/**
 * Splits a stack offset back into the sheet it lands on and the offset within it.
 *
 * Clamped to the sheets that exist: a canvas is exactly as long as the user has
 * spread their content, so a block dragged below the last sheet stays on it rather
 * than conjuring a page nobody asked for. A gesture that ends in the gap between
 * two sheets resolves to the nearer one, because the gap is not a place — it is
 * the space between two places.
 */
export function fromStackY(
  stackY: number,
  pageHeight: number,
  pageCount: number,
): { page: number; y: number } {
  const step = stackStepMm(pageHeight);
  const page = clamp(Math.floor(stackY / step), 0, Math.max(0, pageCount - 1));
  const y = stackY - page * step;

  // Past the bottom of this sheet but not onto the next: snap back onto this one.
  return { page, y: round(Math.min(y, pageHeight)) };
}
