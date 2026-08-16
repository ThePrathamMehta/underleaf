import { describe, expect, test } from "bun:test";
import type { ResumeContent, Section, Theme } from "@repo/types";
import { createTextItem, isTextItem, resumeContentSchema } from "@repo/types";
import { editorReducer, initEditorState, type EditorDocument } from "./editor-reducer";

/**
 * The reducer is a pure function of (state, action), so it tests without a DOM.
 *
 * These cover the two actions behind "add text anywhere and drag it around",
 * because both have a failure mode that looks like nothing happened rather than
 * like an error: an off-by-one in the drop index puts an entry one slot from
 * where it was released, and a cross-section move of a *typed* entry would
 * produce a document that fails validation and renders as a blank space.
 */

const THEME: Theme = {
  fontFamily: "inter",
  headingFontFamily: "inter",
  fontSizeScale: 1,
  accentColor: "#1a1a1a",
  textColor: "#1a1a1a",
  lineSpacing: 1.25,
  marginSize: 14,
  layout: "single-column",
  pageSize: "letter",
};

function experienceEntry(id: string, org: string): Section["items"][number] {
  return { id, org, role: "Role", location: "", startDate: "", endDate: "", bullets: [""] };
}

/** Experience with three named entries, plus an empty Skills section to drop into. */
function doc(): EditorDocument {
  const content: ResumeContent = {
    personalInfo: { name: "Ada", title: "", email: "", phone: "", location: "", links: [] },
    sections: [
      {
        id: "sec-exp",
        type: "experience",
        title: "Experience",
        order: 0,
        visible: true,
        items: [experienceEntry("a", "Alpha"), experienceEntry("b", "Beta"), experienceEntry("c", "Gamma")],
      },
      { id: "sec-skills", type: "skills", title: "Skills", order: 1, visible: true, items: [] },
    ],
  };

  return { title: "Test", content, theme: THEME };
}

function section(content: ResumeContent, id: string): Section {
  return content.sections.find((s) => s.id === id)!;
}

function ids(content: ResumeContent, sectionId: string): string[] {
  return section(content, sectionId).items.map((item) => item.id);
}

describe("addTextItem", () => {
  test("inserts a blank block at the requested slot", () => {
    const state = editorReducer(initEditorState(doc()), {
      type: "addTextItem",
      sectionId: "sec-exp",
      index: 1,
    });

    const items = section(state.doc.content, "sec-exp").items;
    expect(items.length).toBe(4);
    expect(isTextItem(items[1])).toBe(true);
    expect(items.map((item) => item.id).filter((id) => id.length === 1)).toEqual(["a", "b", "c"]);
  });

  test("clamps an index past the end rather than leaving a hole", () => {
    const state = editorReducer(initEditorState(doc()), {
      type: "addTextItem",
      sectionId: "sec-exp",
      index: 99,
    });

    const items = section(state.doc.content, "sec-exp").items;
    expect(items.length).toBe(4);
    expect(isTextItem(items[3])).toBe(true);
    expect(resumeContentSchema.safeParse(state.doc.content).success).toBe(true);
  });

  test("is its own undo step", () => {
    const start = initEditorState(doc());
    const state = editorReducer(start, { type: "addTextItem", sectionId: "sec-exp", index: 0 });

    expect(state.past).toEqual([start.doc]);
    expect(editorReducer(state, { type: "undo" }).doc).toBe(start.doc);
  });
});

