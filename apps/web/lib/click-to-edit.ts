/**
 * Where a click in the document's empty space should put the caret.
 *
 * A resume is mostly whitespace: the gap under the last bullet of an entry, the
 * space to the right of a short line, the band between two sections. Clicking any
 * of those used to do nothing at all — the click landed on a `<div>` that isn't
 * editable, and the user had to find the text itself to type. Every word processor
 * instead moves the caret to the nearest place text can go, and that is what this
 * resolves.
 *
 * The geometry is pure and lives here rather than in the canvas because the rule
 * it encodes is worth being able to state and test: *the line you clicked, then
 * the nearest text on that line*. Everything about the DOM — which nodes are
 * fields, which column they belong to, how a caret is actually placed — stays in
 * `canvas.tsx`.
 */

export type Point = { x: number; y: number };

/**
 * A rectangle, in whatever coordinate space the caller measures in. Matches the
 * shape of a `DOMRect` so client rects can be passed straight in.
 */
export type Box = { left: number; top: number; right: number; bottom: number };

/** Distance from `value` to the closed interval [`min`, `max`]; zero inside it. */
function gap(value: number, min: number, max: number): number {
  if (value < min) return min - value;
  if (value > max) return value - max;
  return 0;
}

/** How far the point sits outside the box, per axis. Both zero means inside. */
export function boxDistance(box: Box, point: Point): { dx: number; dy: number } {
  return {
    dx: gap(point.x, box.left, box.right),
    dy: gap(point.y, box.top, box.bottom),
  };
}

/**
 * The candidate a click should land in: nearest vertically, and among equals
 * nearest horizontally.
 *
 * Vertical distance dominates on purpose, and the ordering is lexicographic
 * rather than a weighted sum. A click level with a line of text has `dy === 0` for
 * that line and nothing else, so it wins however far to the right of the words it
 * happened to fall — which is precisely the behaviour of clicking past the end of
 * a line in a word processor. A weighted sum would instead hand that click to
 * whichever full-width block below happened to be closest, and the caret would
 * land a line lower than the user pointed at.
 *
 * This deliberately says nothing about columns. A two-column resume has two
 * independent vertical flows, and "nearest" across the two is meaningless — the
 * caller narrows the candidates to one column first (see `columnAtPoint`).
 */
export function nearestBox<T>(candidates: readonly (T & { box: Box })[], point: Point): T | null {
  let best: (T & { box: Box }) | null = null;
  let bestDy = Infinity;
  let bestDx = Infinity;

  for (const candidate of candidates) {
    const { dx, dy } = boxDistance(candidate.box, point);
    if (dy < bestDy || (dy === bestDy && dx < bestDx)) {
      best = candidate;
      bestDy = dy;
      bestDx = dx;
    }
  }

  return best;
}

/**
 * Which of a sheet's columns owns a click, or `null` when the click is level with
 * none of them and the whole sheet should be searched.
 *
 * The two tests are deliberately on different axes. Whether to narrow at all is a
 * question about `y`: a click above the columns is in the header, which belongs to
 * neither and must still be reachable. *Which* column, once inside that band, is a
 * question about `x` alone — the columns are different lengths, so a click in the
 * dead space below a short main column is often level with a sidebar entry, and
 * choosing by proximity there would throw the caret across the page into a
 * section the user never pointed at.
 */
export function columnAtPoint<T>(
  columns: readonly (T & { box: Box })[],
  point: Point,
): T | null {
  const level = columns.some((column) => boxDistance(column.box, point).dy === 0);
  if (!level) return null;

  let best: (T & { box: Box }) | null = null;
  let bestDx = Infinity;

  for (const column of columns) {
    const { dx } = boxDistance(column.box, point);
    if (dx < bestDx) {
      best = column;
      bestDx = dx;
    }
  }

  return best;
}

/**
 * Which end of the chosen field the caret belongs at.
 *
 * Below it, or past the end of its line: the end — the user is pointing at where
 * the text stops. Above it, or before its start: the beginning. This is what makes
 * a click in the gap between two sections read as "continue the section above"
 * when it lands nearer the one above, and "start of the heading below" when it
 * doesn't.
 */
export function caretSide(box: Box, point: Point): "start" | "end" {
  if (point.y > box.bottom) return "end";
  if (point.y < box.top) return "start";
  return point.x > box.right ? "end" : "start";
}
