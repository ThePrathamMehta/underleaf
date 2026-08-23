import type {
  FreeformBlock,
  ImageItem,
  PlacedItem,
  ResumeContent,
  Section,
  SectionType,
  Theme,
} from "@repo/types";
import {
  MAX_FREEFORM_BLOCKS,
  MAX_FREEFORM_PAGES,
  createEmptySection,
  createFreeformBlock,
  createTextItem,
  freeformPageCount,
  isImageItem,
  isTextItem,
} from "@repo/types";

/**
 * Anything that can occupy a slot in a section's `items` — one of the seven
 * entry shapes or a free text block. Reordering and inserting work on slots
 * without caring which, so they use this rather than narrowing per section type.
 */
type SectionItem = Section["items"][number];

/**
 * What may be changed about a placed image after it exists: where its bytes are,
 * how wide it sits, how it aligns. Not `id` or `kind` — those are what make it
 * findable and what it is.
 */
export type ImageItemPatch = Partial<Pick<ImageItem, "src" | "widthPercent" | "align" | "alt">>;

export type EditorDocument = {
  title: string;
  content: ResumeContent;
  theme: Theme;
};

export type EditorState = {
  doc: EditorDocument;
  past: EditorDocument[];
  future: EditorDocument[];
  /** Bumped whenever the document changes, so autosave can track what's saved. */
  revision: number;
};

export type EditorAction =
  | { type: "setField"; path: (string | number)[]; value: string }
  | { type: "setTitle"; title: string }
  | { type: "patchTheme"; patch: Partial<Theme> }
  | { type: "reorderSections"; fromId: string; toId: string }
  | { type: "toggleSection"; sectionId: string }
  | { type: "addSection"; sectionType: SectionType }
  | { type: "removeSection"; sectionId: string }
  | { type: "addItem"; sectionId: string }
  | { type: "removeItem"; sectionId: string; itemId: string }
  /**
   * Inserts a blank free text block at `index` in a section's items, so text can
   * be added between two entries and not only at the end of a section.
   */
  | { type: "addTextItem"; sectionId: string; index: number }
  /**
   * Drag-and-drop of one item, to `index` within `toSectionId`.
   *
   * `index` counts slots in the destination section as it stands *before* the
   * item is lifted out — it's read off the rendered page, which still shows the
   * item in its old place — so a move within one section corrects for the hole
   * the removal leaves behind.
   */
  | { type: "moveItem"; itemId: string; toSectionId: string; index: number }
  | { type: "addBullet"; sectionId: string; itemId: string }
  | { type: "removeBullet"; sectionId: string; itemId: string; index: number }
  // --- Placed items: the Insert menu on a template resume ---
  /**
   * Inserts an image or a rule at `index` in a section's items.
   *
   * The caller builds the item, as with `addFreeformBlock` and for the same
   * reason: an image is inserted the moment the file is chosen and its `src` is
   * filled in when the upload lands, so whoever started the upload needs the id to
   * patch. Minting it in here would only hand it back on the next render.
   */
  | { type: "addPlacedItem"; sectionId: string; index: number; item: PlacedItem }
  /**
   * Changes an image item, found by id across every section.
   *
   * By id rather than by section and index because both callers are asynchronous
   * with respect to the document: an upload completing, and a resize drag ending.
   * Either could land after an edit moved the item, and an index captured when the
   * gesture began would then write to whatever took its place.
   *
   * `coalesce` is set by the upload, and only by it — see `coalesces` below.
   */
  | { type: "patchImageItem"; itemId: string; patch: ImageItemPatch; coalesce?: boolean }
  /** The freeform equivalent — a canvas image keeps its URL in `content`. */
  | { type: "setFreeformContent"; blockId: string; content: string; coalesce?: boolean }
  // --- The blank canvas ---
  //
  // Freeform blocks carry their own coordinates, so none of the section actions
  // above apply to them and none of these have a section to name. Every one is a
  // whole gesture: a drag dispatches once, on release, rather than on each pointer
  // move — so it costs one undo step and one autosave, not sixty.
  /**
   * Adds a block the caller has already built.
   *
   * The caller builds it because it is the caller who needs the new block's id: a
   * click on empty canvas has to focus the block it just created, and an id minted
   * in here would only come back on the next render.
   */
  | { type: "addFreeformBlock"; block: FreeformBlock }
  | { type: "moveFreeformBlock"; blockId: string; page: number; position: { x: number; y: number } }
  /** Resize carries a position too: dragging a north or west handle moves the origin. */
  | {
      type: "resizeFreeformBlock";
      blockId: string;
      position: { x: number; y: number };
      size: { width: number; height: number };
    }
  | { type: "removeFreeformBlock"; blockId: string }
  // Pages are a consequence of how much content there is, not objects in their
  // own right — the packer decides where sheets end. So there is no reorder or
  // delete for a page; those live in the section panel, on the unit that
  // actually exists. `addPage` and `togglePageBreak` stay: a *forced* break is a
  // real intent, and the packer honours it.
  //
  // `freeform` comes from the caller because a page means something different on a
  // blank canvas — a coordinate rather than a run of sections — and the template
  // is what decides which, not the content. A blank resume switched onto a named
  // template keeps its blocks, so reading the content here would guess wrong.
  | { type: "addPage"; freeform?: boolean }
  | { type: "removeLastPage"; freeform?: boolean }
  | { type: "togglePageBreak"; sectionId: string }
  /**
   * A document computed by the AI assistant, replacing content and theme wholesale.
   *
   * Wholesale rather than as a patch because the server already validated the
   * *result* against `resumeContentSchema` — an assignment cannot half-apply,
   * where a patch replayed against a document that drifted can.
   */
  | { type: "applyAiEdit"; content: ResumeContent; theme: Theme }
  | { type: "commit" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; doc: EditorDocument };

