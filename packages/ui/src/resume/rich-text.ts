/**
 * Inline formatting for resume fields.
 *
 * Resume content is stored as strings, and those strings may now carry a small
 * subset of inline HTML — bold, italic, underline, strike, per-run colour and
 * highlight, and links. Everything else is stripped.
 *
 * The whitelist is deliberately tiny and *inline only*: a resume field is a text
 * run inside a typeset page, so block elements, images and scripts have nothing
 * to express there and would only break the layout the templates guarantee.
 *
 * This module runs in two places — the browser editor and the Node PDF export —
 * so it parses with regexes rather than the DOM, which the export path lacks.
 * Both paths sanitize on the way *out* as well as on the way in, so content that
 * predates this file, or that reached the database by another route, still
 * renders safely.
 */

/** Tags that mean the same thing as one we keep, normalised on the way through. */
const TAG_ALIASES: Record<string, string> = {
  strong: "b",
  em: "i",
  ins: "u",
  strike: "s",
  del: "s",
  font: "span",
};

const ALLOWED_TAGS = new Set(["b", "i", "u", "s", "sub", "sup", "br", "span", "a", "mark"]);

const VOID_TAGS = new Set(["br"]);

/**
 * Style properties a run may set. Anything positional (display, position,
 * margin, float) is excluded: the templates own the layout, and a stray
 * `position: absolute` from a paste would escape the page box.
 */
const ALLOWED_STYLE_PROPS = new Set([
  "color",
  "background-color",
  "font-weight",
  "font-style",
  "font-family",
  "font-size",
  "text-decoration",
  "text-decoration-line",
  "letter-spacing",
  "text-transform",
]);

const SAFE_URL_SCHEMES = ["http:", "https:", "mailto:", "tel:"];

/**
 * C0 controls and DEL. Built from a string so the pattern stays plain ASCII in
 * the source — `java\nscript:` is exactly how a scheme check gets fooled, and
 * embedding the raw bytes here would make this line unreadable in a diff.
 *
 * no-control-regex is the whole point here: stripping these is what stops a
 * split scheme from slipping past sanitizeHref.
 */
// eslint-disable-next-line no-control-regex
const RE_CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]", "g");

/**
 * Matches one tag. The alternation in the attribute group lets a quoted
 * attribute value contain `>` without ending the match early.
 */
const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/g;

const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

/** Escapes text that sits between tags, leaving existing entities intact. */
function escapeText(text: string): string {
  return text
    .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#\d{1,7}|#[xX][0-9a-fA-F]{1,6});)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Keeps only whitelisted declarations, and only with inert values. */
function sanitizeStyle(raw: string): string {
  const declarations: string[] = [];

  for (const declaration of raw.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator === -1) continue;

    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();

    if (!ALLOWED_STYLE_PROPS.has(property)) continue;
    if (!value || value.length > 80) continue;
    // `url()` can fetch, `expression()` can execute in old engines, and a bare
    // `<` means the value is smuggling markup.
    if (/url\(|expression|javascript:|@import|[<>]/i.test(value)) continue;
    if (!/^[#a-zA-Z0-9\s.,()%\-_'"/]+$/.test(value)) continue;

    declarations.push(`${property}: ${value}`);
  }

  return declarations.join("; ");
}

/**
 * Normalises a href and rejects anything that isn't a plain document link.
 * A bare "github.com/x" — what people actually type — becomes https.
 */
export function sanitizeHref(raw: string): string | null {
  // Control characters are how `java\nscript:` gets past a naive scheme check.
  const value = raw.trim().replace(RE_CONTROL_CHARS, "");
  if (!value) return null;

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
    const scheme = value.slice(0, value.indexOf(":") + 1).toLowerCase();
    return SAFE_URL_SCHEMES.includes(scheme) ? value : null;
  }

  // Relative and in-document links have no meaning in an exported PDF.
  if (value.startsWith("#") || value.startsWith("/")) return null;
  if (value.includes("@") && !value.includes("/")) return `mailto:${value}`;

  return `https://${value}`;
}

/** Rebuilds a tag's attribute list from the few attributes each tag may keep. */
function sanitizeAttributes(tag: string, originalTag: string, raw: string): string {
  const attributes = new Map<string, string>();

  ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(raw))) {
    const name = match[1]!.toLowerCase();
    // Decoded before inspection, and re-escaped on the way out. Sanitizing is
    // idempotent only if it sees the same value the browser will: a font stack
    // is stored as `&quot;Underleaf Inter&quot;, Arial`, and judging that
    // spelling rather than the decoded one would drop it on the second pass.
    // It also closes the other direction — `&#106;avascript:` is examined as
    // `javascript:` and rejected, rather than slipping past the scheme test.
    const value = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");

    if (name === "style") {
      const style = sanitizeStyle(value);
      if (style) attributes.set("style", style);
      continue;
    }

    // <font color="..."> is what some editors and pasted content still emit;
    // fold it into the style the rest of the pipeline understands.
    if (name === "color" && originalTag === "font") {
      const style = sanitizeStyle(`color: ${value}`);
      if (style) attributes.set("style", [attributes.get("style"), style].filter(Boolean).join("; "));
      continue;
    }

    if (name === "href" && tag === "a") {
      const href = sanitizeHref(value);
      if (href) attributes.set("href", href);
      continue;
    }
  }

  if (tag === "a") {
    // A link with no surviving href is just decoration; keep it inert but
    // styled so the text doesn't silently lose its underline.
    if (attributes.has("href")) {
      attributes.set("target", "_blank");
      attributes.set("rel", "noopener noreferrer");
    }
  }

  let out = "";
  for (const [name, value] of attributes) out += ` ${name}="${escapeAttr(value)}"`;
  return out;
}

