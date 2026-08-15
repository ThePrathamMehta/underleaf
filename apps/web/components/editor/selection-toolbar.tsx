"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { FONT_CATALOG, type Theme } from "@repo/types";
import { fontStack } from "@repo/ui/resume/styles";
import { sanitizeHref } from "@repo/ui/resume/rich-text";
import { fontLabel } from "./toolbar";

/**
 * Formatting for the *current selection*, as opposed to the document-wide
 * controls in the main toolbar. Both exist: the header toolbar sets the
 * typeface and colour of the whole resume, this one overrides a single run.
 *
 * It reads and writes the field's own inline HTML, which is what
 * `sanitizeInlineHtml` in @repo/ui defines and what the schema now stores — so
 * a bolded word survives the save, the reload, and the PDF export.
 *
 * `document.execCommand` is formally deprecated and has no replacement for
 * contentEditable. It is used deliberately: it is the only API that edits a
 * selection *and* participates in the browser's native undo stack, which the
 * editor relies on for in-field undo (see the Cmd+Z handler in the editor page,
 * which steps aside while a field has focus).
 */

/** Anything positioned inside the toolbar; used to keep focus/selection intact. */
const TOOLBAR_ATTR = "data-selection-toolbar";

/** Height of the editor's sticky header (14 + 12 rows), plus a little air. */
const HEADER_SAFE_PX = 112;

const GAP = 10;
const EDGE = 8;

/**
 * Print-safe accents for a single run. Kept in the same register as the
 * document palette — a resume is read in greyscale as often as in colour.
 */
const TEXT_COLORS = [
  "#1a1a1a",
  "#c2410c",
  "#1e3a5f",
  "#14532d",
  "#7f1d1d",
  "#4c1d95",
  "#0f766e",
  "#6b7280",
] as const;

/** Light washes: `printBackground` is on for the export, so these reach paper. */
const HIGHLIGHT_COLORS = ["#fff2a8", "#d8f3e3", "#dbeafe", "#fadde1"] as const;

type Marks = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  highlight: boolean;
  /** The href of the link the selection sits in, or null. */
  link: string | null;
};

const NO_MARKS: Marks = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  highlight: false,
  link: null,
};

type Panel = "color" | "font" | "link" | null;

/**
 * Which side of the run the bar ended up on. Only used to pick the direction it
 * animates in from — the position itself is fully resolved into `top`/`left`.
 */
type From = "below" | "above" | "side";

/** The editable element a node belongs to, but only if it accepts formatting. */
function richFieldOf(node: Node | null): HTMLElement | null {
  const start = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  return start?.closest<HTMLElement>("[data-editable-field][data-rich]") ?? null;
}

/** Walks from `node` up to (but not past) `field`, testing each element. */
function ancestorWithin(
  node: Node | null,
  field: HTMLElement,
  test: (el: HTMLElement) => boolean,
): HTMLElement | null {
  let el = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  while (el && el !== field) {
    if (test(el)) return el;
    el = el.parentElement;
  }
  return null;
}

/**
 * Whether the run carries a highlight.
 *
 * Deliberately checks the *inline* background rather than the computed one:
 * the editor tints a focused field (see the `.rd-canvas-host` rules in
 * themeToCss), so a computed-style check would report every focused field as
 * highlighted.
 */
function hasHighlight(node: Node | null, field: HTMLElement): boolean {
  return (
    ancestorWithin(node, field, (el) => {
      if (el.tagName === "MARK") return true;
      const background = el.style.backgroundColor;
      return Boolean(background) && background !== "transparent" && background !== "rgba(0, 0, 0, 0)";
    }) !== null
  );
}

function linkAt(node: Node | null, field: HTMLElement): HTMLAnchorElement | null {
  return ancestorWithin(node, field, (el) => el.tagName === "A") as HTMLAnchorElement | null;
}

function queryState(command: string): boolean {
  try {
    return document.queryCommandState(command);
  } catch {
    return false;
  }
}

/**
 * Runs an editing command.
 *
 * `styleWithCSS` decides whether the browser writes `<b>` or
 * `<span style="font-weight: bold">`. Tags are preferred for the marks — they
 * are what the resume stylesheet targets and what reads sanely in stored
 * content — and CSS is used for colour and typeface, which have no tag.
 */
