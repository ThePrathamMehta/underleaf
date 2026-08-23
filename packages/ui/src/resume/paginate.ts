/**
 * Decides where a resume's sheets end.
 *
 * A sheet is a fixed physical size, so content that outgrows one has to
 * continue on the next. That decision needs real measurements — the height of a
 * bullet depends on the font, the type scale and how the text wraps — but it
 * must produce the *same* answer for the editor canvas and the exported PDF, or
 * the two would disagree about what page 2 starts with.
 *
 * So the measuring is left to whoever has a layout engine (the browser, or
 * Puppeteer on the server) and the deciding lives here: pure arithmetic over
 * measured heights, no DOM and no React. Both callers hand the same numbers to
 * `packBlocks` and render the same slices back.
 */

import type { ResumeContent } from "@repo/types";

/** The smallest run of content pagination is allowed to move on its own. */
export type BlockKind = "heading" | "entry" | "bullet";

/** Which column a block flows in. Single-column templates only use "main". */
export type ColumnId = "main" | "side";

/**
 * One measured block from the unpaginated document flow, in document order.
 *
 * `gapBefore` is measured rather than derived — the space above a block comes
 * from margins that may have collapsed, plus rules and their own margins, and
 * reading it as `top - previousBottom` gets all of that right without this
 * module knowing anything about the stylesheet.
 */
export type MeasuredBlock = {
  kind: BlockKind;
  sectionId: string;
  column: ColumnId;
  /** Position in the section's `items` array; -1 for a heading. */
  itemIndex: number;
  /** Position in the item's `bullets` array; -1 for headings and entries. */
  bulletIndex: number;
  /** Border-box height, in the same unit as `usableHeight`. */
  height: number;
  /** Space between the previous block's bottom edge and this block's top edge. */
  gapBefore: number;
};

/** The part of one item that renders on a given sheet. */
export type ItemSlice = {
  itemIndex: number;
  /**
   * Whether the entry's heading rows (org, role, dates) render here. False on a
   * sheet that continues an entry whose rows appeared on the previous one.
   */
  head: boolean;
  /** Half-open `[start, end)` range of bullets to render. */
  bullets: [number, number];
};

export type SectionSlice = {
  sectionId: string;
  /** True when an earlier sheet already showed this section's heading. */
  continued: boolean;
  items: ItemSlice[];
};

/** What one sheet renders: the sections on it, each with the slice it shows. */
export type PageLayout = SectionSlice[];

export type PackInput = {
  blocks: MeasuredBlock[];
  /** Height available between one sheet's top and bottom margins. */
  usableHeight: number;
  /**
   * Space the name/contact header occupies at the top of the first sheet,
   * measured from the content-box top down to the first block. It therefore
   * includes the gap between the header and the first heading, which is why
   * that first block is charged no `gapBefore`.
   */
  headerHeight: number;
  /** Sections whose `pageBreakBefore` flag forces a fresh sheet. */
  forcedBreaks?: ReadonlySet<string>;
};

/**
 * How far content may overrun the usable height before it earns a new sheet.
 *
 * Not float slop — a deliberate hairline. The bottom margin below the usable
 * area is tens of pixels of intentional whitespace, so overrunning it by a
 * fraction of a millimetre is invisible; what is very visible is a resume that
 * exceeds the page by a rounding error and spends a whole extra sheet on one
 * entry. The seeded sample resume overshoots A4 by 0.5px and did exactly that.
 *
 * Two pixels is about 0.5mm, or 4% of the smallest margin the theme offers.
 */
const OVERFLOW_TOLERANCE = 2;

// --- Grouping ---

type ItemGroup = {
  index: number;
  head: MeasuredBlock | null;
  bullets: MeasuredBlock[];
};

type SectionGroup = {
  id: string;
  heading: MeasuredBlock | null;
  /** Gap below the heading, taken from the first entry's measured `gapBefore`. */
  gapAfterHeading: number;
  items: ItemGroup[];
};