/**
 * Returns `input` reduced to the allowed inline subset, with tags balanced.
 *
 * Disallowed tags are dropped but their *text* is kept, so sanitizing never
 * silently deletes what someone wrote. Unclosed tags are closed at the end and
 * stray closers are ignored, so the result is always well-formed — important
 * because it goes straight into `innerHTML` and into the exported markup.
 */
export function sanitizeInlineHtml(input: string): string {
  if (!input) return "";
  // Overwhelmingly the common case: a field nobody has formatted.
  if (!input.includes("<") && !input.includes("&")) return input;

  const out: string[] = [];
  const open: string[] = [];
  let last = 0;

  TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_RE.exec(input))) {
    out.push(escapeText(input.slice(last, match.index)));
    last = TAG_RE.lastIndex;

    const originalTag = match[1]!.toLowerCase();
    const tag = TAG_ALIASES[originalTag] ?? originalTag;
    const closing = match[0].startsWith("</");

    if (!ALLOWED_TAGS.has(tag)) continue;

    if (closing) {
      const at = open.lastIndexOf(tag);
      if (at === -1) continue;
      // Close everything opened inside it too, innermost first — the input was
      // mis-nested, and leaving them open would swallow the rest of the field.
      for (let i = open.length - 1; i >= at; i--) out.push(`</${open[i]}>`);
      open.length = at;
      continue;
    }

    if (VOID_TAGS.has(tag)) {
      out.push("<br>");
      continue;
    }

    out.push(`<${tag}${sanitizeAttributes(tag, originalTag, match[2] ?? "")}>`);
    open.push(tag);
  }

  out.push(escapeText(input.slice(last)));
  for (let i = open.length - 1; i >= 0; i--) out.push(`</${open[i]}>`);

  return out.join("");
}

/**
 * Unwraps every `<a>` in already-sanitized HTML, keeping its label and any
 * formatting inside it.
 *
 * For renders where the document is a *picture* of a resume rather than a resume:
 * a thumbnail is `aria-hidden` and `pointer-events-none`, and its call sites sit
 * inside a `<Link>` to the editor — where a nested `<a>` is invalid HTML that
 * breaks hydration, and where a focusable link inside a decorative preview would
 * land in the tab order anyway.
 *
 * Only safe on the output of `sanitizeInlineHtml`, which balances its tags and
 * escapes `>` inside attribute values — so `[^>]*` cannot run past the tag, and
 * dropping the wrappers cannot unbalance what's left.
 */
export function stripAnchors(sanitized: string): string {
  if (!sanitized.includes("<a")) return sanitized;
  return sanitized.replace(/<a\b[^>]*>/gi, "").replace(/<\/a\s*>/gi, "");
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * The readable text of a field, with all markup removed. Used wherever a plain
 * string is required — comma-splitting a skills list, emptiness checks, and any
 * value that has to survive as data rather than as display.
 */
export function htmlToPlainText(input: string): string {
  if (!input) return "";
  if (!input.includes("<") && !input.includes("&")) return input;

  return decodeEntities(
    input
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]*>/g, ""),
  );
}

/** Escapes a plain string for use as field HTML. */
export function plainTextToHtml(input: string): string {
  return escapeText(input);
}

/**
 * True when a field renders as nothing. Templates branch on whether an optional
 * field has content, and `"<b></b>"` is truthy while displaying as empty — this
 * asks the question they actually mean.
 */
export function isBlankHtml(input: string | undefined | null): boolean {
  return !input || htmlToPlainText(input).trim() === "";
}
