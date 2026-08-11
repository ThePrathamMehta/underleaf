import type { ResumeContent, Section, SectionType, Theme } from "@repo/types";
import { createEmptySection } from "@repo/types";

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
  | { type: "addBullet"; sectionId: string; itemId: string }
  | { type: "removeBullet"; sectionId: string; itemId: string; index: number }
  // Pages are a consequence of how much content there is, not objects in their
  // own right — the packer decides where sheets end. So there is no reorder or
  // delete for a page; those live in the section panel, on the unit that
  // actually exists. `addPage` and `togglePageBreak` stay: a *forced* break is a
  // real intent, and the packer honours it.
  | { type: "addPage" }
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
 */
function coalesces(action: EditorAction): boolean {
  return action.type === "setField" || action.type === "setTitle" || action.type === "applyAiEdit";
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

    case "addPage": {
      // A new page needs a section to hold it (pages are runs of sections), so
      // append a blank custom section that begins a fresh page.
      const section = createEmptySection("custom", doc.content.sections.length);
      section.pageBreakBefore = true;
      return { ...doc, content: { ...doc.content, sections: [...doc.content.sections, section] } };
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