function exec(command: string, value?: string, css = false): boolean {
  try {
    document.execCommand("styleWithCSS", false, css ? "true" : "false");
    const ok = document.execCommand(command, false, value);
    // Leave the flag off, so the browser's own Cmd+B produces a tag too.
    document.execCommand("styleWithCSS", false, "false");
    return ok;
  } catch {
    return false;
  }
}

const loadedCatalogFonts = new Set<string>();

async function loadCatalogFont(family: string): Promise<void> {
  if (loadedCatalogFonts.has(family)) return;
  const label = fontLabel(family);
  const id = `underleaf-font-${family}`;
  if (!document.getElementById(id)) {
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(label)}:wght@400;700&display=swap`;
    const ready = new Promise<void>((resolve) => {
      link.addEventListener("load", () => resolve(), { once: true });
      link.addEventListener("error", () => resolve(), { once: true });
    });
    document.head.appendChild(link);
    await ready;
  }
  try {
    await document.fonts.load(`400 1em "${label}"`);
  } finally {
    loadedCatalogFonts.add(family);
  }
}

export function SelectionToolbar({ theme }: { theme: Theme }) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [marks, setMarks] = useState<Marks>(NO_MARKS);
  const [origin, setOrigin] = useState<{ top: number; left: number; from: From }>({
    top: 0,
    left: 0,
    from: "below",
  });
  const [panel, setPanel] = useState<Panel>(null);
  const [linkDraft, setLinkDraft] = useState("");
  const [fontQuery, setFontQuery] = useState("");

  const barRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLElement | null>(null);
  const rangeRef = useRef<Range | null>(null);
  // Read by the selectionchange listener, which is registered once.
  const panelRef = useRef<Panel>(null);
  panelRef.current = panel;

  useEffect(() => setMounted(true), []);

  /**
   * Positions the bar against a selection rect, kept inside the viewport.
   *
   * Below the run is preferred: the whole point of a selection bar is to format
   * text you can still see, and above it covers the line you just selected.
   * Above is the fallback for a run near the bottom edge, and when neither band
   * has room the bar sits beside the run instead of over it.
   *
   * `top`/`left` are resolved all the way to viewport coordinates rather than
   * leaning on a `translateY(-100%)` to shift the bar up off its anchor. This is
   * a `motion.div`, and Framer composes the whole `transform` property from its
   * own x/y/scale — an inline transform alongside that is silently dropped.
   */
  const place = useCallback((rect: DOMRect) => {
    const bar = barRef.current?.getBoundingClientRect();
    const width = bar?.width || 320;
    const height = bar?.height || 40;

    const centred = rect.left + rect.width / 2 - width / 2;
    const clampX = (x: number) => Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE));

    const below = rect.bottom + GAP;
    const above = rect.top - GAP - height;

    if (below + height <= window.innerHeight - EDGE) {
      setOrigin({ top: below, left: clampX(centred), from: "below" });
      return;
    }

    // HEADER_SAFE_PX, not EDGE: above the run also means under the editor's
    // sticky header, which would take the bar's buttons with it.
    if (above >= HEADER_SAFE_PX) {
      setOrigin({ top: above, left: clampX(centred), from: "above" });
      return;
    }

    // A short viewport with the run in the middle of it. Prefer the right of the
    // run, fall back to its left, and centre on it vertically.
    const rightOf = rect.right + GAP;
    const fitsRight = rightOf + width <= window.innerWidth - EDGE;
    setOrigin({
      top: Math.max(
        HEADER_SAFE_PX,
        Math.min(rect.top + rect.height / 2 - height / 2, window.innerHeight - height - EDGE),
      ),
      left: Math.max(EDGE, fitsRight ? rightOf : rect.left - GAP - width),
      from: "side",
    });
  }, []);

  /** Reads the live selection and shows the bar, or hides it if there's none. */
  const sync = useCallback(() => {
    // A panel with an input has taken focus on purpose; the range we saved is
    // still the one the user means, so don't tear the bar down under them.
    if (panelRef.current === "link" || panelRef.current === "font") return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setVisible(false);
      setPanel(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const field = richFieldOf(range.commonAncestorContainer);
    // A selection dragged across two fields can't be formatted as one run.
    if (!field || !field.contains(range.startContainer) || !field.contains(range.endContainer)) {
      setVisible(false);
      setPanel(null);
      return;
    }

    fieldRef.current = field;
    rangeRef.current = range.cloneRange();

    const anchor = linkAt(range.startContainer, field);
    setMarks({
      bold: queryState("bold"),
      italic: queryState("italic"),
      underline: queryState("underline"),
      strike: queryState("strikeThrough"),
      highlight: hasHighlight(range.startContainer, field),
      link: anchor?.getAttribute("href") ?? null,
    });
    place(range.getBoundingClientRect());
    setVisible(true);
  }, [place]);

  useEffect(() => {
    document.addEventListener("selectionchange", sync);
    // The canvas scrolls under a fixed bar, and either can resize it.
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      document.removeEventListener("selectionchange", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [sync]);

  // Escape closes a panel first, then the bar — the usual layered dismissal.
  useEffect(() => {
    if (!visible) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (panelRef.current) setPanel(null);
      else setVisible(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [visible]);

  // A click anywhere that isn't the bar or an editable field dismisses it. The
  // link panel needs this: its input holds focus, so no selectionchange comes.
  useEffect(() => {
    if (!visible) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest(`[${TOOLBAR_ATTR}]`) || richFieldOf(target)) return;
      setVisible(false);
      setPanel(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [visible]);

  // Opening a panel makes the bar taller and wider; re-anchor to the same run.
  useLayoutEffect(() => {
    const range = rangeRef.current;
    if (visible && range) place(range.getBoundingClientRect());
  }, [panel, visible, place]);

  /**
   * Restores the user's selection, runs `command`, and reports the resulting
   * HTML to the editor.
   *
   * The report goes out as an `input` event on the field rather than as a
   * direct call, so it lands in `EditableText`'s own handler — that handler
   * records what the DOM now holds, which is what stops the next render from
   * rewriting the node and throwing the caret to the start.
   */
  const apply = useCallback(
    (command: () => void) => {
      const field = fieldRef.current;
      const range = rangeRef.current;
      if (!field || !range) return;

      // Focus may be sitting in the link input; the command acts on whatever is
      // selected, so put the run back first.
      field.focus({ preventScroll: true });
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      let reported = false;
      const note = () => {
        reported = true;
      };
      field.addEventListener("input", note, { once: true });
      command();
      field.removeEventListener("input", note);
      // Editing commands fire `input` themselves in every browser we target;
      // this is the belt for the braces, and costs one redundant no-op write.
      if (!reported) field.dispatchEvent(new Event("input", { bubbles: true }));

      const after = window.getSelection();
      if (after && after.rangeCount > 0) rangeRef.current = after.getRangeAt(0).cloneRange();
      sync();
    },
    [sync],
  );

  const openLinkPanel = useCallback(() => {
    setLinkDraft(marks.link ?? "");
    setPanel((current) => (current === "link" ? null : "link"));
  }, [marks.link]);

  const commitLink = useCallback(() => {
    const href = sanitizeHref(linkDraft);
    apply(() => {
      // Clearing the box is how you remove a link, so an empty draft unlinks.
      if (!href) exec("unlink");
      else exec("createLink", href);
    });
    setPanel(null);
  }, [apply, linkDraft]);

  const toggleHighlight = useCallback(
    (color: string | null) => {
      apply(() => {
        const value = color ?? "transparent";
        // Chrome and Firefox implement hiliteColor; Safari only backColor.
        if (!exec("hiliteColor", value, true)) exec("backColor", value, true);
      });
    },
    [apply],
  );

  if (!mounted) return null;

  return createPortal(
    <motion.div
      ref={barRef}
      {...{ [TOOLBAR_ATTR]: "" }}
      // The canvas clears its focused-section ring on any outside pointerdown;
      // this marks the bar as part of the editor's own chrome.
      data-canvas-overlay
      role="toolbar"
      aria-label="Text formatting"
      aria-hidden={!visible}
      initial={false}
      animate={
        visible
          ? { opacity: 1, scale: 1, y: 0 }
          : // Retreats towards the run it belongs to, so the dismissal reads as
            // the bar leaving that text rather than drifting somewhere generic.
            { opacity: 0, scale: 0.97, y: origin.from === "above" ? 4 : origin.from === "below" ? -4 : 0 }
      }
      transition={{ duration: 0.13, ease: [0.22, 1, 0.36, 1] }}
      style={{
        top: origin.top,
        left: origin.left,
        pointerEvents: visible ? "auto" : "none",
      }}
      className="fixed z-50 w-max max-w-[calc(100vw-1rem)] rounded-xl bg-paper-raised p-1 shadow-lift ring-1 ring-rule"
    >
      <div className="flex items-center gap-0.5">
        <MarkButton label="Bold" active={marks.bold} onClick={() => apply(() => exec("bold"))}>
          <BoldIcon />
        </MarkButton>
        <MarkButton label="Italic" active={marks.italic} onClick={() => apply(() => exec("italic"))}>
          <ItalicIcon />
        </MarkButton>
        <MarkButton
          label="Underline"
          active={marks.underline}
          onClick={() => apply(() => exec("underline"))}
        >
          <UnderlineIcon />
        </MarkButton>
        <MarkButton
          label="Strikethrough"
          active={marks.strike}
          onClick={() => apply(() => exec("strikeThrough"))}
        >
          <StrikeIcon />
        </MarkButton>

        <Divider />

        <MarkButton
          label="Text color and highlight"
          active={panel === "color" || marks.highlight}
          onClick={() => setPanel(panel === "color" ? null : "color")}
        >
          <ColorIcon />
        </MarkButton>
        <MarkButton
          label="Typeface for this selection"
          active={panel === "font"}
          onClick={() => setPanel(panel === "font" ? null : "font")}
        >
          <TypefaceIcon />
        </MarkButton>

        <Divider />

        <MarkButton label={marks.link ? "Edit link" : "Add link"} active={Boolean(marks.link) || panel === "link"} onClick={openLinkPanel}>
          <LinkIcon />
        </MarkButton>
        <MarkButton
          label="Clear formatting"
          onClick={() =>
            apply(() => {
              exec("removeFormat");
              // removeFormat leaves anchors alone in Chrome.
              exec("unlink");
            })
          }
        >
          <ClearIcon />
        </MarkButton>
      </div>

      {panel === "color" && (
        <div className="mt-1 space-y-2 border-t border-rule px-1.5 pb-1 pt-2">
          <SwatchLine
            label="Text"
            colors={TEXT_COLORS}
            onPick={(color) => apply(() => exec("foreColor", color, true))}
            onReset={() => apply(() => exec("foreColor", theme.textColor, true))}
            resetLabel="Default"
          />
          <SwatchLine
            label="Mark"
            colors={HIGHLIGHT_COLORS}
            onPick={(color) => toggleHighlight(color)}
            onReset={() => toggleHighlight(null)}
            resetLabel="None"
          />
        </div>
      )}

      {panel === "font" && (
        <div className="mt-1 w-[19rem] border-t border-rule p-1.5 pt-2">
          <input
            autoFocus
            value={fontQuery}
            onChange={(event) => setFontQuery(event.target.value)}
            placeholder="Search fonts…"
            aria-label="Search selection fonts"
            className="mb-1.5 h-8 w-full rounded-md bg-paper-sunken px-2 text-[0.8125rem] outline-none ring-1 ring-transparent placeholder:text-ink-faint focus:ring-accent-ring"
          />
          <div className="grid max-h-52 grid-cols-2 gap-0.5 overflow-y-auto">
            <FontOption
              label="Match document"
              stack={fontStack(theme.fontFamily)}
              onPick={(stack) => {
                apply(() => exec("fontName", stack, true));
                setPanel(null);
                setFontQuery("");
              }}
            />
            {FONT_CATALOG.filter((family) =>
              family !== theme.fontFamily && fontLabel(family).toLowerCase().includes(fontQuery.trim().toLowerCase())
            ).map((family) => (
              <FontOption
                key={family}
                label={fontLabel(family)}
                stack={fontStack(family)}
                onPick={(stack) => {
                  void loadCatalogFont(family).then(() => apply(() => exec("fontName", stack, true)));
                  setPanel(null);
                  setFontQuery("");
                }}
              />
            ))}
          </div>
        </div>
      )}

      {panel === "link" && (
        <div className="mt-1 flex items-center gap-1 border-t border-rule p-1.5 pt-2">
          <input
            autoFocus
            value={linkDraft}
            onChange={(event) => setLinkDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitLink();
              }
            }}
            placeholder="example.com or name@work.com"
            aria-label="Link address"
            className="h-8 w-[17rem] rounded-md bg-paper-sunken px-2 text-[0.8125rem] outline-none ring-1 ring-transparent transition-shadow placeholder:text-ink-faint focus:ring-accent-ring"
          />
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={commitLink}
            className="h-8 shrink-0 rounded-md bg-ink px-2.5 text-[0.8125rem] text-paper transition-opacity hover:opacity-90"
          >
            {linkDraft.trim() ? "Apply" : "Remove"}
          </button>
        </div>
      )}
    </motion.div>,
    document.body,
  );
}

/**
 * A button that acts on the current selection.
 *
 * The mousedown default is prevented so focus never leaves the field — a normal
 * click would move focus to the button and collapse the very selection the
 * handler is about to format. (Same pattern noted in controls.tsx.)
 */
function MarkButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-150 ${
        active ? "bg-ink text-paper" : "text-ink-muted hover:bg-paper-sunken hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="mx-0.5 h-5 w-px shrink-0 bg-rule" aria-hidden />;
}

function SwatchLine({
  label,
  colors,
  onPick,
  onReset,
  resetLabel,
}: {
  label: string;
  colors: readonly string[];
  onPick: (color: string) => void;
  onReset: () => void;
  resetLabel: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 shrink-0 font-mono text-[0.625rem] uppercase tracking-[0.12em] text-ink-faint">
        {label}
      </span>
      <div className="flex items-center gap-1">
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            title={color}
            aria-label={`${label}: ${color}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(color)}
            style={{ background: color }}
            className="h-5 w-5 rounded-full ring-1 ring-inset ring-black/15 transition-transform duration-150 hover:scale-110"
          />
        ))}
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onReset}
          className="ml-0.5 h-5 rounded-full px-1.5 text-[0.6875rem] text-ink-faint transition-colors hover:bg-paper-sunken hover:text-ink"
        >
          {resetLabel}
        </button>
      </div>
    </div>
  );
}