const HISTORY_LIMIT = 60;

/**
 * Actions that describe one continuous gesture (typing a character) shouldn't
 * each become an undo step. Those set `coalesce`, and the caller marks a
 * boundary with `commit` — on blur, or before a structural change.
 *
 * `applyAiEdit` coalesces for the same reason typing does, and it matters more
 * here: one assistant turn can rewrite three sections and emit a document after
 * each, and a user who asked for one thing should undo one thing. The chat panel
 * dispatches `commit` before a turn's first edit, so the pre-turn document lands
 * on `past` exactly once and every later edit in the turn folds into it.
 *
 * An image upload landing is the third case, and the flag is on the action rather
 * than the type because the same two actions serve a second caller that must *not*
 * coalesce. Inserting an image adds it with an empty `src` and fills that in when
 * the bytes arrive: one thing the user did, and folding the second half into the
 * first is what makes a single Ctrl+Z take the whole image back out. A resize drag
 * dispatches the same action and is its own step, as any other edit is.
 */
function coalesces(action: EditorAction): boolean {
  return (
    action.type === "setField" ||
    action.type === "setTitle" ||
    action.type === "applyAiEdit" ||
    ((action.type === "patchImageItem" || action.type === "setFreeformContent") &&
      action.coalesce === true)
  );
}

/** Writes a value at a JSON path, cloning only the nodes along the way. */
function setAtPath<T>(root: T, path: (string | number)[], value: unknown): T {
  if (path.length === 0) return value as T;

  const [head, ...rest] = path;

  if (Array.isArray(root)) {
    const index = Number(head);
    const next = [...root];
    next[index] = setAtPath(next[index], rest, value);
    return next as unknown as T;
  }

  const record = root as Record<string, unknown>;
  return {
    ...record,
    [String(head)]: setAtPath(record[String(head)], rest, value),
  } as T;
}

function mapSection(content: ResumeContent, sectionId: string, fn: (section: Section) => Section): ResumeContent {
  return {
    ...content,
    sections: content.sections.map((section) => (section.id === sectionId ? fn(section) : section)),
  };
}

