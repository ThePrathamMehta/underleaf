"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { FreeformBlock, PlacedItem, ResumeContent, SectionStarter, Theme } from "@repo/types";
import {
  MAX_FREEFORM_PAGES,
  createDividerItem,
  createFreeformBlock,
  createImageItem,
  createSectionStarterBlock,
  createTextItem,
  freeformPageCount,
  isBlankTemplate,
  isDividerItem,
  isImageItem,
  isPlacedItem,
  isTextItem,
  sectionStarterSize,
} from "@repo/types";
import { ResumeDocument, ResumeEditingProvider, baseTemplateSlug, type FieldPath } from "@repo/ui/resume";
import { PAGE_DIMENSIONS } from "@repo/ui/resume/styles";
import {
  BLOCK_ATTR,
  fillRatio,
  forcedBreakIds,
  measureArgs,
  measureFlow,
  packBlocks,
  toSingleFlow,
  type PageLayout,
} from "@repo/ui/resume/paginate";
import { searchFill, searchFit } from "@repo/ui/resume/fit-page";
import { caretSide, columnAtPoint, nearestBox, type Point } from "../../lib/click-to-edit";
import {
  INSERTED_BLOCK_MM,
  MM_TO_PX,
  PAGE_GAP_MM,
  STACK_GAP_MM,
  STACK_INSET_MM,
  centredBox,
  clampPosition,
  mmFromPx,
  newTextBlockBox,
  stackedPosition,
  type Millimetres,
} from "../../lib/freeform-geometry";
import { FreeformLayer } from "./freeform-layer";
import { ImageFrame } from "./image-frame";

/** Root of the hidden mirror the pagination pass measures. */
const MEASURE_ROOT = "[data-measure-root]";

/** Every text field in the document, as marked by `EditableText`. */
const FIELD_SELECTOR = "[data-editable-field]";

/** The two flows of a sidebar template. Absent from the single-column layouts. */
const COLUMN_SELECTOR = ".rd-col-side, .rd-col-main";

/** One freely-placed block on the blank canvas, as marked by `BlankTemplate`. */
const BLOCK_SELECTOR = "[data-free-block]";

/**
 * How far left of the page the per-item actions sit, and how wide their column
 * is. The overlay pads itself back to the page edge with the difference, so the
 * pointer crosses no dead gap on its way to the buttons.
 */
const ITEM_ACTION_OFFSET = 38;
const ITEM_ACTION_WIDTH = 24;

/**
 * Grace period before hover actions disappear.
 *
 * Travelling from the entry to its buttons means leaving the page element, and
 * clearing on that instant made the buttons impossible to click — they vanished
 * as the pointer arrived.
 */
const HOVER_CLEAR_MS = 260;

type Anchor = { top: number; left: number; width: number; height: number };

/**
 * Where a dragged item would land: a slot in a section's items, plus the line to
 * draw for it.
 *
 * `anchor` is in the scroll container's own coordinates rather than the
 * viewport's, so scrolling mid-drag doesn't invalidate it.
 */
type DropTarget = { sectionId: string; index: number; anchor: Anchor };

/** A drag in progress, with every gap it could land in worked out up front. */
type Drag = { itemId: string; targets: DropTarget[] };

/** A slot in a section's items, as the Insert menu resolves one. */
type InsertionPoint = { sectionId: string; index: number };

/** What the Insert menu can add. Deliberately these three and no more (v6 §2.4). */
export type InsertKind = "text" | "image" | "divider";

/**
 * What an insert produced, so an image upload can fill it in afterwards — or take
 * it back out if the upload fails.
 *
 * Two shapes because the two kinds of document hold an image differently: a canvas
 * block keeps its URL in `content`, while a flowed item keeps it in `src` and needs
 * its section named to be removed again.
 */
export type Inserted =
  | { kind: "block"; blockId: string }
  | { kind: "item"; sectionId: string; itemId: string };

/**
 * Scrolling and inserting, exposed to the editor page.
 *
 * The scroll container, the sheets and their measured geometry all live inside the
 * canvas, so it is the only place that can move them — or work out where a new
 * block goes. Going through here also keeps every lookup scoped to the visible
 * document: a bare `document.querySelector` would now also match the measuring
 * mirror below.
 */
export type CanvasHandle = {
  scrollToPage: (pageIndex: number) => void;
  scrollToSection: (sectionId: string) => void;
  /**
   * Adds one thing and returns what it added, or null when there was nowhere to
   * put it. `at` is a point in client coordinates — a drop — and without it the
   * insert lands on the sheet in view, at the caret if there is one.
   */
  insert: (kind: InsertKind, at?: Point) => Inserted | null;
  /**
   * Blank canvas only: a starter section, stacked under whatever is already on the
   * page. Null on a template resume, whose sections come from the outline panel.
   */
  insertSection: (kind: SectionStarter) => Inserted | null;
  /**
   * The loosest theme that would put this document back inside `targetPages`
   * sheets, or null when tightening alone can't.
   *
   * Answered here because the measuring mirror lives here, and the search is
   * dozens of trial layouts — every one of them a write to the mirror's CSS
   * variables and a re-read of its geometry, which is only possible from inside
   * this component. Nothing is applied: the caller decides whether to take it, so
   * a fit is something a user asked for rather than something that happened.
   */
  fitTheme: (targetPages: number, templateDefault?: Theme) => Theme | null;
  /**
   * The mirror of `fitTheme`: the theme that would *fill* the page, or null when
   * the document is already as full as growing the type can make it.
   *
   * Same reasons it lives here, and the same restraint — nothing is applied, so a
   * fill is something the user accepted rather than something that happened to
   * their document while they typed.
   */
  fillTheme: (targetPages: number, templateDefault?: Theme) => Theme | null;
};

/**
 * The document canvas.
 *
 * The page keeps its true mm geometry and only the wrapper is scaled, so zoom
 * never changes what the PDF will measure. Contextual controls float in an
 * overlay measured from the DOM rather than being nested inside the page, which
 * keeps non-printing chrome out of the rendered document entirely.
 */
