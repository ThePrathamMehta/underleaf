/**
 * Turning LaTeX source into the inline HTML the resume fields hold.
 *
 * This is deliberately *not* a LaTeX interpreter. It does not expand macros, load
 * packages or lay anything out — it reads a document the way a person skimming the
 * source does: braces group, a handful of well-known commands mean bold or italic
 * or a link, and everything else is either text to keep or decoration to drop.
 *
 * The one hard rule is that the output must be safe to put in a rich text field.
 * Fields hold a small subset of HTML, so every literal character that arrives from
 * the source is escaped as it is emitted, and the only unescaped markup in the
 * result is what this file wrote itself.
 */

/** How a macro's arguments are treated. */
type MacroRule =
  /** Drop the command and its arguments outright: `\vspace{1pt}`. */
  | { kind: "drop"; args: number }
  /** Drop the command, keep the last argument's text: `\textcolor{red}{hi}`. */
  | { kind: "keep"; args: number }
  /** Wrap the argument in a tag: `\textbf{hi}`. */
  | { kind: "wrap"; tag: "b" | "i" | "u"; args: 1 }
  /** Emit a fixed string and take no arguments: `\LaTeX`, `\cdot`. */
  | { kind: "literal"; text: string };

/**
 * The commands worth knowing by name.
 *
 * Anything absent falls through to "unknown macro": the command itself is
 * dropped and its arguments' text is kept, which is right far more often than not
 * — an unrecognised command wrapping words is almost always styling them.
 */
const MACROS: Record<string, MacroRule> = {
  // Emphasis the fields can represent. `\underline` is deliberately not one of
  // them: Jake's template underlines every link's label, and honouring that would
  // underline every email address and profile URL on the imported resume.
  textbf: { kind: "wrap", tag: "b", args: 1 },
  textit: { kind: "wrap", tag: "i", args: 1 },
  emph: { kind: "wrap", tag: "i", args: 1 },
  textsl: { kind: "wrap", tag: "i", args: 1 },

  // Styling that carries no meaning once the text is out of LaTeX.
  underline: { kind: "keep", args: 1 },
  uline: { kind: "keep", args: 1 },
  textsc: { kind: "keep", args: 1 },
  texttt: { kind: "keep", args: 1 },
  textrm: { kind: "keep", args: 1 },
  textsf: { kind: "keep", args: 1 },
  textnormal: { kind: "keep", args: 1 },
  mbox: { kind: "keep", args: 1 },
  hbox: { kind: "keep", args: 1 },
  text: { kind: "keep", args: 1 },
  makebox: { kind: "keep", args: 1 },

  // Two arguments, only the second of which is content. `\href` is the one that
  // matters most: its first argument is a URL, and letting it fall through to the
  // unknown-macro rule would print every link twice.
  href: { kind: "keep", args: 2 },
  url: { kind: "keep", args: 1 },
  textcolor: { kind: "keep", args: 2 },
  colorbox: { kind: "keep", args: 2 },
  raisebox: { kind: "keep", args: 2 },
  scalebox: { kind: "keep", args: 2 },
  resizebox: { kind: "keep", args: 3 },

  // Spacing, layout and bookkeeping: the argument is a measurement or a name,
  // never words the resume wants.
  vspace: { kind: "drop", args: 1 },
  hspace: { kind: "drop", args: 1 },
  vskip: { kind: "drop", args: 0 },
  hskip: { kind: "drop", args: 0 },
  setlength: { kind: "drop", args: 2 },
  addtolength: { kind: "drop", args: 2 },
  includegraphics: { kind: "drop", args: 1 },
  label: { kind: "drop", args: 1 },
  ref: { kind: "drop", args: 1 },
  cite: { kind: "drop", args: 1 },
  pagestyle: { kind: "drop", args: 1 },
  thispagestyle: { kind: "drop", args: 1 },
  definecolor: { kind: "drop", args: 3 },
  color: { kind: "drop", args: 1 },
  fontsize: { kind: "drop", args: 2 },
  fontfamily: { kind: "drop", args: 1 },
  faIcon: { kind: "drop", args: 1 },
  faicon: { kind: "drop", args: 1 },
  documentclass: { kind: "drop", args: 1 },
  usepackage: { kind: "drop", args: 1 },
  begin: { kind: "drop", args: 1 },
  end: { kind: "drop", args: 1 },

  // Symbols that stand in for punctuation the resume does want.
  cdot: { kind: "literal", text: "·" },
  bullet: { kind: "literal", text: "•" },
  textbullet: { kind: "literal", text: "•" },
  textbar: { kind: "literal", text: "|" },
  vert: { kind: "literal", text: "|" },
  mid: { kind: "literal", text: "|" },
  textendash: { kind: "literal", text: "–" },
  textemdash: { kind: "literal", text: "—" },
  dots: { kind: "literal", text: "…" },
  ldots: { kind: "literal", text: "…" },
  textdegree: { kind: "literal", text: "°" },
  LaTeX: { kind: "literal", text: "LaTeX" },
  TeX: { kind: "literal", text: "TeX" },
  today: { kind: "literal", text: "" },
};

