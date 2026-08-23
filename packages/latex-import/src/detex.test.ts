import { describe, expect, test } from "bun:test";
import { detex, detexPlain } from "./detex";

describe("detex", () => {
  test("keeps the emphasis a resume field can hold", () => {
    expect(detex("\\textbf{Gitlytics}")).toBe("<b>Gitlytics</b>");
    expect(detex("\\emph{Python, Flask}")).toBe("<i>Python, Flask</i>");
    expect(detex("\\textit{Georgetown}")).toBe("<i>Georgetown</i>");
  });

  test("drops the underline templates put on every link label", () => {
    // Jake's underlines each contact link; honouring it would underline the
    // whole header.
    expect(detex("\\href{mailto:a@b.com}{\\underline{a@b.com}}")).toBe("a@b.com");
  });

  test("reads a name out of its font switches", () => {
    expect(detex("\\textbf{\\Huge \\scshape Jake Ryan}")).toBe("<b>Jake Ryan</b>");
    expect(detexPlain("\\textbf{\\Huge \\scshape Jake Ryan}")).toBe("Jake Ryan");
  });

  test("escapes the characters that would otherwise be markup", () => {
    // A field holds inline HTML, so a literal "<" from the source has to arrive
    // escaped or it silently becomes a tag.
    expect(detex("Cut latency to <50ms")).toBe("Cut latency to &lt;50ms");
    expect(detex("Ford \\& Sons")).toBe("Ford &amp; Sons");
    // A bare "&" is a tabular column separator — LaTeX needs "\&" for the
    // character — so it reads as the gap between two cells.
    expect(detex("\\textbf{Role} & Jun 2024")).toBe("<b>Role</b> Jun 2024");
  });

  test("resolves the escapes and symbols LaTeX spells out", () => {
    expect(detexPlain("100\\% of \\$2M")).toBe("100% of $2M");
    expect(detexPlain("Aug. 2018 -- May 2021")).toBe("Aug. 2018 – May 2021");
    expect(detexPlain("Python $\\cdot$ Go")).toBe("Python Go");
  });

  test("throws away spacing and layout commands with their arguments", () => {
    expect(detex("Text \\vspace{-7pt} more")).toBe("Text more");
    expect(detex("\\begin{itemize}[leftmargin=0.15in, label={}] Hi \\end{itemize}")).toBe("Hi");
  });

  test("keeps the words inside a command it doesn't know", () => {
    // An unrecognised command wrapping text is almost always styling it, so the
    // text survives even though the command doesn't.
    expect(detex("\\mystyle{Senior Engineer}")).toBe("Senior Engineer");
    expect(detex("\\descript{Backend} \\location{Austin}")).toBe("Backend Austin");
  });

  test("keeps the content argument of a two-argument command", () => {
    expect(detex("\\textcolor{accent}{Engineer}")).toBe("Engineer");
  });

  test("strips comments, including a commented-out bullet", () => {
    expect(detexPlain("Shipped it % \\resumeItem{old wording}")).toBe("Shipped it");
    // An escaped percent is a character, not a comment.
    expect(detexPlain("Grew 40\\% year on year")).toBe("Grew 40% year on year");
  });

  test("keeps the words in a truncated document instead of hanging", () => {
    // An unbalanced brace means the command can't be applied, but the text after
    // it is still the user's — dropping it would lose real content to a typo.
    expect(detex("\\textbf{unclosed")).toBe("unclosed");
    expect(detex("\\resumeSubheading{Company}{2024")).toBe("Company 2024");
  });
});