function FontOption({
  label,
  stack,
  onPick,
}: {
  label: string;
  stack: string;
  onPick: (stack: string) => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onPick(stack)}
      // Previewed in the face it applies, so the choice is honest.
      style={{ fontFamily: stack }}
      className="truncate rounded-md px-2 py-1.5 text-left text-sm text-ink-muted transition-colors hover:bg-paper-sunken hover:text-ink"
    >
      {label}
    </button>
  );
}

// --- Icons (stroked to match the editor chrome, filled only where a glyph reads better) ---

const svg = {
  width: 15,
  height: 15,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function BoldIcon() {
  return (
    <svg {...svg} strokeWidth={2.1}>
      <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7z" />
      <path d="M7 12h6.8a3.5 3.5 0 0 1 0 7H7z" />
    </svg>
  );
}

function ItalicIcon() {
  return (
    <svg {...svg}>
      <path d="M15 5h-5M14 19H9M14 5l-4 14" />
    </svg>
  );
}

function UnderlineIcon() {
  return (
    <svg {...svg}>
      <path d="M7 4v6a5 5 0 0 0 10 0V4" />
      <path d="M6 20h12" />
    </svg>
  );
}

function StrikeIcon() {
  return (
    <svg {...svg}>
      <path d="M5 12h14" />
      <path d="M8 7a4 4 0 0 1 8 0" />
      <path d="M16 15a4 4 0 0 1-8 0" />
    </svg>
  );
}

function ColorIcon() {
  return (
    <svg {...svg}>
      <path d="M6 16 11 5l5 11" />
      <path d="M7.6 13h6.8" />
      <path d="M4 20h16" strokeWidth={2.5} />
    </svg>
  );
}

function TypefaceIcon() {
  return (
    <svg {...svg}>
      <path d="M5 7V5h14v2M12 5v14M9 19h6" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg {...svg}>
      <path d="M10 13a4 4 0 0 0 5.7.3l2.6-2.6a4 4 0 0 0-5.6-5.7l-1.5 1.5" />
      <path d="M14 11a4 4 0 0 0-5.7-.3l-2.6 2.6a4 4 0 0 0 5.6 5.7l1.5-1.5" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg {...svg}>
      <path d="M8 6h11M13 6l-3 12M5 18h7" />
      <path d="m16 14 5 5M21 14l-5 5" />
    </svg>
  );
}