/**
 * Argument-less commands that leave nothing behind but a word boundary.
 *
 * Font switches are the reason this list is long: `\textbf{\Huge \scshape Jake}`
 * is how a name is set, and the size commands have to disappear without taking
 * the name with them.
 */
const IGNORED = new Set([
  "Huge", "huge", "LARGE", "Large", "large", "normalsize", "small",
  "footnotesize", "scriptsize", "tiny",
  "scshape", "bfseries", "mdseries", "itshape", "upshape", "slshape",
  "rmfamily", "sffamily", "ttfamily", "normalfont", "selectfont",
  "bf", "it", "rm", "sc", "sl", "sf", "tt", "em",
  "centering", "raggedright", "raggedleft", "noindent", "indent",
  "hfill", "vfill", "hrule", "hrulefill", "dotfill", "null", "par",
  "newline", "linebreak", "nolinebreak", "newpage", "clearpage", "pagebreak",
  "smallskip", "medskip", "bigskip", "quad", "qquad", ",", ";", ":", "!",
  "protect", "leavevmode", "strut", "extracolsep", "fill",
]);

/**
 * Commands whose bracketed option is safely droppable.
 *
 * Kept to a list rather than applied to every macro, because `[...]` after an
 * unknown command is as likely to be real text — "\myrole [contractor]" — as it
 * is to be an option, and eating it would silently lose words.
 */
const TAKES_OPTION = new Set([
  "begin", "end", "item", "documentclass", "usepackage", "includegraphics",
  "geometry", "titleformat", "titlespacing", "newcommand", "renewcommand",
  "hypersetup", "resumeItem", "titlerule", "sloppy",
]);

/** Escaped single characters: `\&`, `\%`, `\\` and friends. */
const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "%": "%",
  $: "$",
  "#": "#",
  _: "_",
  "{": "{",
  "}": "}",
  // A line break inside a header or a tabular row: a separator, not a character.
  "\\": " ",
  " ": " ",
  "/": "",
  // A discretionary hyphen marks where a word *may* break; it isn't one.
  "-": "",
};

/** The three characters that would otherwise be markup in a rich text field. */
function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Removes `%` comments, which real resumes carry a lot of — old bullet points,
 * alternative wordings, whole commented-out sections.
 *
 * Exported because the structure parser has to strip them before it goes looking
 * for `\section`, or it would find sections nobody has compiled in years.
 */
export function stripComments(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      let out = "";
      for (let i = 0; i < line.length; i++) {
        const char = line[i]!;
        if (char === "\\") {
          out += char + (line[i + 1] ?? "");
          i++;
          continue;
        }
        if (char === "%") return out;
        out += char;
      }
      return out;
    })
    .join("\n");
}

/**
 * Reads a `{...}` group, honouring nesting and escaped braces.
 *
 * Leading whitespace is skipped, because `\textbf {x}` is as valid as
 * `\textbf{x}`. Returns null when there is no group to read, which is how a
 * caller tells `\resumeSubheading{a}{b}{c}{d}` from a truncated document.
 */
export function readGroup(source: string, from: number): { text: string; end: number } | null {
  let start = from;
  while (start < source.length && /\s/.test(source[start]!)) start++;
  if (source[start] !== "{") return null;

  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const char = source[i]!;
    if (char === "\\") {
      i++;
      continue;
    }
    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return { text: source.slice(start + 1, i), end: i + 1 };
    }
  }
  return null;
}

/** Reads `count` consecutive groups, or null if the run is short. */
export function readGroups(
  source: string,
  from: number,
  count: number,
): { texts: string[]; end: number } | null {
  const texts: string[] = [];
  let cursor = from;
  for (let i = 0; i < count; i++) {
    const group = readGroup(source, cursor);
    if (!group) return null;
    texts.push(group.text);
    cursor = group.end;
  }
  return { texts, end: cursor };
}

/**
 * Skips a `[...]` option if one starts here.
 *
 * Called on both sides of a command's arguments, because LaTeX puts the option on
 * whichever side the command declared it: `\item[label]` before, and
 * `\begin{itemize}[leftmargin=0.15in]` after.
 */
function skipOption(source: string, from: number): number {
  let cursor = from;
  while (cursor < source.length && source[cursor] === " ") cursor++;
  if (source[cursor] !== "[") return from;
  const close = source.indexOf("]", cursor);
  return close === -1 ? from : close + 1;
}

/** The command name at `from`, which points at the backslash. */
function readCommand(source: string, from: number): { name: string; end: number } {
  const letters = /[a-zA-Z]/;
  let end = from + 1;
  while (end < source.length && letters.test(source[end]!)) end++;

  // A non-letter command is exactly one character long: `\&`, `\\`, `\,`.
  if (end === from + 1) return { name: source.slice(from + 1, from + 2), end: from + 2 };

  // A starred form is the same command as far as text goes.
  if (source[end] === "*") end++;
  return { name: source.slice(from + 1, end).replace(/\*$/, ""), end };
}

