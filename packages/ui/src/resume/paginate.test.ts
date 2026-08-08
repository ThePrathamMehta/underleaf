import { describe, expect, test } from "bun:test";
import { packBlocks, type MeasuredBlock } from "./paginate";

/**
 * The packer is pure arithmetic over measured heights, so it can be tested
 * with synthetic numbers — no DOM anywhere. These are the first tests in the
 * repo; they stay confined to this module on purpose.
 */

/** A one-section resume in a 100-unit page. */
function singleSection(blocks: MeasuredBlock[], usableHeight = 100, headerHeight = 0): ReturnType<typeof packBlocks> {
  return packBlocks({ blocks, usableHeight, headerHeight });
}

function heading(sectionId = "s1"): MeasuredBlock {
  return { kind: "heading", sectionId, column: "main", itemIndex: -1, bulletIndex: -1, height: 10, gapBefore: 6 };
}

function entry(sectionId = "s1", itemIndex = 0): MeasuredBlock {
  return { kind: "entry", sectionId, column: "main", itemIndex, bulletIndex: -1, height: 15, gapBefore: 4 };
}

function bullet(sectionId = "s1", itemIndex = 0, bulletIndex = 0): MeasuredBlock {
  return { kind: "bullet", sectionId, column: "main", itemIndex, bulletIndex, height: 8, gapBefore: 2 };
}

/** Flattens the layout to (section, item, head, bulletCount) tuples for assertions. */
function describeLayout(pages: ReturnType<typeof packBlocks>) {
  return pages.map((page) =>
    page.map((section) => ({
      section: section.sectionId,
      continued: section.continued,
      items: section.items.map((item) => ({
        item: item.itemIndex,
        head: item.head,
        bullets: item.bullets,
      })),
    })),
  );
}

