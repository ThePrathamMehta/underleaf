import { describe, expect, test } from "bun:test";
import { contentDispositionAttachment, getExportFilename } from "./export-name";
import { createBlankCanvasContent, createEmptyContent, createFreeformBlock } from "./factories";

/**
 * The bug this fixes is a filename derived from whatever field was nearest to
 * hand, so what's under test is the *order* of the fallbacks and the fact that the
 * chain always terminates. A name is only used if it holds readable text — a
 * heading of `<strong></strong>` is empty to a reader and must not win over the
 * document's title.
 */
describe("getExportFilename", () => {
  test("prefers the person's name", () => {
    const content = createEmptyContent();

    expect(
      getExportFilename({
        title: "Jakes Resume",
        content: { ...content, personalInfo: { ...content.personalInfo, name: "Pratham Mehta" } },
      }),
    ).toBe("Pratham-Mehta-Resume.pdf");
  });

  test("reads through the markup a rich text field may carry", () => {
    const content = createEmptyContent();

    expect(
      getExportFilename({
        content: {
          ...content,
          personalInfo: { ...content.personalInfo, name: "<strong>Ada</strong>&nbsp;Lovelace" },
        },
      }),
    ).toBe("Ada-Lovelace-Resume.pdf");
  });

  test("falls back to the first heading block of a blank canvas", () => {
    const content = createBlankCanvasContent();
    const [heading] = content.freeformBlocks!;

    expect(
      getExportFilename({
        title: "Untitled Resume",
        content: {
          ...content,
          freeformBlocks: [{ ...heading!, content: "Grace Hopper" }],
        },
      }),
    ).toBe("Grace-Hopper-Resume.pdf");
  });

  test("takes the topmost heading, not the first one typed", () => {
    const content = createBlankCanvasContent();

    expect(
      getExportFilename({
        content: {
          ...content,
          freeformBlocks: [
            createFreeformBlock({ type: "heading", position: { x: 20, y: 90 }, content: "Awards" }),
            createFreeformBlock({ type: "heading", position: { x: 20, y: 16 }, content: "Alan Turing" }),
          ],
        },
      }),
    ).toBe("Alan-Turing-Resume.pdf");
  });

  test("ignores blocks that only look like a heading", () => {
    const content = createBlankCanvasContent();

    expect(
      getExportFilename({
        title: "My notes",
        content: {
          ...content,
          freeformBlocks: [
            createFreeformBlock({ type: "text", position: { x: 20, y: 10 }, content: "Katherine Johnson" }),
          ],
        },
      }),
    ).toBe("My-notes-Resume.pdf");
  });

  test("falls back to the title, then to a name of last resort", () => {
    const blank = createBlankCanvasContent();

    expect(getExportFilename({ title: "Backend Application", content: blank })).toBe(
      "Backend-Application-Resume.pdf",
    );
    expect(getExportFilename({ title: "", content: blank })).toBe("Untitled-Resume.pdf");
    expect(getExportFilename({})).toBe("Untitled-Resume.pdf");
  });

  test("does not say Resume twice", () => {
    expect(getExportFilename({ title: "Frontend Resume" })).toBe("Frontend-Resume.pdf");
    expect(getExportFilename({ title: "resume" })).toBe("resume.pdf");
  });

  test("strips what a filename or a header could not carry", () => {
    const filename = getExportFilename({ title: 'A/B "test": ..\\..\\etc\r\npasswd' });

    expect(filename).toBe("A-B-test-etc-passwd-Resume.pdf");
    expect(contentDispositionAttachment(filename)).not.toContain("\n");
  });

  test("keeps non-Latin names in the encoded form and out of the plain one", () => {
    const filename = getExportFilename({ title: "李雷" });
    const header = contentDispositionAttachment(filename);

    expect(filename).toBe("李雷-Resume.pdf");
    // The bare parameter is the ASCII-only fallback; `filename*` is what a browser
    // built after 2011 actually reads.
    expect(header).toContain('filename="Resume.pdf"');
    expect(header).toContain(`filename*=UTF-8''${encodeURIComponent(filename)}`);
  });
});
