import { describe, expect, test } from "bun:test";
import {
  clampPosition,
  clampSize,
  fromStackY,
  mmFromPx,
  newTextBlockBox,
  resizeFromCorner,
  stackedPosition,
  toStackY,
} from "./freeform-geometry";

/** Letter, which is what the Blank template seeds. */
const LETTER = { width: 215.9, height: 279.4 };

describe("mmFromPx", () => {
  test("converts at 96dpi", () => {
    expect(mmFromPx(96, 1)).toBeCloseTo(25.4);
  });

  test("divides out the canvas zoom, so a drag moves the document once", () => {
    // Zoomed to 200%, the pointer travels twice as far across the screen as the
    // block does across the page.
    expect(mmFromPx(96, 2)).toBeCloseTo(12.7);
  });
});

describe("clampPosition", () => {
  const block = { width: 90, height: 12 };

  test("leaves a block that is on the page alone", () => {
    expect(clampPosition({ x: 30, y: 40 }, block, LETTER)).toEqual({ x: 30, y: 40 });
  });

  test("lets a block hang off an edge but never disappear", () => {
    // Dragged far past the left: 6mm of its right-hand side stays on the sheet.
    expect(clampPosition({ x: -400, y: 40 }, block, LETTER).x).toBe(6 - 90);
    // And far past the bottom: 6mm of its top edge stays.
    expect(clampPosition({ x: 30, y: 900 }, block, LETTER).y).toBe(279.4 - 6);
  });

  test("rounds to a hundredth of a millimetre", () => {
    expect(clampPosition({ x: 30.123456, y: 40.987654 }, block, LETTER)).toEqual({
      x: 30.12,
      y: 40.99,
    });
  });
});

describe("clampSize", () => {
  test("keeps a block grabbable", () => {
    expect(clampSize({ width: 0.2, height: -5 }, LETTER)).toEqual({ width: 6, height: 6 });
  });

  test("never exceeds the sheet", () => {
    expect(clampSize({ width: 1000, height: 1000 }, LETTER)).toEqual({
      width: 215.9,
      height: 279.4,
    });
  });
});

describe("resizeFromCorner", () => {
  const origin = { position: { x: 50, y: 50 }, size: { width: 100, height: 20 } };

  test("south-east grows away from a fixed origin", () => {
    const next = resizeFromCorner("se", origin, { x: 10, y: 5 }, LETTER);
    expect(next.position).toEqual({ x: 50, y: 50 });
    expect(next.size).toEqual({ width: 110, height: 25 });
  });

  test("north-west moves the origin and keeps the far corner nailed down", () => {
    const next = resizeFromCorner("nw", origin, { x: -10, y: -5 }, LETTER);
    expect(next.position).toEqual({ x: 40, y: 45 });
    expect(next.size).toEqual({ width: 110, height: 25 });
    // The corner the user isn't holding hasn't budged.
    expect(next.position.x + next.size.width).toBe(origin.position.x + origin.size.width);
    expect(next.position.y + next.size.height).toBe(origin.position.y + origin.size.height);
  });

  test("mixes the two axes for the other corners", () => {
    const ne = resizeFromCorner("ne", origin, { x: 10, y: -5 }, LETTER);
    expect(ne).toEqual({ position: { x: 50, y: 45 }, size: { width: 110, height: 25 } });

    const sw = resizeFromCorner("sw", origin, { x: -10, y: 5 }, LETTER);
    expect(sw).toEqual({ position: { x: 40, y: 50 }, size: { width: 110, height: 25 } });
  });

  test("a handle dragged past the minimum stops instead of walking the block away", () => {
    // Pulling the north-west handle 500mm right and down would invert the box.
    const next = resizeFromCorner("nw", origin, { x: 500, y: 500 }, LETTER);
    expect(next.size).toEqual({ width: 6, height: 6 });
    // The south-east corner is still where it was, so the block hasn't moved out
    // from under the pointer.
    expect(next.position.x + next.size.width).toBe(150);
    expect(next.position.y + next.size.height).toBe(70);
  });
});

describe("newTextBlockBox", () => {
  test("starts at the click, so the caret lands under the pointer", () => {
    expect(newTextBlockBox({ x: 30, y: 100 }, LETTER).position).toEqual({ x: 30, y: 100 });
  });

  test("takes a full line of width when there is room", () => {
    expect(newTextBlockBox({ x: 30, y: 100 }, LETTER).size).toEqual({ width: 90, height: 6 });
  });

  test("trims to the room left rather than sliding back from the edge", () => {
    const box = newTextBlockBox({ x: 180, y: 100 }, LETTER);
    expect(box.position.x).toBe(180);
    // 215.9 - 6 - 180, so the box stops short of the right-hand edge.
    expect(box.size.width).toBeCloseTo(29.9);
  });

  test("stays grabbable even for a click on the very edge", () => {
    expect(newTextBlockBox({ x: 215, y: 100 }, LETTER).size.width).toBe(6);
  });
});

describe("stackedPosition", () => {
  /** Roughly what a four-line starter section comes to. */
  const starter = { width: 170, height: 28.8 };

  test("lines a block up on the left edge it was given", () => {
    expect(stackedPosition({ x: 20, y: 40 }, starter, LETTER)).toEqual({ x: 20, y: 40 });
  });

  test("keeps a wide block on the sheet", () => {
    // 215.9 - 170, so the section's right-hand edge stops at the paper's.
    expect(stackedPosition({ x: 90, y: 40 }, starter, LETTER)!.x).toBeCloseTo(45.9);
  });

  test("refuses the foot of the page rather than sliding up into what is there", () => {
    // 279.4 - 20mm of bottom margin = 259.4; a 28.8mm block must start by 230.6.
    expect(stackedPosition({ x: 20, y: 230 }, starter, LETTER)).not.toBeNull();
    expect(stackedPosition({ x: 20, y: 240 }, starter, LETTER)).toBeNull();
  });
});

describe("the page stack", () => {
  test("round-trips a position through stack coordinates", () => {
    const stackY = toStackY(1, 30, LETTER.height);
    expect(stackY).toBeCloseTo(279.4 + 6 + 30);
    expect(fromStackY(stackY, LETTER.height, 2)).toEqual({ page: 1, y: 30 });
  });

  test("a drag onto the sheet below lands on it", () => {
    const stackY = toStackY(0, LETTER.height + 6 + 12, LETTER.height);
    expect(fromStackY(stackY, LETTER.height, 2)).toEqual({ page: 1, y: 12 });
  });

  test("a drag below the last sheet stays on it rather than growing the document", () => {
    expect(fromStackY(10_000, LETTER.height, 1)).toEqual({ page: 0, y: 279.4 });
    expect(fromStackY(10_000, LETTER.height, 3)).toEqual({ page: 2, y: 279.4 });
  });

  test("the gap between two sheets belongs to the one above", () => {
    // 3mm into the 6mm gap under page 0: not on page 1 yet.
    expect(fromStackY(LETTER.height + 3, LETTER.height, 2)).toEqual({ page: 0, y: 279.4 });
  });

  test("a drag above the first sheet stays on it", () => {
    expect(fromStackY(-50, LETTER.height, 2)).toEqual({ page: 0, y: -50 });
  });
});