/** Rebuilds the section/item tree from the flat measured list. */
function groupBlocks(blocks: MeasuredBlock[]): SectionGroup[] {
  const sections: SectionGroup[] = [];
  let section: SectionGroup | null = null;
  let item: ItemGroup | null = null;

  for (const block of blocks) {
    if (!section || section.id !== block.sectionId) {
      section = { id: block.sectionId, heading: null, gapAfterHeading: 0, items: [] };
      sections.push(section);
      item = null;
    }

    if (block.kind === "heading") {
      section.heading = block;
      item = null;
      continue;
    }

    if (block.kind === "entry") {
      item = { index: block.itemIndex, head: block, bullets: [] };
      section.items.push(item);
      continue;
    }

    if (!item || item.index !== block.itemIndex) {
      item = { index: block.itemIndex, head: null, bullets: [] };
      section.items.push(item);
    }
    item.bullets.push(block);
  }

  for (const group of sections) {
    const first = group.items[0];
    group.gapAfterHeading = first?.head?.gapBefore ?? first?.bullets[0]?.gapBefore ?? 0;
  }

  return sections;
}

// --- Packing ---

/**
 * Packs one column's sections into sheets.
 *
 * Greedy, one pass, with two structural rules the fill honours as it goes:
 * a heading is never emitted without at least one entry under it, and an
 * entry's heading rows never appear without their first bullet. Both are the
 * page-break behaviour the stylesheet used to ask Chromium for with
 * `break-inside: avoid-page`, now that this module decides instead.
 */
function packColumn(sections: SectionGroup[], input: PackInput): PageLayout[] {
  const { usableHeight, headerHeight, forcedBreaks } = input;

  const pages: PageLayout[] = [];
  let page: PageLayout = [];
  let used = headerHeight;
  /** Sections whose heading has already been shown on an earlier sheet. */
  const seen = new Set<string>();

  const pageEmpty = () => page.length === 0;
  const fits = (cost: number) => used + cost <= usableHeight + OVERFLOW_TOLERANCE;

  function flush() {
    pages.push(page);
    page = [];
    used = 0;
  }

  /** Whether this sheet needs to (re)print `section`'s heading before more content. */
  function needsHeading(sectionId: string): boolean {
    const last = page[page.length - 1];
    return !last || last.sectionId !== sectionId;
  }

  /** The current sheet's slice for `section`, opening one if it has none yet. */
  function sliceFor(section: SectionGroup): SectionSlice {
    const last = page[page.length - 1];
    if (last && last.sectionId === section.id) return last;

    const opened: SectionSlice = {
      sectionId: section.id,
      continued: seen.has(section.id),
      items: [],
    };
    seen.add(section.id);
    page.push(opened);
    return opened;
  }

  /** Cost of the heading itself; zero gap when it starts the sheet. */
  function headingCost(section: SectionGroup): number {
    if (!section.heading) return 0;
    return (pageEmpty() ? 0 : section.heading.gapBefore) + section.heading.height;
  }

  /**
   * Cost of placing `blocks` together, optionally preceded by the heading.
   * The first block's own gap is replaced by the heading's trailing gap when a
   * heading goes in front of it, matching what the renderer will produce.
   */
  function costOf(section: SectionGroup, blocks: MeasuredBlock[], withHeading: boolean): number {
    let total = withHeading ? headingCost(section) : 0;
    blocks.forEach((block, i) => {
      const gap = i === 0 && withHeading ? section.gapAfterHeading : block.gapBefore;
      total += gap + block.height;
    });
    return total;
  }

  for (const section of sections) {
    if (forcedBreaks?.has(section.id) && !pageEmpty()) flush();

    // A section with no items still has to print its heading — otherwise
    // deleting a section's last entry would make the section vanish from the
    // page while still being listed in the sections panel.
    if (section.items.length === 0) {
      if (!fits(headingCost(section)) && !pageEmpty()) flush();
      used += headingCost(section);
      sliceFor(section);
      continue;
    }

    for (const item of section.items) {
      // The entry's rows travel with their first bullet, so a sheet never ends
      // on a job title whose accomplishments start overleaf.
      if (item.head) {
        const unit = item.bullets[0] ? [item.head, item.bullets[0]] : [item.head];
        let withHeading = needsHeading(section.id);
        let cost = costOf(section, unit, withHeading);

        if (!fits(cost) && !pageEmpty()) {
          flush();
          withHeading = true;
          cost = costOf(section, unit, true);
        }

        used += cost;
        sliceFor(section).items.push({
          itemIndex: item.index,
          head: true,
          bullets: [0, item.bullets[0] ? 1 : 0],
        });
      }

      const startBullet = item.head ? 1 : 0;
      for (let k = startBullet; k < item.bullets.length; k++) {
        const block = item.bullets[k]!;
        let withHeading = needsHeading(section.id);
        let cost = costOf(section, [block], withHeading);

        // Widow guard: a single bullet alone on the next sheet reads as a
        // stray line, so when the last two can't both fit, move them together.
        if (k === item.bullets.length - 2 && !pageEmpty() && fits(cost)) {
          const last = item.bullets[k + 1]!;
          if (!fits(cost + last.gapBefore + last.height)) {
            flush();
            withHeading = true;
            cost = costOf(section, [block], true);
          }
        }

        if (!fits(cost) && !pageEmpty()) {
          flush();
          withHeading = true;
          cost = costOf(section, [block], true);
        }

        used += cost;
        const slice = sliceFor(section);
        const open = slice.items[slice.items.length - 1];
        if (open && open.itemIndex === item.index) {
          open.bullets[1] = k + 1;
        } else {
          slice.items.push({ itemIndex: item.index, head: false, bullets: [k, k + 1] });
        }
      }
    }
  }

  if (!pageEmpty() || pages.length === 0) pages.push(page);
  return pages;
}