/** One pass of the renderer; recursion handles nesting and escaping together. */
function render(source: string): string {
  let out = "";

  for (let i = 0; i < source.length; ) {
    const char = source[i]!;

    if (char === "\\") {
      const { name, end } = readCommand(source, i);

      const escape = ESCAPES[name];
      if (escape !== undefined && name.length === 1) {
        out += escape;
        i = end;
        continue;
      }

      let cursor = TAKES_OPTION.has(name) ? skipOption(source, end) : end;
      const rule = MACROS[name];

      /** Where to resume, past an option the command declared after its args. */
      const after = (at: number) => (TAKES_OPTION.has(name) ? skipOption(source, at) : at);

      if (rule?.kind === "literal") {
        out += escapeText(rule.text);
        i = after(cursor);
        continue;
      }

      if (rule?.kind === "wrap") {
        const group = readGroup(source, cursor);
        // No argument to wrap: the command was a bare font switch after all.
        if (!group) {
          i = cursor;
          continue;
        }
        out += `<${rule.tag}>${render(group.text)}</${rule.tag}>`;
        i = group.end;
        continue;
      }

      if (rule?.kind === "drop" || rule?.kind === "keep") {
        const groups = readGroups(source, cursor, rule.args);
        if (!groups) {
          i = after(cursor);
          continue;
        }
        // "keep" keeps the last argument, which is the content-bearing one in
        // every two-argument command here: `\textcolor{accent}{Engineer}`.
        if (rule.kind === "keep") out += render(groups.texts[groups.texts.length - 1] ?? "");
        i = after(groups.end);
        continue;
      }

      if (IGNORED.has(name)) {
        // A word boundary, so `\Large Jake` doesn't become `Jake` glued to
        // whatever preceded it.
        out += " ";
        i = after(cursor);
        continue;
      }

      // Unknown: drop the command, keep whatever it wrapped. Consuming the
      // groups here rather than letting the loop fall through to them is what
      // keeps `\myMacro{a}{b}` from becoming "ab" with no space.
      let kept = "";
      for (;;) {
        const group = readGroup(source, cursor);
        if (!group) break;
        kept += (kept ? " " : "") + render(group.text);
        cursor = group.end;
      }
      out += kept ? ` ${kept} ` : " ";
      i = cursor;
      continue;
    }

    // Grouping braces and math delimiters carry no text of their own.
    if (char === "{" || char === "}" || char === "$") {
      i++;
      continue;
    }
    // A tabular column separator, and a non-breaking space. An unescaped `&` is
    // a separator or a typo — never a literal, since LaTeX requires `\&` for that.
    if (char === "&" || char === "~") {
      out += " ";
      i++;
      continue;
    }
    // The dash ligatures, which is how every template writes a date range.
    if (char === "-" && source[i + 1] === "-") {
      const em = source[i + 2] === "-";
      out += em ? "—" : "–";
      i += em ? 3 : 2;
      continue;
    }
    if (char === "<" || char === ">") {
      out += char === "<" ? "&lt;" : "&gt;";
      i++;
      continue;
    }

    out += char;
    i++;
  }

  return out;
}

/** Trims, collapses runs of whitespace, and tidies the punctuation that a
 *  dropped command tends to leave stranded. */
function collapse(text: string): string {
  return (
    text
      .replace(/\s+/g, " ")
      /*
       * A tag that opens or closes on a space: the space came from a font switch
       * inside the run — `\textbf{\Huge \scshape Jake Ryan}` — and belongs to the
       * sentence rather than to the emphasis. Moved out rather than dropped, so
       * `a\textbf{ b}` keeps the gap between its two words.
       */
      .replace(/<([biu])>\s+/g, " <$1>")
      .replace(/\s+<\/([biu])>/g, "</$1> ")
      .replace(/<([biu])>\s*<\/\1>/g, "")
      .replace(/\s+/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/([([])\s+/g, "$1")
      .replace(/\s+([)\]])/g, "$1")
      .replace(/(^|\s)[|·•](\s|$)/g, " ")
      .trim()
  );
}

/**
 * A LaTeX fragment as one line of the inline HTML a resume field holds.
 *
 * The result is already escaped and already inside the field subset, so it can be
 * assigned to a field directly — but it is still passed through the schema before
 * it reaches a resume, which is where the length limits are enforced.
 */
export function detex(source: string): string {
  return collapse(render(stripComments(source)));
}

/** A LaTeX fragment as plain readable text, with the emphasis tags removed. */
export function detexPlain(source: string): string {
  return collapse(render(stripComments(source)).replace(/<\/?[biu]>/g, ""))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Whether a fragment has any words in it.
 *
 * The parser uses this to tell "a section I read and it was empty" from "a
 * section built out of macros I don't understand" — the second is what sends a
 * document to the model, so it has to be detected rather than guessed at.
 */
export function hasWords(source: string): boolean {
  return /[a-zA-Z0-9]/.test(detexPlain(source));
}