/** Renumbers `order` to match array position after a move or insertion. */
function renumber(sections: Section[]): Section[] {
  return sections.map((section, index) => ({ ...section, order: index }));
}

/** Keeps an insertion point inside an array, inclusive of the end. */
function clamp(index: number, length: number): number {
  return Math.max(0, Math.min(index, length));
}

/**
 * Rewrites one freeform block, or returns the content untouched when there is no
 * such block — which the caller turns back into the same `doc`, so a gesture on a
 * block that has since been deleted costs no undo step.
 */
function mapFreeformBlock(
  content: ResumeContent,
  blockId: string,
  fn: (block: FreeformBlock) => FreeformBlock,
): ResumeContent {
  const blocks = content.freeformBlocks;
  if (!blocks?.some((block) => block.id === blockId)) return content;

  return {
    ...content,
    freeformBlocks: blocks.map((block) => (block.id === blockId ? fn(block) : block)),
  };
}

/**
 * Sets which sheet a block sits on, dropping the field for the first one.
 *
 * `page` is optional in the schema with absent meaning zero, and `createFreeformBlock`
 * omits it, so writing an explicit `page: 0` here would make two spellings of the
 * same document and show up as a diff in every autosave after a drag back to page one.
 */
function withPage(block: FreeformBlock, page: number): FreeformBlock {
  const next: FreeformBlock = { ...block, page };
  if (page === 0) delete next.page;
  return next;
}

/** Where "Add page" puts the block that makes the new sheet exist. */
const NEW_PAGE_BLOCK = { x: 20, y: 20 };