export function EditorCanvas({
  templateSlug,
  content,
  theme,
  zoom,
  focusedSectionId,
  handleRef,
  onFieldChange,
  onFieldCommit,
  onFocusSection,
  onAddItem,
  onRemoveItem,
  onAddBullet,
  onAddTextItem,
  onMoveItem,
  onAddPlacedItem,
  onResizeImage,
  onImageFile,
  onAddBlock,
  onMoveBlock,
  onResizeBlock,
  onRemoveBlock,
  onPagesChange,
  onFillChange,
  onActivePageChange,
}: {
  templateSlug: string;
  content: ResumeContent;
  theme: Theme;
  zoom: number;
  focusedSectionId: string | null;
  /** Filled with the scrolling handle above while the canvas is mounted. */
  handleRef?: React.RefObject<CanvasHandle | null>;
  onFieldChange: (path: FieldPath, value: string) => void;
  onFieldCommit: () => void;
  onFocusSection: (id: string | null) => void;
  onAddItem: (sectionId: string) => void;
  onRemoveItem: (sectionId: string, itemId: string) => void;
  onAddBullet: (sectionId: string, itemId: string) => void;
  /** Inserts a blank text block at `index` among the section's items. */
  onAddTextItem: (sectionId: string, index: number) => void;
  /** Commits a drag: the item lands at `index` in `toSectionId`. */
  onMoveItem: (itemId: string, toSectionId: string, index: number) => void;
  /** Insert on a template resume: an already-built note, image or rule. */
  onAddPlacedItem: (sectionId: string, index: number, item: PlacedItem) => void;
  /** A flowed image's new width, as a share of the column it sits in. */
  onResizeImage: (itemId: string, widthPercent: number) => void;
  /**
   * An image file to upload and place. The canvas resolves *where* — the page owns
   * the upload, because it owns the API client and the error banner.
   */
  onImageFile: (file: File, at?: Point) => void;
  /** Blank canvas: places an already-built block, so the caller knows its id. */
  onAddBlock: (block: FreeformBlock) => void;
  onMoveBlock: (blockId: string, page: number, position: Millimetres) => void;
  onResizeBlock: (
    blockId: string,
    position: Millimetres,
    size: { width: number; height: number },
  ) => void;
  onRemoveBlock: (blockId: string) => void;
  /** How many sheets the measured layout produced. */
  onPagesChange?: (pageCount: number) => void;
  /**
   * How full sheet one is, as a fraction of its usable height. Never called for a
   * canvas, whose sheets aren't packed and so have no fill to report.
   */
  onFillChange?: (fill: number) => void;
  /** Which sheet currently fills most of the viewport. */
  onActivePageChange?: (pageIndex: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [sectionAnchor, setSectionAnchor] = useState<Anchor | null>(null);
  const [hoveredItem, setHoveredItem] = useState<{ id: string; anchor: Anchor } | null>(null);
  const hoverClearRef = useRef<number | null>(null);
  const [layout, setLayout] = useState<PageLayout[] | null>(null);
  /**
   * How full sheet one is, or null on a canvas and before the first measurement.
   *
   * Kept beside `layout` because it comes from the same measured flow, and reported
   * outward the same way the sheet count is: the editor needs it to decide whether
   * to offer the fill, and nothing outside this component can measure it.
   */
  const [fill, setFill] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  // The pointer-up handler is subscribed once per drag, so it can't close over
  // the target state; this is what it reads to commit the move.
  const dropTargetRef = useRef<DropTarget | null>(null);
  dropTargetRef.current = dropTarget;
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  /**
   * The placed item under selection on a template resume, and its measured box.
   *
   * An image holds no text, so clicking one can't be answered with a caret the way
   * every other click on the sheet is — selecting it is the answer instead, and what
   * puts its resize handle on screen. Kept separate from `hoveredItem` deliberately:
   * a frame that came and went with the pointer would disappear on the way to its
   * own handle.
   */
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [itemAnchor, setItemAnchor] = useState<Anchor | null>(null);
  /** Whether a file is being dragged over the canvas, for the drop hint. */
  const [dropping, setDropping] = useState(false);
  /** A block or item just created, to be focused once React has drawn it. */
  const pendingFocusRef = useRef<string | null>(null);
  /**
   * A block just created that has to be scrolled to, rather than typed in.
   *
   * Separate from `pendingFocusRef` because a starter section is selected without
   * taking the caret — everything in it is placeholder text meant to be clicked
   * into, and a caret parked at the top of the heading would put the first keystroke
   * in the one line the user is least likely to want to change.
   */
  const pendingRevealRef = useRef<string | null>(null);
  /**
   * The entry the caret was last in, so an Insert lands where the user was working.
   *
   * A ref rather than state, and read rather than watched: opening the Insert menu
   * moves focus to its button, so by the time anything is chosen `document.activeElement`
   * is the trigger and no longer says anything about the document.
   */
  const lastEntryRef = useRef<InsertionPoint | null>(null);

  /**
   * Which kind of document this is.
   *
   * The blank canvas has no sections to measure or pack — its blocks carry their
   * own coordinates — so the whole pagination pass is skipped and the sheet count
   * comes from the blocks instead. Read through `baseTemplateSlug` to agree with
   * the renderer, which branches on exactly the same value.
   */
  const freeform = isBlankTemplate(baseTemplateSlug(templateSlug));
  const blocks = useMemo(() => content.freeformBlocks ?? [], [content.freeformBlocks]);

  const page = PAGE_DIMENSIONS[theme.pageSize];
  const pageWidthPx = page.width * MM_TO_PX;
  const pageHeightPx = page.height * MM_TO_PX;
  // Reserve height for every page plus the on-screen gaps between them; the
  // transform doesn't affect flow, so the wrapper must account for the stack.
  const pages = freeform ? freeformPageCount(blocks) : (layout?.length ?? 1);
  const stackHeightPx = pages * pageHeightPx + (pages - 1) * PAGE_GAP_MM * MM_TO_PX;

  // --- Pagination ---

  // The mirror renders one uninterrupted flow; manual breaks come back as
  // forced breaks during packing, landing in the same place.
  const measureContent = useMemo(() => toSingleFlow(content), [content]);
  const forcedBreaks = useMemo(() => forcedBreakIds(content), [content]);

  const remeasure = useCallback(() => {
    // Nothing to measure on a canvas: a freeform block's own coordinates already
    // say which sheet it is on and where.
    if (freeform) return;
    const flow = measureFlow(measureArgs(MEASURE_ROOT));
    if (flow.usableHeight <= 0) return;
    setLayout(packBlocks({ ...flow, forcedBreaks }));
    setFill(fillRatio(flow));
  }, [forcedBreaks, freeform]);

  // Layout effect, not effect: this runs before paint, so the sheets are never
  // shown with a stale break and then reflowed in front of the user.
  useLayoutEffect(() => {
    remeasure();
  }, [remeasure, measureContent, templateSlug, theme]);

  // Fonts settle asynchronously, and every height here depends on their
  // metrics — measuring against a fallback face breaks in the wrong place.
  useEffect(() => {
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) remeasure();
    });
    return () => {
      cancelled = true;
    };
  }, [remeasure, measureContent, templateSlug, theme]);

  // The rail is a sibling, so it learns the sheet count from here — it's a
  // property of the measured layout, and nothing outside this component can
  // derive it.
  useEffect(() => {
    onPagesChange?.(pages);
  }, [onPagesChange, pages]);

  // Same reason, same shape: how full the first sheet is belongs to the measured
  // layout, and the banner that offers to fill it lives outside this component.
  useEffect(() => {
    if (fill !== null) onFillChange?.(fill);
  }, [onFillChange, fill]);

  // --- Navigation ---

  /** The nth sheet of the *visible* document; never the mirror's. */
  const sheetAt = useCallback(
    (index: number) => pageRef.current?.querySelectorAll<HTMLElement>(".rd-page")[index] ?? null,
    [],
  );

  /**
   * The sheet the user is looking at: the last one whose top edge is above the
   * middle of the viewport.
   *
   * The same rule the page rail highlights by, so an insert with nothing pointed at
   * lands on the sheet the toolbar is calling the current one.
   */
  const visibleSheet = useCallback((): HTMLElement | null => {
    const container = scrollRef.current;
    const sheets = pageRef.current?.querySelectorAll<HTMLElement>(".rd-page");
    if (!container || !sheets?.length) return null;

    const middle = container.getBoundingClientRect().top + container.clientHeight / 2;
    let visible = sheets[0]!;
    sheets.forEach((sheet) => {
      if (sheet.getBoundingClientRect().top <= middle) visible = sheet;
    });
    return visible;
  }, []);

  /**
   * Where on a sheet to put something nobody pointed at: the middle of the part of
   * it that is actually on screen.
   *
   * Not the middle of the sheet — on a page scrolled halfway past, that is off the
   * top of the view, and a block inserted there would appear to have gone nowhere.
   */
  const sheetPoint = useCallback((sheet: HTMLElement): Point => {
    const box = sheet.getBoundingClientRect();
    const view = scrollRef.current!.getBoundingClientRect();
    const top = Math.max(box.top, view.top);
    const bottom = Math.min(box.bottom, view.bottom);

    return {
      x: box.left + box.width / 2,
      // Falls back to the sheet's own middle when none of it is in view, which the
      // rule above allows for a single sheet scrolled entirely past.
      y: top < bottom ? (top + bottom) / 2 : box.top + box.height / 2,
    };
  }, []);

  // Which sheet the rail should highlight: whichever one covers the middle of
  // the viewport, so a sheet only becomes "current" once it genuinely dominates
  // the view rather than the instant its top edge appears.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !onActivePageChange) return;

    function update() {
      const box = container!.getBoundingClientRect();
      const middle = box.top + box.height / 2;
      const sheets = pageRef.current?.querySelectorAll<HTMLElement>(".rd-page");
      if (!sheets?.length) return;

      let active = 0;
      sheets.forEach((sheet, index) => {
        if (sheet.getBoundingClientRect().top <= middle) active = index;
      });
      onActivePageChange!(active);
    }

    update();
    container.addEventListener("scroll", update, { passive: true });
    return () => container.removeEventListener("scroll", update);
  }, [onActivePageChange, pages, zoom]);

  /** Converts a client rect into coordinates within the scrolling container. */
  const toLocal = useCallback((rect: DOMRect): Anchor => {
    const container = scrollRef.current!;
    const base = container.getBoundingClientRect();
    return {
      top: rect.top - base.top + container.scrollTop,
      left: rect.left - base.left + container.scrollLeft,
      width: rect.width,
      // Without this the overlay box collapsed to zero height, which put the
      // focus ring and the "Add entry" button over the section heading instead
      // of around and below the section.
      height: rect.height,
    };
  }, []);

  const cancelHoverClear = useCallback(() => {
    if (hoverClearRef.current === null) return;
    window.clearTimeout(hoverClearRef.current);
    hoverClearRef.current = null;
  }, []);

  const scheduleHoverClear = useCallback(() => {
    cancelHoverClear();
    hoverClearRef.current = window.setTimeout(() => setHoveredItem(null), HOVER_CLEAR_MS);
  }, [cancelHoverClear]);

  useEffect(() => cancelHoverClear, [cancelHoverClear]);

  // --- The blank canvas ---

  /**
   * Puts the caret in whatever text a block or item holds. False when it has none.
   *
   * One function for both kinds of document, because both ways of conjuring
   * something to type in want the same thing next: a canvas block, and a text item
   * inserted into a template's flow. They are found by different attributes — the
   * blank renderer stamps `data-free-block`, the flowed one `data-item-id` — but an
   * id is unique across the document either way, so asking for both is safe.
   */
  const focusEditable = useCallback((id: string) => {
    const field = pageRef.current?.querySelector<HTMLElement>(
      `[data-free-block="${id}"] ${FIELD_SELECTOR}, [data-item-id="${id}"] ${FIELD_SELECTOR}`,
    );
    field?.focus();
    return Boolean(field);
  }, []);

  // Something created by a click or an insert can only be focused once React has
  // drawn it, which is a render later than the dispatch that made it. Keyed on the
  // whole content, not just the blocks, so an inserted text *item* is caught too.
  useLayoutEffect(() => {
    const id = pendingFocusRef.current;
    if (id && focusEditable(id)) pendingFocusRef.current = null;

    // A stacked insert can land on a sheet the user isn't looking at, or below the
    // fold of the one they are, so it says where it went.
    const reveal = pendingRevealRef.current;
    const element = reveal
      ? pageRef.current?.querySelector(`[data-free-block="${reveal}"]`)
      : null;
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      pendingRevealRef.current = null;
    }
  }, [content, focusEditable]);

  /**
   * The caret waiting in the name on a canvas nobody has typed in yet.
   *
   * The heading itself is placed when the resume is created, not here — but landing
   * with it focused is the point of pre-placing it, and it is what turns "a blank
   * page and a cursor" into somewhere to start. Only while the whole document is
   * still empty: stealing the caret every time a finished canvas is reopened would
   * put it somewhere the user didn't ask for.
   */
  const openedRef = useRef(false);
  useLayoutEffect(() => {
    if (openedRef.current || !freeform || blocks.length === 0) return;
    openedRef.current = true;

    const first = blocks[0];
    if (first?.type !== "heading" || blocks.some((block) => block.content !== "")) return;
    setSelectedBlockId(first.id);
    focusEditable(first.id);
  }, [blocks, focusEditable, freeform]);

  /**
   * A click on bare paper, as a text block to type in.
   *
   * This is the blank canvas's whole premise: the page is empty, and pointing at
   * part of it is how you say you want words there. No menu and no drag — Word and
   * Canva both treat a click on nothing as "start typing here", and asking which
   * kind of block first would put a dialog between the user and their first word.
   */
  const createTextBlockAt = useCallback(
    (client: Point, sheet: HTMLElement) => {
      const rect = sheet.getBoundingClientRect();
      const block = createFreeformBlock({
        type: "text",
        page: Number(sheet.dataset.pageIndex) || 0,
        ...newTextBlockBox(
          {
            x: mmFromPx(client.x - rect.left, zoom),
            y: mmFromPx(client.y - rect.top, zoom),
          },
          page,
        ),
      });

      pendingFocusRef.current = block.id;
      setSelectedBlockId(block.id);
      onAddBlock(block);
    },
    [onAddBlock, page, zoom],
  );

  // --- Insert ---

  /**
   * Which slot in which section an insert lands in, or null when there is nowhere
   * to put it — a template resume whose sections have all been deleted.
   *
   * A point, meaning a dropped file, is answered by what is under it: the section it
   * landed on, after the entry it landed on. Without one the answer is where the
   * user was last working — the caret's own entry when the section still matches,
   * and otherwise the end of whichever section is in view.
   */
  const insertionPoint = useCallback(
    (at?: Point): InsertionPoint | null => {
      const root = pageRef.current;
      const rendered = root ? Array.from(root.querySelectorAll<HTMLElement>("[data-section-id]")) : [];
      if (!root || rendered.length === 0) return null;

      const itemCount = (sectionId: string) =>
        content.sections.find((section) => section.id === sectionId)?.items.length ?? 0;

      if (at) {
        const element = document.elementFromPoint(at.x, at.y) as HTMLElement | null;
        // Containment check rather than trusting the hit test: a drop on the grey
        // canvas either side of the page still lands on this component.
        const sectionEl = root.contains(element)
          ? element!.closest<HTMLElement>("[data-section-id]")
          : null;

        if (sectionEl?.dataset.sectionId) {
          const sectionId = sectionEl.dataset.sectionId;
          const entryEl = element!.closest<HTMLElement>(`[${BLOCK_ATTR.item}]`);
          const index = Number(entryEl?.dataset.blockItem);

          return {
            sectionId,
            // After the entry it was dropped on; at the end when it missed them
            // all, which is what the space below a section's last line means.
            index:
              entryEl?.dataset.blockSection === sectionId && Number.isInteger(index)
                ? index + 1
                : itemCount(sectionId),
          };
        }
      }

      const middle =
        scrollRef.current!.getBoundingClientRect().top + scrollRef.current!.clientHeight / 2;
      let inView = rendered[0]!;
      rendered.forEach((sectionEl) => {
        if (sectionEl.getBoundingClientRect().top <= middle) inView = sectionEl;
      });

      // The focused section wins, but only while it is still on the page: a section
      // deleted from the panel leaves its id behind in `focusedSectionId`.
      const sectionId =
        focusedSectionId && rendered.some((el) => el.dataset.sectionId === focusedSectionId)
          ? focusedSectionId
          : inView.dataset.sectionId!;

      const entry = lastEntryRef.current;
      return entry?.sectionId === sectionId ? entry : { sectionId, index: itemCount(sectionId) };
    },
    [content.sections, focusedSectionId],
  );

  /**
   * Adds one image, rule or text box, and says what it added.
   *
   * The two documents place things differently enough that this is really two
   * functions behind one name, and that is the point: the toolbar asks for an image
   * without knowing whether it is about to become a block on a canvas or an item in
   * a section's flow. Only the canvas knows which document it is showing, where the
   * caret was, and which sheet is in view — so only the canvas can answer "where".
   *
   * A text box takes the caret straight away; there is nothing else to do with one.
   * An image or a rule takes the selection instead, which is what puts an image's
   * resize handle under the pointer without a second click.
   */
  const insert = useCallback(
    (kind: InsertKind, at?: Point): Inserted | null => {
      if (freeform) {
        const sheet = (at ? sheetFromPoint(pageRef.current, at) : null) ?? visibleSheet();
        if (!sheet) return null;

        const point = at ?? sheetPoint(sheet);
        const rect = sheet.getBoundingClientRect();
        const block = createFreeformBlock({
          type: kind,
          page: Number(sheet.dataset.pageIndex) || 0,
          ...centredBox(
            { x: mmFromPx(point.x - rect.left, zoom), y: mmFromPx(point.y - rect.top, zoom) },
            INSERTED_BLOCK_MM[kind],
            page,
          ),
        });

        if (kind === "text") pendingFocusRef.current = block.id;
        setSelectedBlockId(block.id);
        onAddBlock(block);
        return { kind: "block", blockId: block.id };
      }

      const slot = insertionPoint(at);
      if (!slot) return null;

      const item =
        kind === "image"
          ? createImageItem()
          : kind === "divider"
            ? createDividerItem()
            : createTextItem();

      if (kind === "text") pendingFocusRef.current = item.id;
      else setSelectedItemId(item.id);
      onFocusSection(slot.sectionId);
      onAddPlacedItem(slot.sectionId, slot.index, item);
      return { kind: "item", sectionId: slot.sectionId, itemId: item.id };
    },
    [
      freeform,
      insertionPoint,
      onAddBlock,
      onAddPlacedItem,
      onFocusSection,
      page,
      sheetPoint,
      visibleSheet,
      zoom,
    ],
  );

  /**
   * The left edge the blocks on a sheet line up on, and the millimetre line the next
   * one down should start at.
   *
   * Measured from the rendered page rather than from stored geometry: a text block's
   * height is whatever its words came to, and many blocks carry no explicit size at
   * all. A sheet nobody has put anything on — including one that doesn't exist yet —
   * answers with the standing inset, which is where the pre-placed name heading sits.
   */
  const sheetStack = useCallback(
    (pageIndex: number): Millimetres => {
      const sheet = sheetAt(pageIndex);
      const rect = sheet?.getBoundingClientRect();
      const placed = sheet?.querySelectorAll<HTMLElement>(BLOCK_SELECTOR);
      if (!rect || !placed?.length) return { x: STACK_INSET_MM, y: STACK_INSET_MM };

      let x = Infinity;
      let bottom = -Infinity;
      placed.forEach((element) => {
        const box = element.getBoundingClientRect();
        x = Math.min(x, mmFromPx(box.left - rect.left, zoom));
        bottom = Math.max(bottom, mmFromPx(box.bottom - rect.top, zoom));
      });

      return { x, y: bottom + STACK_GAP_MM };
    },
    [sheetAt, zoom],
  );

  /**
   * A starter section, on the first sheet from here down that has room for it.
   *
   * Stacked rather than placed where the pointer is, because that is the whole point
   * of the picker: a section is a column of text that belongs under the last one, and
   * asking the user to position it would be asking them to do the thing they came
   * here to avoid. It runs on to the next sheet when this one is full — and takes the
   * foot of the last sheet regardless if the document is somehow full to the cap,
   * since an overlap they can drag apart beats a click that did nothing.
   */
  const insertSection = useCallback(
    (kind: SectionStarter): Inserted | null => {
      if (!freeform) return null;

      const size = sectionStarterSize(kind);
      const from = Number(visibleSheet()?.dataset.pageIndex) || 0;

      let target = from;
      let position: Millimetres | null = null;
      for (let index = from; index < MAX_FREEFORM_PAGES && !position; index++) {
        target = index;
        position = stackedPosition(sheetStack(index), size, page);
      }

      const block = createSectionStarterBlock(kind, {
        page: target,
        position: position ?? clampPosition(sheetStack(target), size, page),
      });

      setSelectedBlockId(block.id);
      pendingRevealRef.current = block.id;
      onAddBlock(block);
      return { kind: "block", blockId: block.id };
    },
    [freeform, onAddBlock, page, sheetStack, visibleSheet],
  );

  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      scrollToPage: (index) => sheetAt(index)?.scrollIntoView({ behavior: "smooth", block: "start" }),
      scrollToSection: (sectionId) =>
        pageRef.current
          ?.querySelector(`[data-section-id="${sectionId}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" }),
      insert,
      insertSection,
      // A canvas paginates nothing — its sheets exist because its blocks say so,
      // and no amount of tighter leading moves a block off page two.
      fitTheme: (targetPages, templateDefault) =>
        freeform
          ? null
          : searchFit({ measureRoot: MEASURE_ROOT, theme, templateDefault, forcedBreaks, targetPages }),
      // Likewise: leading cannot fill a canvas, whose emptiness is a property of
      // where its blocks were put.
      fillTheme: (targetPages, templateDefault) =>
        freeform
          ? null
          : searchFill({ measureRoot: MEASURE_ROOT, theme, templateDefault, forcedBreaks, targetPages }),
    };
    return () => {
      handleRef.current = null;
    };
  }, [forcedBreaks, freeform, handleRef, insert, insertSection, sheetAt, theme]);

  // --- Drag and drop ---

  /**
   * Starts a drag and works out every gap the item could land in.
   *
   * The gaps come from the pagination attributes rather than from the content:
   * an entry's `data-block-item` is its index in the real items array, so a
   * section split across two sheets still yields the right slot on both. The
   * whole set is computed once, at drag start — reading rects on every pointer
   * move would force layout dozens of times a second.
   */
  const beginDrag = useCallback(
    (itemId: string) => {
      const root = pageRef.current;
      if (!root || !scrollRef.current) return;

      const targets: DropTarget[] = [];

      root.querySelectorAll<HTMLElement>("[data-section-id]").forEach((sectionEl) => {
        const sectionId = sectionEl.dataset.sectionId!;
        const box = toLocal(sectionEl.getBoundingClientRect());
        const line = (top: number, index: number) => {
          targets.push({ sectionId, index, anchor: { top, left: box.left, width: box.width, height: 0 } });
        };

        let afterLast = 0;
        sectionEl.querySelectorAll<HTMLElement>('[data-block="entry"]').forEach((entryEl) => {
          const index = Number(entryEl.dataset.blockItem);
          if (entryEl.dataset.blockSection !== sectionId || !Number.isInteger(index)) return;
          // The gap *above* this entry, i.e. taking its slot and pushing it down.
          line(toLocal(entryEl.getBoundingClientRect()).top, index);
          afterLast = Math.max(afterLast, index + 1);
        });

        // And the gap below everything this sheet shows of the section — which
        // for an empty section is its only gap, so text can go there too.
        line(box.top + box.height, afterLast);
      });

      setDropTarget(null);
      setDrag({ itemId, targets });
    },
    [toLocal],
  );

  // Live while a drag is running, and only then: the window listeners are what
  // let the pointer leave the grip, and Escape abandons the drag without moving
  // anything.
  useEffect(() => {
    if (!drag) return;
    const container = scrollRef.current;
    if (!container) return;

    function nearestTarget(clientY: number): DropTarget | null {
      const base = container!.getBoundingClientRect();
      const y = clientY - base.top + container!.scrollTop;
      let best: DropTarget | null = null;
      let bestDistance = Infinity;

      for (const target of drag!.targets) {
        const distance = Math.abs(target.anchor.top - y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = target;
        }
      }
      return best;
    }

    function onPointerMove(event: PointerEvent) {
      setDropTarget(nearestTarget(event.clientY));
    }

    function onPointerUp() {
      // Read through the ref: this listener is subscribed once per drag, so it
      // closes over the target state as it was when the drag began.
      const target = dropTargetRef.current;
      if (target) onMoveItem(drag!.itemId, target.sectionId, target.index);
      setDrag(null);
      setDropTarget(null);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setDrag(null);
      setDropTarget(null);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [drag, onMoveItem]);

  // Re-measure whenever the focused section, content, layout or zoom changes —
  // all of them can move the anchor, and a stale overlay points at the wrong
  // place. `layout` matters because repagination moves a section bodily to
  // another sheet.
  useLayoutEffect(() => {
    if (!focusedSectionId || !scrollRef.current) {
      setSectionAnchor(null);
      return;
    }

    const element = pageRef.current?.querySelector(`[data-section-id="${focusedSectionId}"]`);
    setSectionAnchor(element ? toLocal(element.getBoundingClientRect()) : null);
  }, [focusedSectionId, content, layout, zoom, theme, toLocal]);

  /**
   * The selected image's box, on the same terms.
   *
   * A pass of its own rather than a branch of the one above, because an image can be
   * selected with no section focused, and because the two go stale on different
   * things — this one also has to survive the image being resized from its handle.
   *
   * Measured on the picture rather than its wrapper: the wrapper is the full width of
   * the column whatever the image does, and a frame drawn around that would sit far
   * out to the right of a small photo.
   */
  useLayoutEffect(() => {
    if (!selectedItemId || !scrollRef.current) {
      setItemAnchor(null);
      return;
    }

    const element = pageRef.current?.querySelector(
      `.rd-item-image[data-item-id="${selectedItemId}"] > *`,
    );
    setItemAnchor(element ? toLocal(element.getBoundingClientRect()) : null);
  }, [selectedItemId, content, layout, zoom, theme, toLocal]);

  // Clicking away from the page clears the selection.
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement;
      if (target.closest("[data-canvas-overlay]") || pageRef.current?.contains(target)) return;
      onFocusSection(null);
      setSelectedBlockId(null);
      setSelectedItemId(null);
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onFocusSection]);

  const focusedSection = content.sections.find((s) => s.id === focusedSectionId) ?? null;
  // Summary sections hold at most one item, so offering "add entry" would only
  // produce a value the schema rejects.
  const canAddItem = focusedSection !== null && focusedSection.type !== "summary";

  /** The selected item, when it is an image — the only kind with a frame to draw. */
  const selectedImage = useMemo(() => {
    if (!selectedItemId) return null;
    for (const section of content.sections) {
      const item = section.items.find((candidate) => candidate.id === selectedItemId);
      if (item) return isImageItem(item) ? item : null;
    }
    return null;
  }, [content.sections, selectedItemId]);

  function handleCanvasPointerOver(event: React.PointerEvent) {
    // A drag owns the overlay until it ends; letting hover move it would take
    // the grip out from under the pointer mid-gesture.
    if (drag) return;

    const itemEl = (event.target as HTMLElement).closest<HTMLElement>("[data-item-id]");
    if (!itemEl || !scrollRef.current) {
      // Still inside the page, just between entries — give the same grace as
      // leaving it, so crossing a gap doesn't dismiss the buttons.
      scheduleHoverClear();
      return;
    }
    cancelHoverClear();
    setHoveredItem({ id: itemEl.dataset.itemId!, anchor: toLocal(itemEl.getBoundingClientRect()) });
  }

  function handleCanvasFocusIn(event: React.FocusEvent) {
    const target = event.target as HTMLElement;
    // On a canvas, focus is the selection: tabbing or clicking into a block's text
    // is what puts the frame and its handles around it.
    const blockEl = target.closest<HTMLElement>(BLOCK_SELECTOR);
    if (blockEl?.dataset.freeBlock) setSelectedBlockId(blockEl.dataset.freeBlock);

    // Where an Insert should land, remembered now rather than read later: opening
    // the menu moves focus to its button, and by then the document has forgotten.
    // The slot is *after* this entry, which is where "insert here" means on the line
    // you are typing on.
    const entryEl = target.closest<HTMLElement>(`[${BLOCK_ATTR.item}]`);
    const index = Number(entryEl?.dataset.blockItem);
    lastEntryRef.current =
      entryEl?.dataset.blockSection && Number.isInteger(index)
        ? { sectionId: entryEl.dataset.blockSection, index: index + 1 }
        : null;

    const sectionEl = target.closest<HTMLElement>("[data-section-id]");
    if (sectionEl) onFocusSection(sectionEl.dataset.sectionId!);
  }

  /**
   * Click-to-edit anywhere on the sheet.
   *
   * A resume is mostly whitespace, and every part of it should be a way into the
   * text: the space under an entry's last bullet, the room to the right of a short
   * line, the band between two sections. A click that misses the words themselves
   * used to land on a plain `<div>` and do nothing, leaving the user to hunt for a
   * character to aim at.
   *
   * Two-column templates need the sidebar and the main column treated as separate
   * flows, or a click in the dead space below a short main column would land in
   * whichever sidebar entry happened to be level with it — the caret jumping the
   * page to a section the user never pointed at. `columnAtPoint` is what keeps the
   * search on the side of the page that was clicked.
   *
   * The blank canvas answers the same click differently. There is no nearest text
   * to fall back to and no flow to join, so bare paper becomes a new block instead:
   * on a canvas, the empty space *is* the document.
   */
  function handleCanvasPointerDown(event: React.PointerEvent) {
    const target = event.target as HTMLElement;
    // Primary button only, and never while extending a selection.
    if (event.button !== 0 || event.shiftKey) return;

    const sheet = target.closest<HTMLElement>(".rd-page");
    if (!sheet) return;

    if (freeform) {
      const blockEl = target.closest<HTMLElement>(BLOCK_SELECTOR);
      // Inside a block: selecting it is all this needs to do. If it holds text the
      // browser is about to place the caret between the two characters clicked,
      // which is better than anything done by hand here.
      if (blockEl?.dataset.freeBlock) {
        setSelectedBlockId(blockEl.dataset.freeBlock);
        return;
      }
      event.preventDefault();
      createTextBlockAt({ x: event.clientX, y: event.clientY }, sheet);
      return;
    }

    // A click that already found text: the browser places the caret between the
    // exact two characters clicked, which is better than any box arithmetic.
    if (target.closest(FIELD_SELECTOR)) {
      setSelectedItemId(null);
      return;
    }

    /*
      An image or a rule holds no text, so a click on one cannot be answered with a
      caret the way every other click on the sheet is — selecting it is the answer
      instead, and for an image that is what puts its resize handle on screen.

      Without this the click would fall through to the nearest-field search below and
      fling the caret into whatever text happened to be closest, which for a photo at
      the top of a sidebar is a heading on the other side of the page.
    */
    const placedEl = target.closest<HTMLElement>(".rd-item-image, .rd-item-divider");
    if (placedEl?.dataset.itemId) {
      // Keeps the press from starting a drag-select through the picture.
      event.preventDefault();
      setSelectedItemId(placedEl.dataset.itemId);
      const sectionEl = placedEl.closest<HTMLElement>("[data-section-id]");
      if (sectionEl?.dataset.sectionId) onFocusSection(sectionEl.dataset.sectionId);
      return;
    }
    // Anywhere else on the sheet: the frame goes away, like clicking off a picture
    // in any editor.
    setSelectedItemId(null);

    const point: Point = { x: event.clientX, y: event.clientY };
    const column = columnAtPoint(boxesIn(sheet, COLUMN_SELECTOR), point);
    const field = nearestBox(boxesIn(column?.el ?? sheet, FIELD_SELECTOR), point);
    if (!field) return;

    // Keeps the browser from collapsing the selection we are about to make, and
    // from starting a drag-select out of a node that holds no text.
    event.preventDefault();
    placeCaret(field.el, caretSide(field.box, point));
  }

  const hoveredItemSection = hoveredItem
    ? content.sections.find((s) => s.items.some((item) => item.id === hoveredItem.id))
    : null;
  const hoveredItemIndex = hoveredItemSection
    ? hoveredItemSection.items.findIndex((item) => item.id === hoveredItem!.id)
    : -1;
  const hoveredEntry = hoveredItemIndex >= 0 ? hoveredItemSection!.items[hoveredItemIndex] : null;
  // A note, an image or a rule the user placed is not one of the section's entries:
  // none of them has bullets or fields, so the actions that act on those are hidden
  // rather than left to no-op. Every placed kind, not just text — an image inside an
  // experience section was still being offered "Add bullet".
  const hoveredItemPlaced = isPlacedItem(hoveredEntry);
  const hoveredItemSupportsBullets =
    hoveredItemSection !== null &&
    hoveredItemSection !== undefined &&
    !hoveredItemPlaced &&
    hoveredItemSection.type !== "summary" &&
    hoveredItemSection.type !== "skills" &&
    hoveredItemSection.type !== "certifications";
  // Naming what will actually go, so the button under the pointer says "Delete
  // image" over a photo rather than the "Delete entry" it isn't.
  const hoveredDeleteLabel = isImageItem(hoveredEntry)
    ? "Delete image"
    : isDividerItem(hoveredEntry)
      ? "Delete divider"
      : isTextItem(hoveredEntry)
        ? "Delete text"
        : "Delete entry";

  /**
   * Whether a drag carries files.
   *
   * Checked on every one of these handlers, because text dragged from one field to
   * another inside the document raises the same events, and claiming those would
   * break moving a phrase by dragging it.
   */
  function hasFiles(event: React.DragEvent) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  function handleFileDragOver(event: React.DragEvent) {
    if (!hasFiles(event)) return;
    // Both lines are load-bearing: without `preventDefault` the browser treats the
    // drop as a navigation and replaces the editor with the image file.
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropping(true);
  }

  function handleFileDragLeave(event: React.DragEvent) {
    // Fires on every internal boundary the pointer crosses, so the related target is
    // what separates leaving the canvas from moving around inside it. A drag out of
    // the window has no related target at all, which this treats as a leave.
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    setDropping(false);
  }

  function handleFileDrop(event: React.DragEvent) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    setDropping(false);

    // The first file whatever it is, rather than the first *image*: dropping a PDF
    // here should be told why nothing happened, and the page already owns that
    // message. Silently ignoring it would read as the drop having missed.
    const file = event.dataTransfer.files[0];
    if (file) onImageFile(file, { x: event.clientX, y: event.clientY });
  }

  return (
    <div
      ref={scrollRef}
      onDragEnter={handleFileDragOver}
      onDragOver={handleFileDragOver}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
      // The ring marks the drop zone, and sits on the scrolling element itself so it
      // stays around the view rather than around the whole page stack.
      className={`scrollbar-on-dark relative min-h-0 flex-1 overflow-auto bg-canvas transition-shadow duration-150 ${
        dropping ? "ring-2 ring-inset ring-accent" : ""
      }`}
    >
      {/* Faint grid, so the page reads as a sheet resting on a surface. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(var(--canvas-grid) 1px, transparent 1px), linear-gradient(90deg, var(--canvas-grid) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      <div className="relative flex justify-center px-10 py-12">
        <div
          style={{
            width: pageWidthPx * zoom,
            // Reserve the scaled height of the whole page stack; the transform
            // alone doesn't affect flow.
            height: stackHeightPx * zoom,
          }}
        >
          <div
            ref={pageRef}
            onPointerOver={handleCanvasPointerOver}
            onPointerLeave={scheduleHoverClear}
            onPointerDown={handleCanvasPointerDown}
            onFocus={handleCanvasFocusIn}
            style={{
              width: pageWidthPx,
              transform: `scale(${zoom})`,
              transformOrigin: "top left",
            }}
            // Per-sheet shadow lives on each .rd-page (see canvas page styles),
            // so multi-page stacks show a shadow around every sheet.
            className="rd-canvas-host"
          >
            <ResumeEditingProvider value={{ onFieldChange, onFieldCommit }}>
              <ResumeDocument
                templateSlug={templateSlug}
                content={content}
                theme={theme}
                layout={layout ?? undefined}
              />
            </ResumeEditingProvider>
          </div>
        </div>
      </div>

      {/*
        The measuring mirror: the same document as one continuous flow, read by
        the pagination pass and never shown.

        Outside the zoom transform on purpose — a scaled element reports scaled
        rects, and the packer works in real page units.

        Rendered without ResumeEditingProvider, i.e. in print form. Edit mode
        adds placeholder fields for blank optionals that the PDF omits, so
        measuring the edit form would break the two apart. This way the PDF is
        always exact and the editor can be a line optimistic near a break —
        which is why the canvas sheet lets content overflow rather than clip it.

        A zero-size clipping box rather than `visibility: hidden`: the mirror
        must not widen the scroll area. Clipping doesn't affect layout, so the
        rects inside are still true.
      */}
      <div aria-hidden className="pointer-events-none absolute left-0 top-0 h-0 w-0 overflow-hidden">
        {!freeform && (
          <div data-measure-root className="rd-measure-host" style={{ width: pageWidthPx }}>
            <ResumeDocument templateSlug={templateSlug} content={measureContent} theme={theme} />
          </div>
        )}
      </div>

      {/* Overlay: never inside .rd-page, so it can't reach the PDF. */}
      {freeform && (
        <FreeformLayer
          blocks={blocks}
          selectedId={selectedBlockId}
          page={page}
          pageCount={pages}
          zoom={zoom}
          hostRef={pageRef}
          toLocal={toLocal}
          onMove={onMoveBlock}
          onResize={onResizeBlock}
          onRemove={(blockId) => {
            onRemoveBlock(blockId);
            setSelectedBlockId(null);
          }}
        />
      )}

      {/* The flowed equivalent, for an image sitting in a template's columns. */}
      {selectedImage && itemAnchor && (
        <ImageFrame
          key={selectedImage.id}
          itemId={selectedImage.id}
          widthPercent={selectedImage.widthPercent ?? 40}
          anchor={itemAnchor}
          hostRef={pageRef}
          toLocal={toLocal}
          onResize={onResizeImage}
        />
      )}

      <AnimatePresence>
        {sectionAnchor && focusedSection && (
          <motion.div
            key={focusedSection.id}
            data-canvas-overlay
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="pointer-events-none absolute z-10"
            style={{
              top: sectionAnchor.top,
              left: sectionAnchor.left,
              width: sectionAnchor.width,
              height: sectionAnchor.height,
            }}
          >
            <div
              className="absolute -inset-x-2 -inset-y-1.5 rounded-md ring-1 ring-accent-ring"
              aria-hidden
            />
            {/* Both insert at the end of the section. "Add text" is offered even
                where "Add entry" isn't — a summary section holds one summary,
                but a note beside it is still valid. */}
            <div className="absolute left-0 top-full mt-2.5 flex items-center gap-1.5">
              {canAddItem && (
                // `top-full` rather than a negative `bottom`: hanging the button
                // half over the section's bottom edge covered the last line, so
                // the bullet you were typing was hidden behind it. The margin
                // clears the focus ring, which itself extends 6px past the box.
                <OverlayButton onClick={() => onAddItem(focusedSection.id)}>
                  <PlusIcon /> Add entry
                </OverlayButton>
              )}
              <OverlayButton
                onClick={() => onAddTextItem(focusedSection.id, focusedSection.items.length)}
              >
                <PlusIcon /> Add text
              </OverlayButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {hoveredItem && hoveredItemSection && (
          <motion.div
            key={hoveredItem.id}
            data-canvas-overlay
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -4 }}
            transition={{ duration: 0.12 }}
            // Keeping the pointer here keeps the buttons alive; the strip runs
            // the full height of the entry and all the way back to the page
            // edge, so there's a continuous hover path from text to button.
            onPointerEnter={cancelHoverClear}
            onPointerLeave={scheduleHoverClear}
            className="absolute z-10 flex flex-col items-start gap-1"
            style={{
              top: hoveredItem.anchor.top,
              left: hoveredItem.anchor.left - ITEM_ACTION_OFFSET,
              minHeight: hoveredItem.anchor.height,
              // The bridge: padding, not margin, so it's part of the hover area.
              paddingRight: ITEM_ACTION_OFFSET - ITEM_ACTION_WIDTH,
            }}
          >
            {/*
              Dragging starts from this grip and never from the page element
              itself: an entry is contentEditable, and a drag begun on it fights
              the text caret. The grip lives in the overlay, outside the page, so
              the pointer never touches an editable node — the same split the
              section panel uses for reordering sections.
            */}
            <ItemAction
              label="Move — drag to reposition"
              className="cursor-grab touch-none active:cursor-grabbing"
              onPointerDown={(event) => {
                // Keeps the press from moving focus or starting a selection,
                // both of which would fight the drag.
                event.preventDefault();
                cancelHoverClear();
                beginDrag(hoveredItem.id);
              }}
            >
              <GripIcon />
            </ItemAction>
            {hoveredItemSupportsBullets && (
              <ItemAction
                label="Add bullet"
                onClick={() => onAddBullet(hoveredItemSection.id, hoveredItem.id)}
              >
                <PlusIcon />
              </ItemAction>
            )}
            <ItemAction
              label="Add text below"
              onClick={() => onAddTextItem(hoveredItemSection.id, hoveredItemIndex + 1)}
            >
              <TextIcon />
            </ItemAction>
            <ItemAction
              label={hoveredDeleteLabel}
              danger
              onClick={() => {
                onRemoveItem(hoveredItemSection.id, hoveredItem.id);
                cancelHoverClear();
                setHoveredItem(null);
              }}
            >
              <TrashIcon />
            </ItemAction>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Where the dragged item would land. Also outside .rd-page, so a drag
          in progress can't leave a mark on the exported document. */}
      {drag && dropTarget && (
        <div
          data-canvas-overlay
          aria-hidden
          className="pointer-events-none absolute z-20"
          style={{
            top: dropTarget.anchor.top - 1,
            left: dropTarget.anchor.left,
            width: dropTarget.anchor.width,
          }}
        >
          <div className="h-0.5 rounded-full bg-accent" />
        </div>
      )}
    </div>
  );
}

/**
 * Every element matching `selector` inside `root`, paired with its client rect.
 *
 * Zero-size matches are dropped: a field belonging to a section this sheet doesn't
 * show renders as an unstyled empty node, and a caret sent into one would be
 * invisible.
 */
function boxesIn(root: HTMLElement, selector: string): { el: HTMLElement; box: DOMRect }[] {
  return Array.from(root.querySelectorAll<HTMLElement>(selector))
    .map((el) => ({ el, box: el.getBoundingClientRect() }))
    .filter(({ box }) => box.width > 0 || box.height > 0);
}

/**
 * The sheet under a client point, when the point is over one of *this* document's.
 *
 * The containment check is what rules out a drop onto the grey canvas either side of
 * the page, which still lands on the component but not on any sheet.
 */
function sheetFromPoint(root: HTMLElement | null, at: Point): HTMLElement | null {
  const element = document.elementFromPoint(at.x, at.y) as HTMLElement | null;
  const sheet = element?.closest<HTMLElement>(".rd-page") ?? null;
  return sheet && root?.contains(sheet) ? sheet : null;
}

/** Focuses a field and collapses the caret to one end of its text. */
function placeCaret(el: HTMLElement, side: "start" | "end"): void {
  el.focus();

  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  // Contents rather than offsets: a rich field holds a tree of inline tags, and
  // this lands inside it correctly however deeply the last run is nested.
  range.selectNodeContents(el);
  range.collapse(side === "start");
  selection.removeAllRanges();
  selection.addRange(range);
}

function OverlayButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pointer-events-auto inline-flex h-7 items-center gap-1.5 rounded-full bg-paper-raised px-2.5 text-[0.75rem] text-ink-muted shadow-card ring-1 ring-rule transition-colors hover:text-accent"
    >
      {children}
    </button>
  );
}

function ItemAction({
  label,
  danger = false,
  className = "",
  onClick,
  onPointerDown,
  children,
}: {
  label: string;
  danger?: boolean;
  className?: string;
  onClick?: () => void;
  onPointerDown?: (event: React.PointerEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      onPointerDown={onPointerDown}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md bg-paper-raised text-ink-faint shadow-card ring-1 ring-rule transition-colors ${
        danger ? "hover:text-danger" : "hover:text-accent"
      } ${className}`}
    >
      {children}
    </button>
  );
}

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

function PlusIcon() {
  return (
    <svg {...svg}>
      <path d="M12 5v14M5 12h14" />
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

/** Lines of prose, for the action that inserts a free text block. */
function TextIcon() {
  return (
    <svg {...svg} strokeWidth={1.75}>
      <path d="M4 6h16M4 11h16M4 16h10" />
    </svg>
  );
}

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
