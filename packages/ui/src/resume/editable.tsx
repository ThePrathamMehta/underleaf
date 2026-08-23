"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import { htmlToPlainText, plainTextToHtml, sanitizeInlineHtml, stripAnchors } from "./rich-text";

/** Path into the resume content JSON, e.g. ["sections", 2, "items", 0, "role"]. */
export type FieldPath = (string | number)[];

type ResumeEditingValue = {
  onFieldChange: (path: FieldPath, value: string) => void;
  /** Called when a field loses focus, so the editor can snapshot for undo. */
  onFieldCommit: () => void;
};

/**
 * Absent by default. The Puppeteer export path renders without a provider and
 * gets inert, non-editable markup from the very same components the editor uses.
 */
const ResumeEditingContext = createContext<ResumeEditingValue | null>(null);

export const ResumeEditingProvider = ResumeEditingContext.Provider;

export function useResumeEditing(): ResumeEditingValue | null {
  return useContext(ResumeEditingContext);
}

/**
 * Whether this render may emit real `<a>` elements.
 *
 * On by default, because for the two renders that matter — the editor's canvas and
 * the exported PDF — a clickable portfolio URL is the entire point of a contact
 * link. Off for a render that is a *picture* of a resume: `ResumeDocument`'s
 * `inert` prop turns it off for thumbnails, which are `aria-hidden` and
 * `pointer-events-none` and whose call sites wrap them in a `<Link>` to the editor.
 * An `<a>` inside an `<a>` is invalid HTML and breaks hydration.
 *
 * A context rather than a prop threaded through the templates: every template
 * renders contact links, and none of them should have to know or care why this
 * particular render isn't interactive.
 */
const ResumeLinksContext = createContext(true);

export const ResumeLinksProvider = ResumeLinksContext.Provider;

type EditableTextProps = {
  value: string;
  path: FieldPath;
  className?: string;
  placeholder?: string;
  /** Renders as a block element; inline by default to sit within a text run. */
  as?: "span" | "div" | "p" | "h1" | "h2" | "li";
  multiline?: boolean;
  /**
   * Whether the field may carry inline formatting (bold, colour, links).
   *
   * Off for fields whose string is really structured data rather than prose —
   * the skills list is round-tripped through a comma split, so markup in it
   * would be sliced apart at the commas.
   */
  rich?: boolean;
  /**
   * Extra attributes stamped onto the rendered element. Used to mark a field as
   * a pagination block (see paginate.ts) when the field *is* the block — a
   * bullet or a summary paragraph — rather than being wrapped in one.
   */
  blockAttrs?: Record<string, string | number>;
};

/**
 * A text field that is `contentEditable` when an editing provider is present.
 *
 * Deliberately uncontrolled while focused: React must not rewrite the DOM of a
 * node the user is typing into, or the caret jumps to the start on every
 * keystroke. The DOM is the source of truth during a focused edit; props take
 * over again once focus leaves.
 *
 * In `rich` mode the field's value is a small subset of inline HTML (see
 * rich-text.ts) rather than plain text, which is what lets the selection
 * toolbar bold or recolour a single word. The DOM is only sanitized on paste
 * and on blur — sanitizing on every keystroke would rewrite the node mid-edit
 * and collapse the caret, which is the exact failure this component exists to
 * avoid.
 */