describe("packBlocks", () => {
  test("everything that fits stays on one sheet", () => {
    const blocks = [heading(), entry(), bullet(), bullet()];
    // heading 10 + entry 15 + bullets 8+8, gaps 4+2+2 → 49
    const pages = singleSection(blocks);
    expect(pages).toHaveLength(1);
    expect(describeLayout(pages)).toEqual([
      [
        {
          section: "s1",
          continued: false,
          items: [{ item: 0, head: true, bullets: [0, 2] }],
        },
      ],
    ]);
  });

  test("overflow opens a second sheet and repeats the heading", () => {
    // heading 10 + entry 4+15 + first bullet 2+8 = 39; each later bullet 10.
    // At 45 the second bullet spills, and the rest follow it.
    const blocks = [heading(), entry(), bullet(), bullet(), bullet(), bullet()];
    const pages = singleSection(blocks, 45);
    expect(pages).toHaveLength(2);
    const flat = describeLayout(pages);
    expect(flat[0]![0]).toMatchObject({ section: "s1", continued: false });
    expect(flat[0]![0]!.items).toEqual([{ item: 0, head: true, bullets: [0, 1] }]);
    expect(flat[1]![0]).toMatchObject({ section: "s1", continued: true });
    expect(flat[1]![0]!.items).toEqual([{ item: 0, head: false, bullets: [1, 4] }]);
  });

  test("an entry head never travels without its first bullet", () => {
    // Two entries at 39 and 29; at 60 the second can't fit, so its rows and its
    // first bullet move to sheet 2 together rather than the rows going alone.
    const blocks = [heading(), entry(), bullet(), entry("s1", 1), bullet("s1", 1)];
    const pages = singleSection(blocks, 60);
    expect(pages).toHaveLength(2);
    expect(describeLayout(pages)[1]![0]!.items).toEqual([{ item: 1, head: true, bullets: [0, 1] }]);
  });

  test("a heading is never the last thing on a sheet", () => {
    // Section a fills 35. Section b's heading would fit at 60 but its first
    // entry would not, so heading and entry move to sheet 2 together.
    const blocks = [heading("a"), entry("a"), heading("b"), entry("b", 0)];
    const pages = singleSection(blocks, 60);
    expect(pages).toHaveLength(2);
    const flat = describeLayout(pages);
    expect(flat[0]!.map((s) => s.section)).toEqual(["a"]);
    expect(flat[1]!.map((s) => s.section)).toEqual(["b"]);
    expect(flat[1]![0]!.continued).toBe(false);
    expect(flat[1]![0]!.items).toEqual([{ item: 0, head: true, bullets: [0, 0] }]);
  });

  test("a widow bullet is pulled over with its pair", () => {
    // heading+entry+bullet 0 = 39, then bullets at 10 each. At 62 bullets 1 and
    // 2 fit (59) but bullet 3 would not — so 2 and 3 travel together.
    const blocks = [
      heading(),
      entry(),
      bullet(),
      bullet("s1", 0, 1),
      bullet("s1", 0, 2),
      bullet("s1", 0, 3),
    ];
    const pages = singleSection(blocks, 62);
    expect(pages).toHaveLength(2);
    const flat = describeLayout(pages);
    expect(flat[0]![0]!.items).toEqual([{ item: 0, head: true, bullets: [0, 2] }]);
    expect(flat[1]![0]!.items).toEqual([{ item: 0, head: false, bullets: [2, 4] }]);
  });

  test("a forced break starts a fresh sheet before the flagged section", () => {
    const blocks = [heading("a"), entry("a"), heading("b"), entry("b", 0)];
    expect(singleSection(blocks, 200)).toHaveLength(1);

    const forced = packBlocks({
      blocks,
      usableHeight: 200,
      headerHeight: 0,
      forcedBreaks: new Set(["b"]),
    });
    expect(forced).toHaveLength(2);
    expect(describeLayout(forced)[0]![0]!.section).toBe("a");
    expect(describeLayout(forced)[1]![0]!.section).toBe("b");
  });

  test("an over-tall single block still gets placed instead of looping", () => {
    const giant: MeasuredBlock = {
      kind: "bullet",
      sectionId: "s1",
      column: "main",
      itemIndex: 0,
      bulletIndex: 0,
      height: 500,
      gapBefore: 2,
    };
    const blocks = [heading(), entry(), giant];
    const pages = singleSection(blocks, 100);
    expect(pages).toHaveLength(1);
    expect(describeLayout(pages)[0]![0]!.items).toEqual([{ item: 0, head: true, bullets: [0, 1] }]);
  });

  test("the header height reserves sheet-one space above the first block", () => {
    const blocks = [heading(), entry(), bullet(), bullet("s1", 0, 1), bullet("s1", 0, 2)];
    // The same content fits on one sheet with no header and needs two once the
    // header claims 40 of the 60 available.
    expect(packBlocks({ blocks, usableHeight: 60, headerHeight: 0 })).toHaveLength(1);
    expect(packBlocks({ blocks, usableHeight: 60, headerHeight: 40 })).toHaveLength(2);
  });

  test("a section with no items still prints its heading", () => {
    const blocks = [heading(), entry(), heading("s2")];
    const pages = singleSection(blocks, 100);
    expect(pages).toHaveLength(1);
    expect(describeLayout(pages)[0]!.map((s) => s.section)).toEqual(["s1", "s2"]);
    expect(describeLayout(pages)[0]![1]!.items).toEqual([]);
  });

  test("side and main columns are paired sheet for sheet", () => {
    const side: MeasuredBlock[] = [
      { ...heading("skills"), column: "side" },
      { ...entry("skills", 0), column: "side" },
      { ...entry("skills", 1), column: "side" },
    ];
    const main = [heading("experience"), entry("experience", 0)];
    // The sidebar needs two sheets at 40; the main column needs one. The pair
    // is merged per sheet, so sheet 2 carries only the sidebar's continuation.
    const pages = packBlocks({ blocks: [...side, ...main], usableHeight: 40, headerHeight: 0 });
    expect(pages).toHaveLength(2);
    const flat = describeLayout(pages);
    expect(flat[0]!.map((s) => s.section)).toEqual(["skills", "experience"]);
    expect(flat[1]!.map((s) => s.section)).toEqual(["skills"]);
    expect(flat[1]![0]!.continued).toBe(true);
  });

  test("a hairline overrun is absorbed rather than earning a sheet", () => {
    // 49 of content against 48 of usable height: it doesn't fit, but it misses
    // by less than the bottom margin can hide, so a second sheet would be worse
    // than the overrun. Two units further over and it does earn one.
    const blocks = [heading(), entry(), bullet(), bullet()];
    expect(singleSection(blocks, 48)).toHaveLength(1);
    expect(singleSection(blocks, 46)).toHaveLength(2);
  });

  test("an empty flow still yields one empty sheet", () => {
    expect(packBlocks({ blocks: [], usableHeight: 100, headerHeight: 0 })).toHaveLength(1);
  });
});
