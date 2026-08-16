import { describe, expect, test } from "bun:test";
import { resumeContentSchema, sectionSchema } from "./content";
import { createEmptyContent, createEmptySection, createTextItem } from "./factories";

/**
 * Free text blocks share a section's `items` array with the section's own
 * entries, which buys a lot — pagination, edit paths and reordering all work on
 * them unchanged — at the cost of two things that are easy to break silently and
 * impossible to notice by hand. Both are covered here.
 *
 * 1. Zod objects strip unknown keys, so a text block validated against, say, the
 *    summary shape parses cleanly and comes back *without its `kind`*. It is then
 *    indistinguishable from a summary entry, and every `isTextItem` check
 *    downstream starts answering no.
 * 2. A section's cap on entries has to survive the array growing to hold notes,
 *    or a summary section quietly accepts two summaries.
 */

/**
 * Sections under test are assembled as plain data rather than assigned back into
 * a `Section`. `Section` is discriminated on `type`, so a mixed `items` array
 * types as "any item shape" and won't assign to one member's field — and the
 * subject here is what the *schema* makes of that array, which is what the parse
 * calls receive either way.
 */
describe("a section's items", () => {
  test("keep the discriminator that marks a free text block", () => {
    const section = createEmptySection("summary", 0);

    const parsed = sectionSchema.parse({
      ...section,
      items: [...section.items, createTextItem("A note beside the summary")],
    });
    const note = parsed.items.find((item) => "kind" in item);

    // The failure this guards is a *stripped* key, not a rejected document, so
    // asserting the parse succeeded would pass either way.
    expect(note).toBeDefined();
    expect(note).toMatchObject({ kind: "text", text: "A note beside the summary" });
  });

  test("still cap the section's own entries once notes are allowed", () => {
    const section = createEmptySection("summary", 0);
    const [summary] = section.items;

    // One summary plus a note: fine. Two summaries: not, however many notes sit
    // between them.
    expect(sectionSchema.safeParse({ ...section, items: [summary, createTextItem()] }).success).toBe(true);
    expect(
      sectionSchema.safeParse({ ...section, items: [summary, createTextItem(), summary] }).success,
    ).toBe(false);
  });

  test("accept a text block in every section type", () => {
    const types = [
      "summary",
      "experience",
      "education",
      "skills",
      "projects",
      "certifications",
      "custom",
    ] as const;

    for (const type of types) {
      const section = createEmptySection(type, 0);
      const result = sectionSchema.safeParse({
        ...section,
        items: [createTextItem("anywhere"), ...section.items],
      });
      expect(result.success).toBe(true);
    }
  });

  test("validate as part of a whole document", () => {
    const content = createEmptyContent();
    const [first, ...rest] = content.sections;

    const withNote = {
      ...content,
      sections: [{ ...first!, items: [createTextItem("Read me first"), ...first!.items] }, ...rest],
    };

    expect(resumeContentSchema.safeParse(withNote).success).toBe(true);
  });
});