describe("moveItem", () => {
  test("corrects for the slot the lifted item vacates when moving down", () => {
    // Released in the gap below "Gamma", which the page draws as index 3 while
    // "Alpha" is still sitting at index 0. Without the correction the entry
    // lands before Gamma instead of after it.
    const state = editorReducer(initEditorState(doc()), {
      type: "moveItem",
      itemId: "a",
      toSectionId: "sec-exp",
      index: 3,
    });

    expect(ids(state.doc.content, "sec-exp")).toEqual(["b", "c", "a"]);
  });

  test("takes the target slot as-is when moving up", () => {
    // Nothing before the drop point is removed, so no correction applies.
    const state = editorReducer(initEditorState(doc()), {
      type: "moveItem",
      itemId: "c",
      toSectionId: "sec-exp",
      index: 0,
    });

    expect(ids(state.doc.content, "sec-exp")).toEqual(["c", "a", "b"]);
  });

  test("is a no-op when the item is dropped back where it started", () => {
    const start = initEditorState(doc());
    for (const index of [1, 2]) {
      const state = editorReducer(start, { type: "moveItem", itemId: "b", toSectionId: "sec-exp", index });
      expect(state).toBe(start);
    }
  });

  test("refuses to move a typed entry into a section of another type", () => {
    const start = initEditorState(doc());
    const state = editorReducer(start, {
      type: "moveItem",
      itemId: "a",
      toSectionId: "sec-skills",
      index: 0,
    });

    // An experience entry in a Skills section would fail validation, so the
    // move is dropped rather than applied and rejected later.
    expect(state).toBe(start);
  });

  test("moves a free text block into any section", () => {
    const withText = editorReducer(initEditorState(doc()), {
      type: "addTextItem",
      sectionId: "sec-exp",
      index: 1,
    });
    const noteId = section(withText.doc.content, "sec-exp").items[1]!.id;

    const state = editorReducer(withText, {
      type: "moveItem",
      itemId: noteId,
      toSectionId: "sec-skills",
      index: 0,
    });

    expect(ids(state.doc.content, "sec-exp")).toEqual(["a", "b", "c"]);
    expect(ids(state.doc.content, "sec-skills")).toEqual([noteId]);
    expect(resumeContentSchema.safeParse(state.doc.content).success).toBe(true);
  });

  test("ignores an id that is no longer in the document", () => {
    const start = initEditorState(doc());
    expect(
      editorReducer(start, { type: "moveItem", itemId: "gone", toSectionId: "sec-exp", index: 0 }),
    ).toBe(start);
  });

  test("leaves a moved block editable at its new path", () => {
    // The edit path is built from the item's index, so a move has to be visible
    // to `setField` immediately — this is the whole reason `index` is the real
    // array position rather than a position on the sheet.
    const withText = editorReducer(initEditorState(doc()), {
      type: "addTextItem",
      sectionId: "sec-skills",
      index: 0,
    });
    const noteId = section(withText.doc.content, "sec-skills").items[0]!.id;

    const state = editorReducer(withText, {
      type: "setField",
      path: ["sections", 1, "items", 0, "text"],
      value: "Available from March",
    });

    const note = section(state.doc.content, "sec-skills").items[0]!;
    expect(note.id).toBe(noteId);
    expect(isTextItem(note) && note.text).toBe("Available from March");
  });
});

describe("removeItem", () => {
  test("deletes a free text block like any other slot", () => {
    const withText = editorReducer(initEditorState(doc()), {
      type: "addTextItem",
      sectionId: "sec-exp",
      index: 2,
    });
    const noteId = section(withText.doc.content, "sec-exp").items[2]!.id;

    const state = editorReducer(withText, {
      type: "removeItem",
      sectionId: "sec-exp",
      itemId: noteId,
    });

    expect(ids(state.doc.content, "sec-exp")).toEqual(["a", "b", "c"]);
  });
});

// Keeps the unused import honest: a text block minted here is the same shape the
// reducer inserts, and the schema is what both are judged against.
test("createTextItem produces a valid slot", () => {
  const state = initEditorState(doc());
  const content: ResumeContent = {
    ...state.doc.content,
    sections: state.doc.content.sections.map((s) =>
      s.id === "sec-skills" ? ({ ...s, items: [createTextItem("Note")] } as Section) : s,
    ),
  };

  expect(resumeContentSchema.safeParse(content).success).toBe(true);
});
