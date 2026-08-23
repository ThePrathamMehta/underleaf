import { describe, expect, test } from "bun:test";
import { boxDistance, caretSide, columnAtPoint, nearestBox } from "./click-to-edit";

/** A field-sized box, in the client coordinates the canvas measures in. */
function box(left: number, top: number, width: number, height: number) {
  return { left, top, right: left + width, bottom: top + height };
}

/**
 * Geometry roughly matching a rendered sheet at 96dpi: a full-width header, then a
 * single column of blocks. `name` and `role` are inline fields, so their boxes stop
 * where the words do; bullets are block-level and span the column.
 */
const single = [
  { id: "name", box: box(50, 50, 200, 30) },
  { id: "role", box: box(50, 84, 90, 14) },
  { id: "heading", box: box(50, 130, 120, 16) },
  { id: "title", box: box(50, 152, 140, 14) },
  { id: "bullet-1", box: box(50, 170, 700, 14) },
  { id: "bullet-2", box: box(50, 186, 700, 14) },
];

describe("nearestBox", () => {
  test("takes the line that was clicked, however far right of the words", () => {
    // Level with the job title, but 400px past where it ends. The bullet below is
    // much nearer as the crow flies, and is still the wrong answer.
    expect(nearestBox(single, { x: 600, y: 158 })?.id).toBe("title");
  });

  test("falls to the nearest line when the click is between two", () => {
    expect(nearestBox(single, { x: 300, y: 168 })?.id).toBe("bullet-1");
    expect(nearestBox(single, { x: 300, y: 120 })?.id).toBe("heading");
  });

  test("clicking the empty space under the last line lands in it", () => {
    expect(nearestBox(single, { x: 300, y: 500 })?.id).toBe("bullet-2");
  });

  test("returns null with nothing to choose from", () => {
    expect(nearestBox([], { x: 0, y: 0 })).toBeNull();
  });
});

/**
 * The Deedy case: a narrow sidebar and a wide main column, of very different
 * lengths. The sidebar runs to the bottom of the sheet; the main column stops
 * halfway.
 */
const side = { id: "side", box: box(50, 120, 200, 600) };
const main = { id: "main", box: box(280, 120, 470, 300) };

describe("columnAtPoint", () => {
  test("picks the column the click is horizontally inside", () => {
    expect(columnAtPoint([side, main], { x: 150, y: 200 })?.id).toBe("side");
    expect(columnAtPoint([side, main], { x: 500, y: 200 })?.id).toBe("main");
  });

  test("keeps a click in the main column's dead space out of the sidebar", () => {
    // y=500 is past the end of the main column but level with the sidebar, which
    // is what used to pull the caret across the page.
    expect(columnAtPoint([side, main], { x: 500, y: 500 })?.id).toBe("main");
  });

  test("claims the gap between the columns for the nearer one", () => {
    expect(columnAtPoint([side, main], { x: 258, y: 200 })?.id).toBe("side");
    expect(columnAtPoint([side, main], { x: 272, y: 200 })?.id).toBe("main");
  });

  test("leaves the header to the whole sheet", () => {
    // Above both columns: the name and contact line live there, and narrowing to
    // a column would put them out of reach.
    expect(columnAtPoint([side, main], { x: 500, y: 60 })).toBeNull();
    expect(columnAtPoint([side, main], { x: 500, y: 900 })).toBeNull();
  });

  test("is inert for the single-column templates", () => {
    expect(columnAtPoint([], { x: 100, y: 100 })).toBeNull();
  });
});

describe("caretSide", () => {
  const field = box(50, 100, 200, 20);

  test("points at the end below the line or past its last word", () => {
    expect(caretSide(field, { x: 100, y: 300 })).toBe("end");
    expect(caretSide(field, { x: 400, y: 110 })).toBe("end");
  });

  test("points at the start above the line or before its first word", () => {
    expect(caretSide(field, { x: 100, y: 20 })).toBe("start");
    expect(caretSide(field, { x: 10, y: 110 })).toBe("start");
  });
});

describe("boxDistance", () => {
  test("is zero on both axes inside the box", () => {
    expect(boxDistance(box(0, 0, 10, 10), { x: 5, y: 5 })).toEqual({ dx: 0, dy: 0 });
  });

  test("measures from the nearest edge", () => {
    expect(boxDistance(box(0, 0, 10, 10), { x: 14, y: -3 })).toEqual({ dx: 4, dy: 3 });
  });
});
