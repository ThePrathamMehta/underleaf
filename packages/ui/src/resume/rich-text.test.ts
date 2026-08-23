import { describe, expect, test } from "bun:test";
import { sanitizeInlineHtml, stripAnchors } from "./rich-text";

/**
 * `stripAnchors` is what makes a thumbnail's markup valid inside the `<Link>` its
 * callers wrap it in. It is documented as safe only on sanitizer output, so the
 * cases that matter are the ones where a field's raw value is doing something
 * awkward and the sanitizer is what makes it tractable.
 */
describe("stripAnchors", () => {
  test("keeps the label and the formatting inside it", () => {
    const html = sanitizeInlineHtml('<a href="https://x.test"><b>my</b> site</a>');
    expect(stripAnchors(html)).toBe("<b>my</b> site");
  });

  test("leaves markup with no links exactly as it was", () => {
    const html = sanitizeInlineHtml("<b>Led</b> a team of <i>six</i>");
    expect(stripAnchors(html)).toBe(html);
  });

  test("unwraps several links in one field, which a bullet can hold", () => {
    const html = sanitizeInlineHtml(
      'Shipped <a href="https://a.test">one</a> and <a href="https://b.test">two</a>',
    );
    const stripped = stripAnchors(html);

    expect(stripped).toBe("Shipped one and two");
    expect(stripped).not.toContain("<a");
  });

  /**
   * The precondition, stated as a test: a `>` inside an attribute value is the one
   * thing that could make `[^>]*` stop early and leave half a tag behind. The
   * sanitizer escapes it, so by the time this function runs there is none left.
   */
  test("is not fooled by a '>' inside an attribute, because sanitizing escaped it", () => {
    const html = sanitizeInlineHtml('<a href="https://x.test" title="a > b">label</a>');

    expect(html).not.toMatch(/title="[^"]*>/);
    expect(stripAnchors(html)).toBe("label");
  });

  test("drops an href-less anchor too, which is what a rejected url leaves behind", () => {
    // `javascript:` is refused, so the tag survives sanitizing with no href.
    const html = sanitizeInlineHtml('<a href="javascript:alert(1)">click</a>');

    expect(html).toContain("<a>");
    expect(stripAnchors(html)).toBe("click");
  });

  test("keeps the text of a mis-nested link the sanitizer had to close for it", () => {
    const html = sanitizeInlineHtml('<a href="https://x.test">open <b>bold');
    expect(stripAnchors(html)).toBe("open <b>bold</b>");
  });
});
