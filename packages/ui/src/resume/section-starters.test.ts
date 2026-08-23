import { describe, expect, test } from "bun:test";
import { SECTION_STARTERS, createSectionStarterBlock } from "@repo/types";
import { htmlToPlainText, sanitizeInlineHtml } from "./rich-text";

/**
 * A starter section arrives as inline HTML written by hand — a heading run, and
 * lines joined with `<br>`. The field it lands in sanitizes itself on every blur,
 * so anything outside that subset would look right until the user's first edit and
 * then quietly rewrite itself: a heading losing its size, or a line break
 * collapsing and running two lines together.
 *
 * Sanitizing is idempotent by design, so the test is simply that the starters are
 * already at their fixed point.
 */
describe("starter section markup", () => {
  test("survives the field sanitizer untouched", () => {
    for (const kind of SECTION_STARTERS) {
      const { content } = createSectionStarterBlock(kind, { position: { x: 20, y: 40 } });
      expect(sanitizeInlineHtml(content)).toBe(content);
    }
  });

  test("reads as lines of plain text, so an ATS gets the words", () => {
    const { content } = createSectionStarterBlock("experience", { position: { x: 20, y: 40 } });
    const text = htmlToPlainText(content);

    expect(text).toContain("EXPERIENCE");
    expect(text).toContain("Company Name");
    expect(text).not.toContain("<");
  });
});