export function EditableText({
  value,
  path,
  className,
  placeholder,
  as: Tag = "span",
  multiline = false,
  rich = true,
  blockAttrs,
}: EditableTextProps) {
  const editing = useResumeEditing();
  const links = useContext(ResumeLinksContext);
  const ref = useRef<HTMLElement>(null);
  // The last value we know this node's DOM holds. It lets the effect tell an
  // external change (undo/redo, template switch, reset) apart from the echo of
  // the user's own keystroke, so we only rewrite the node — and disturb the
  // caret — when the text genuinely came from elsewhere. Starts null so the
  // first mount always writes, even for a non-empty value.
  const lastKnownValueRef = useRef<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The user's own edit already put this text in the DOM; writing it back
    // would collapse the caret for no reason. Null on mount, so the first run
    // still writes.
    if (value === lastKnownValueRef.current) return;
    lastKnownValueRef.current = value;

    if (rich) {
      const html = sanitizeInlineHtml(value);
      if (el.innerHTML !== html) el.innerHTML = html;
    } else if (el.textContent !== value) {
      el.textContent = value;
    }
  }, [value, rich]);

  if (!editing) {
    if (!rich) return <Tag className={className} {...blockAttrs}>{value}</Tag>;
    // Sanitized at render, not trusted from storage: this same path renders the
    // exported PDF, and content can reach the database by routes other than
    // this component.
    //
    // A field's own HTML can hold links too — the selection toolbar makes them
    // inside a bullet — so an inert render has to unwrap those as well, not just
    // the contact links `EditableLink` renders.
    const html = sanitizeInlineHtml(value);
    return (
      <Tag
        className={className}
        {...blockAttrs}
        dangerouslySetInnerHTML={{ __html: links ? html : stripAnchors(html) }}
      />
    );
  }

  /** Reads the node's current value in whichever representation this field uses. */
  function read(el: HTMLElement): string {
    return rich ? el.innerHTML : (el.textContent ?? "");
  }

  // No React-managed children: the node's content is written imperatively above.
  // Rendering {value} here would let React reconcile — and reset — the very
  // text node the user is typing into on every keystroke.
  return (
    <Tag
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={ref as any}
      className={className}
      {...blockAttrs}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      data-editable-field=""
      data-rich={rich ? "" : undefined}
      data-placeholder={placeholder ?? ""}
      onInput={(event: React.FormEvent<HTMLElement>) => {
        // Record what the DOM now holds before telling the editor, so the
        // resulting re-render's effect recognises this as our own edit and
        // leaves the caret alone.
        lastKnownValueRef.current = read(event.currentTarget);
        editing.onFieldChange(path, lastKnownValueRef.current);
      }}
      onPaste={(event: React.ClipboardEvent<HTMLElement>) => {
        // The browser would otherwise paste whole stylesheets and block
        // elements out of Word or a web page. Take only what a resume field can
        // represent, and insert it ourselves.
        event.preventDefault();
        const clipboard = event.clipboardData;
        const html = rich ? clipboard.getData("text/html") : "";
        const text = clipboard.getData("text/plain");

        let insert = html ? sanitizeInlineHtml(html) : plainTextToHtml(text);
        // A single-line field can't show newlines, and a pasted paragraph break
        // would silently vanish on the next render otherwise.
        if (!multiline) insert = insert.replace(/<br\s*\/?>/gi, " ");

        document.execCommand("insertHTML", false, insert);
      }}
      onBlur={(event: React.FocusEvent<HTMLElement>) => {
        // Focus moving into the selection toolbar isn't the end of an edit —
        // its link box has to take focus to be typed into, and it then acts on
        // this field's own nodes. Normalising here would replace those nodes
        // and detach the range the toolbar saved, so leave the field alone and
        // let the real blur (a click somewhere else) do the tidying.
        const next = event.relatedTarget as HTMLElement | null;
        if (next?.closest?.("[data-selection-toolbar]")) return;

        // Normalise once the user is done: browsers leave behind their own
        // markup (nested spans, <div> wrappers from Enter) that we don't want
        // to store, but rewriting it mid-edit would move the caret.
        if (rich) {
          const el = event.currentTarget;
          const clean = sanitizeInlineHtml(el.innerHTML);
          if (clean !== el.innerHTML) {
            el.innerHTML = clean;
            lastKnownValueRef.current = clean;
            editing.onFieldChange(path, clean);
          }
        }
        editing.onFieldCommit();
      }}
      onKeyDown={(event: React.KeyboardEvent<HTMLElement>) => {
        // Single-line fields shouldn't accept newlines that the JSON can't show.
        if (event.key === "Enter" && !multiline) {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

/**
 * Renders `value` as a link in print, plain editable text in the editor.
 *
 * Used for the contact links in the header, whose URL lives in a separate field
 * — distinct from an inline link inside a bullet, which the selection toolbar
 * creates as an `<a>` within the field's own HTML.
 */
export function EditableLink({
  value,
  path,
  url,
  className,
  placeholder,
}: EditableTextProps & { url: string }) {
  const editing = useResumeEditing();
  const links = useContext(ResumeLinksContext);

  if (editing) {
    return <EditableText value={value} path={path} className={className} placeholder={placeholder} />;
  }

  // The label may carry its own formatting; the href never does.
  const label = sanitizeInlineHtml(value);

  // An inert render keeps the label and its styling and drops only the
  // navigation, so a thumbnail still looks exactly like the page it previews.
  if (!links) {
    return <span className={className} dangerouslySetInnerHTML={{ __html: stripAnchors(label) }} />;
  }

  const target = htmlToPlainText(url).trim();
  const href = target.startsWith("http") ? target : `https://${target}`;
  return <a className={className} href={href} dangerouslySetInnerHTML={{ __html: label }} />;
}