/**
 * Turns measured blocks into one slice list per sheet.
 *
 * Two-column templates (Deedy) pack each column against the full sheet height
 * independently and pair the results sheet-for-sheet, so both a long sidebar
 * and a long main column flow onto further sheets. Their break points aren't
 * co-ordinated with each other — balancing two columns against a shared break
 * is a larger problem, and the single-column templates don't have it.
 */
export function packBlocks(input: PackInput): PageLayout[] {
  const side = input.blocks.filter((block) => block.column === "side");
  const main = input.blocks.filter((block) => block.column !== "side");

  if (side.length === 0) return packColumn(groupBlocks(main), input);
  if (main.length === 0) return packColumn(groupBlocks(side), input);

  const sidePages = packColumn(groupBlocks(side), input);
  const mainPages = packColumn(groupBlocks(main), input);

  const pages: PageLayout[] = [];
  for (let i = 0; i < Math.max(sidePages.length, mainPages.length); i++) {
    pages.push([...(sidePages[i] ?? []), ...(mainPages[i] ?? [])]);
  }
  return pages;
}

// --- Measurement contract ---

/**
 * Attribute names the renderer stamps on measurable elements. Shared so the
 * canvas and the export read the same DOM shape the primitives write, and a
 * rename can't leave one side silently measuring nothing.
 */
export const BLOCK_ATTR = {
  kind: "data-block",
  section: "data-block-section",
  item: "data-block-item",
  bullet: "data-block-bullet",
} as const;

/** Marks the elements a measuring pass should read, in document order. */
export const BLOCK_SELECTOR = `[${BLOCK_ATTR.kind}]`;

export type MeasuredFlow = {
  blocks: MeasuredBlock[];
  /** Height between a sheet's top and bottom margins. */
  usableHeight: number;
  /** Space the name/contact header takes at the top of the first sheet. */
  headerHeight: number;
};

/**
 * How full sheet one is, as a fraction of its usable height.
 *
 * The companion to `packBlocks`: that answers "how many sheets", this answers "how
 * much of the first one is used", and the two together are what decide whether a
 * one-page resume reads as finished or as a stub.
 *
 * Each column is summed separately and the taller one wins, because `packBlocks`
 * packs the columns of a two-column template independently against the full sheet
 * height. Adding them would report a comfortable sidebar layout as overfull.
 *
 * Can exceed 1: this measures the *unpaginated* flow, so a document that needs two
 * sheets reports the whole of it. Callers that care read `packBlocks(...).length`
 * for the sheet count and treat this purely as a fullness signal.
 *
 * Lives here rather than in `fit-page.ts` because it is the same arithmetic
 * `packColumn` accumulates with, and three callers need it: the grow-to-fill
 * search, the editor's fill signal, and the `check:one-page` script.
 */
export function fillRatio(flow: MeasuredFlow): number {
  if (flow.usableHeight <= 0) return 0;

  const used = (column: ColumnId) =>
    flow.blocks
      .filter((block) => block.column === column)
      .reduce((sum, block) => sum + block.height + block.gapBefore, flow.headerHeight);

  return Math.max(used("main"), used("side")) / flow.usableHeight;
}

/** What `measureFlow` needs to find and identify blocks. See its note on why. */
export type MeasureArgs = {
  /** CSS selector for the element holding the unpaginated document. */
  root: string;
  kind: string;
  section: string;
  item: string;
  bullet: string;
};

