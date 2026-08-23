import { describe, expect, test } from "bun:test";
import { freeformBlockSchema } from "./content";
import {
  SECTION_STARTERS,
  createSectionStarterBlock,
  sectionStarterLabel,
  sectionStarterSize,
} from "./factories";

/**
 * The canvas's Insert Section picker turns a choice into one freely-placed block,
 * and the two halves of that promise are easy to break without noticing: the block
 * has to be a document the schema accepts, and it has to be the *one* block the
 * editor's stacking arithmetic expects — sized, so the next section knows where to
 * go, and of type `text`, so the renderer draws it as words rather than as a frame.
 */

describe("every starter section", () => {
  test("is a valid freeform block", () => {
    for (const kind of SECTION_STARTERS) {
      const block = createSectionStarterBlock(kind, { position: { x: 20, y: 40 } });
      expect(freeformBlockSchema.safeParse(block).success).toBe(true);
    }
  });

  test("is one sized text block, so it stacks and reads as text", () => {
    for (const kind of SECTION_STARTERS) {
      const block = createSectionStarterBlock(kind, { position: { x: 20, y: 40 } });
      expect(block.type).toBe("text");
      expect(block.size).toEqual(sectionStarterSize(kind));
    }
  });

  test("opens with its heading, in the words the picker offered", () => {
    const block = createSectionStarterBlock("experience", { position: { x: 20, y: 40 } });
    expect(block.content.startsWith("<span")).toBe(true);
    expect(block.content).toContain("EXPERIENCE");
    // Example text under the heading, not an empty box: a canvas gives no other
    // hint about what belongs in the lines.
    expect(block.content.split("<br>").length).toBeGreaterThan(2);
  });

  /**
   * The heading's size and weight are an inline run, so the picker's result stays
   * ordinary editable text. That only holds if the run survives the field's
   * sanitizer, which is asserted for real against the sanitizer itself in
   * `packages/ui/src/resume/section-starters.test.ts`.
   */
  test("styles its heading inline rather than as its own block", () => {
    const block = createSectionStarterBlock("skills", { position: { x: 20, y: 40 } });
    expect(block.content).toMatch(/^<span style="[^"]*font-weight: 700/);
    expect(block.style?.fontSize).toBe(10);
  });

  test("reads differently in the picker only where it should", () => {
    const labels = SECTION_STARTERS.map(sectionStarterLabel);
    expect(new Set(labels).size).toBe(labels.length);
    // "Custom" names the choice; "Section Title" is what lands on the page.
    expect(sectionStarterLabel("custom")).toBe("Custom");
    expect(sectionStarterLabel("experience")).toBe("Experience");
  });
});