function reduceDoc(doc: EditorDocument, action: EditorAction): EditorDocument {
  switch (action.type) {
    case "setTitle":
      return { ...doc, title: action.title };

    case "setField": {
      // The skills editor presents an array as one comma-separated field.
      const isSkillsList = action.path[action.path.length - 1] === "skills";
      const value = isSkillsList
        ? action.value.split(",").map((s) => s.trim()).filter(Boolean)
        : action.value;
      return { ...doc, content: setAtPath(doc.content, action.path, value) };
    }

    case "patchTheme":
      return { ...doc, theme: { ...doc.theme, ...action.patch } };

    case "reorderSections": {
      const sections = [...doc.content.sections].sort((a, b) => a.order - b.order);
      const from = sections.findIndex((s) => s.id === action.fromId);
      const to = sections.findIndex((s) => s.id === action.toId);
      if (from === -1 || to === -1 || from === to) return doc;

      const [moved] = sections.splice(from, 1);
      sections.splice(to, 0, moved!);
      return { ...doc, content: { ...doc.content, sections: renumber(sections) } };
    }

    case "toggleSection":
      return {
        ...doc,
        content: mapSection(doc.content, action.sectionId, (s) => ({ ...s, visible: !s.visible })),
      };

    case "addSection": {
      const section = createEmptySection(action.sectionType, doc.content.sections.length);
      return { ...doc, content: { ...doc.content, sections: [...doc.content.sections, section] } };
    }

    case "removeSection":
      return {
        ...doc,
        content: {
          ...doc.content,
          sections: renumber(doc.content.sections.filter((s) => s.id !== action.sectionId)),
        },
      };

    case "addItem":
      return {
        ...doc,
        content: mapSection(doc.content, action.sectionId, (section) => {
          // A fresh blank item of the section's own type, reusing the factory so
          // shapes stay in sync with the schema.
          const template = createEmptySection(section.type, section.order);
          return {
            ...section,
            items: [...section.items, ...template.items],
          } as Section;
        }),
      };

    case "removeItem":
      return {
        ...doc,
        content: mapSection(doc.content, action.sectionId, (section) => ({
          ...section,
          items: section.items.filter((item) => item.id !== action.itemId),
        }) as Section),
      };

    case "addTextItem":
      return {
        ...doc,
        content: mapSection(doc.content, action.sectionId, (section) => {
          const items = [...section.items] as SectionItem[];
          items.splice(clamp(action.index, items.length), 0, createTextItem());
          return { ...section, items } as Section;
        }),
      };

    case "moveItem": {
      const from = doc.content.sections.find((s) => s.items.some((item) => item.id === action.itemId));
      const moved = from?.items.find((item) => item.id === action.itemId);
      if (!from || !moved) return doc;

      // A typed entry belongs to a section of its own type — an experience entry
      // dropped into Skills would fail validation and render as nothing — so it
      // may only be reordered within its own section. A free text block is valid
      // in any section's items, which is what lets it go anywhere.
      const sameSection = from.id === action.toSectionId;
      if (!sameSection && !isTextItem(moved)) return doc;

      const fromIndex = from.items.findIndex((item) => item.id === action.itemId);
      // The caller's index counts the page as currently drawn, which still shows
      // the item in its old slot. Lifting it out shifts everything after it down
      // by one, so a drop below its old position has to come back one.
      const target = sameSection && action.index > fromIndex ? action.index - 1 : action.index;
      if (sameSection && target === fromIndex) return doc;

      return {
        ...doc,
        content: {
          ...doc.content,
          sections: doc.content.sections.map((section) => {
            const isSource = section.id === from.id;
            const isTarget = section.id === action.toSectionId;
            if (!isSource && !isTarget) return section;

            const items = isSource
              ? (section.items as SectionItem[]).filter((item) => item.id !== action.itemId)
              : ([...section.items] as SectionItem[]);
            if (isTarget) items.splice(clamp(target, items.length), 0, moved);
            return { ...section, items } as Section;
          }),
        },
      };
    }

    case "addBullet":
      return {
        ...doc,
        content: mapSection(doc.content, action.sectionId, (section) => ({
          ...section,
          items: section.items.map((item) =>
            item.id === action.itemId && "bullets" in item
              ? { ...item, bullets: [...item.bullets, ""] }
              : item,
          ),
        }) as Section),
      };

    case "removeBullet":
      return {
        ...doc,
        content: mapSection(doc.content, action.sectionId, (section) => ({
          ...section,
          items: section.items.map((item) =>
            item.id === action.itemId && "bullets" in item
              ? { ...item, bullets: item.bullets.filter((_, i) => i !== action.index) }
              : item,
          ),
        }) as Section),
      };

    case "addPlacedItem":
      return {
        ...doc,
        content: mapSection(doc.content, action.sectionId, (section) => {
          const items = [...section.items] as SectionItem[];
          items.splice(clamp(action.index, items.length), 0, action.item);
          return { ...section, items } as Section;
        }),
      };

    case "patchImageItem":
      return {
        ...doc,
        content: {
          ...doc.content,
          // Every section, because the action names an item and not the section
          // holding it. Sections without a match map to themselves.
          sections: doc.content.sections.map((section) => ({
            ...section,
            items: section.items.map((item) =>
              item.id === action.itemId && isImageItem(item) ? { ...item, ...action.patch } : item,
            ),
          })) as Section[],
        },
      };

    case "setFreeformContent":
      return {
        ...doc,
        content: mapFreeformBlock(doc.content, action.blockId, (block) => ({
          ...block,
          content: action.content,
        })),
      };

    case "addFreeformBlock": {
      const blocks = doc.content.freeformBlocks ?? [];
      // The schema's cap. Refusing here keeps the document valid rather than
      // letting the autosave fail on a payload the server will reject.
      if (blocks.length >= MAX_FREEFORM_BLOCKS) return doc;
      return { ...doc, content: { ...doc.content, freeformBlocks: [...blocks, action.block] } };
    }

    case "moveFreeformBlock": {
      const content = mapFreeformBlock(doc.content, action.blockId, (block) =>
        withPage({ ...block, position: action.position }, action.page),
      );
      return content === doc.content ? doc : { ...doc, content };
    }

    case "resizeFreeformBlock": {
      const content = mapFreeformBlock(doc.content, action.blockId, (block) => ({
        ...block,
        position: action.position,
        size: action.size,
      }));
      return content === doc.content ? doc : { ...doc, content };
    }

    case "removeFreeformBlock": {
      const blocks = doc.content.freeformBlocks;
      if (!blocks?.some((block) => block.id === action.blockId)) return doc;
      return {
        ...doc,
        content: {
          ...doc.content,
          freeformBlocks: blocks.filter((block) => block.id !== action.blockId),
        },
      };
    }

    case "addPage": {
      // On a blank canvas a sheet exists because a block says it does, so adding
      // one means placing a block on it. An empty text block is the smallest thing
      // that will do, and it doubles as somewhere for the cursor to land when the
      // user scrolls down to the page they just asked for.
      if (action.freeform) {
        const page = freeformPageCount(doc.content.freeformBlocks);
        if (page >= MAX_FREEFORM_PAGES) return doc;
        return reduceDoc(doc, {
          type: "addFreeformBlock",
          block: createFreeformBlock({ type: "text", page, position: NEW_PAGE_BLOCK }),
        });
      }

      // A new page needs a section to hold it (pages are runs of sections), so
      // append a blank custom section that begins a fresh page.
      const section = createEmptySection("custom", doc.content.sections.length);
      section.pageBreakBefore = true;
      return { ...doc, content: { ...doc.content, sections: [...doc.content.sections, section] } };
    }

    case "removeLastPage": {
      if (action.freeform) {
        const blocks = doc.content.freeformBlocks ?? [];
        const last = freeformPageCount(blocks) - 1;
        // The first sheet is the document itself; there is no canvas without it.
        if (last < 1) return doc;
        return {
          ...doc,
          content: {
            ...doc.content,
            freeformBlocks: blocks.filter((block) => (block.page ?? 0) !== last),
          },
        };
      }

      const ordered = [...doc.content.sections].sort((a, b) => a.order - b.order);
      const breakIndex = ordered.findLastIndex((section) => section.pageBreakBefore);
      // Pages created by natural content overflow are not stored objects and
      // cannot be deleted without deleting arbitrary resume content.
      if (breakIndex < 0) return doc;
      return {
        ...doc,
        content: { ...doc.content, sections: renumber(ordered.slice(0, breakIndex)) },
      };
    }

    case "togglePageBreak":
      return {
        ...doc,
        content: mapSection(doc.content, action.sectionId, (section) => ({
          ...section,
          pageBreakBefore: !section.pageBreakBefore,
        })),
      };

    case "applyAiEdit":
      // The title is left alone deliberately: the assistant has no tool for it,
      // and overwriting what the user named their document would be a change
      // nobody asked for.
      return { ...doc, content: action.content, theme: action.theme };

    default:
      return doc;
  }
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "reset":
      return { doc: action.doc, past: [], future: [], revision: 0 };

    case "commit":
      // Marks an undo boundary without changing the document.
      return state.past[state.past.length - 1] === state.doc
        ? state
        : { ...state, past: [...state.past, state.doc].slice(-HISTORY_LIMIT), future: [] };

    case "undo": {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return {
        doc: previous,
        past: state.past.slice(0, -1),
        future: [state.doc, ...state.future].slice(0, HISTORY_LIMIT),
        revision: state.revision + 1,
      };
    }

    case "redo": {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return {
        doc: next,
        past: [...state.past, state.doc].slice(-HISTORY_LIMIT),
        future: rest,
        revision: state.revision + 1,
      };
    }

    default: {
      const doc = reduceDoc(state.doc, action);
      if (doc === state.doc) return state;

      return {
        doc,
        // Structural edits are their own undo step; typing waits for `commit`.
        past: coalesces(action) ? state.past : [...state.past, state.doc].slice(-HISTORY_LIMIT),
        future: [],
        revision: state.revision + 1,
      };
    }
  }
}

export function initEditorState(doc: EditorDocument): EditorState {
  return { doc, past: [], future: [], revision: 0 };
}