/**
 * Reads every marked block out of an unpaginated document, in document order.
 *
 * Runs in two places: the editor's hidden measuring mirror, and inside the
 * Puppeteer page during export. The export reaches it through
 * `page.evaluate(measureFlow, args)`, which stringifies the function and
 * evaluates it in the browser — so **this has to be self-contained**. It may
 * reference DOM and JS globals and nothing else, not even `BLOCK_ATTR`, which
 * is why the attribute names arrive as arguments.
 *
 * Heights come from `getBoundingClientRect`, so they're the real laid-out
 * geometry rather than anything derived from the stylesheet. `gapBefore` is
 * likewise read as the distance from the previous block's bottom edge, which
 * gets collapsed margins and the rule under a heading right without this module
 * knowing they exist.
 */
export function measureFlow(args: MeasureArgs): MeasuredFlow {
  const blocks: MeasuredBlock[] = [];
  const scope = document.querySelector(args.root);
  const sheets = scope ? Array.from(scope.querySelectorAll(".rd-page")) : [];
  let usableHeight = 0;
  let headerHeight = 0;

  sheets.forEach((sheet, sheetIndex) => {
    const style = window.getComputedStyle(sheet);
    const padTop = parseFloat(style.paddingTop) || 0;
    const padBottom = parseFloat(style.paddingBottom) || 0;
    const box = sheet.getBoundingClientRect();
    // Every sheet is the same physical size, so the first one answers for all.
    if (sheetIndex === 0) usableHeight = box.height - padTop - padBottom;

    // Blocks past the bottom edge still report their true position — overflow
    // clips painting, not layout — so one un-split flow measures the whole
    // document. The mirror only has more than one sheet where a section forces
    // a break, and the packer is told about those separately.
    const contentTop = box.top + padTop;
    // Each column flows on its own, so "the previous block" means the previous
    // one in the same column, not the previous one in document order.
    const lastBottom: { side?: number; main?: number } = {};

    sheet.querySelectorAll(`[${args.kind}]`).forEach((node) => {
      const rect = node.getBoundingClientRect();
      const column = node.closest(".rd-col-side") ? "side" : "main";
      const previous = lastBottom[column];

      if (previous === undefined && sheetIndex === 0) {
        // Whatever sits above a column's first block — the name, the contact
        // line, any divider or band — is charged to sheet one as a lump.
        headerHeight = Math.max(headerHeight, rect.top - contentTop);
      }

      const kind = node.getAttribute(args.kind);
      blocks.push({
        kind: kind === "heading" || kind === "bullet" ? kind : "entry",
        sectionId: node.getAttribute(args.section) ?? "",
        column,
        itemIndex: Number(node.getAttribute(args.item) ?? -1),
        bulletIndex: Number(node.getAttribute(args.bullet) ?? -1),
        height: rect.height,
        gapBefore: previous === undefined ? 0 : Math.max(0, rect.top - previous),
      });

      lastBottom[column] = rect.bottom;
    });
  });

  return { blocks, usableHeight, headerHeight };
}

/** The argument `measureFlow` needs, for a mirror rooted at `root`. */
export function measureArgs(root: string): MeasureArgs {
  return {
    root,
    kind: BLOCK_ATTR.kind,
    section: BLOCK_ATTR.section,
    item: BLOCK_ATTR.item,
    bullet: BLOCK_ATTR.bullet,
  };
}

/**
 * The same resume as one uninterrupted flow, for the measuring pass to render.
 *
 * Manual breaks are dropped here and handed to the packer as `forcedBreakIds`
 * instead: measuring wants every block laid out in one column, and re-applying
 * the break during packing puts it back in exactly the same place.
 */
export function toSingleFlow(content: ResumeContent): ResumeContent {
  return {
    ...content,
    sections: content.sections.map((section) => ({ ...section, pageBreakBefore: undefined })),
  };
}

/**
 * Sections whose `pageBreakBefore` flag should start a fresh sheet.
 *
 * A flag on the very first visible section is ignored — there is no page before
 * it to break from, and honouring it would open the resume with a blank sheet.
 */
export function forcedBreakIds(content: ResumeContent): Set<string> {
  const ordered = content.sections
    .filter((section) => section.visible)
    .sort((a, b) => a.order - b.order);

  return new Set(
    ordered.filter((section, i) => i > 0 && section.pageBreakBefore).map((section) => section.id),
  );
}
