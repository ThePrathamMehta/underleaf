"use client";

import { createContext, useContext, useEffect, useRef } from "react";

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

type EditableTextProps = {
  value: string;
  path: FieldPath;
  className?: string;
  placeholder?: string;
  /** Renders as a block element; inline by default to sit within a text run. */
  as?: "span" | "div" | "p" | "h1" | "h2" | "li";
  multiline?: boolean;
};

/**
 * A text field that is `contentEditable` when an editing provider is present.
 *
 * Deliberately uncontrolled while focused: React must not rewrite the DOM of a
 * node the user is typing into, or the caret jumps to the start on every
 * keystroke. The DOM is the source of truth during a focused edit; props take
 * over again once focus leaves.
 */
export function EditableText({
  value,
  path,
  className,
  placeholder,
  as: Tag = "span",
  multiline = false,
}: EditableTextProps) {
  const editing = useResumeEditing();
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Skip while focused — see the caret note above.
    if (document.activeElement === el) return;
    if (el.textContent !== value) {
      el.textContent = value;
    }
  }, [value]);

  if (!editing) {
    return <Tag className={className}>{value}</Tag>;
  }

  return (
    <Tag
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={ref as any}
      className={className}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      data-placeholder={placeholder ?? ""}
      onInput={(event: React.FormEvent<HTMLElement>) => {
        editing.onFieldChange(path, event.currentTarget.textContent ?? "");
      }}
      onBlur={editing.onFieldCommit}
      onKeyDown={(event: React.KeyboardEvent<HTMLElement>) => {
        // Single-line fields shouldn't accept newlines that the JSON can't show.
        if (event.key === "Enter" && !multiline) {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    >
      {value}
    </Tag>
  );
}

/** Renders `value` as a link in print, plain editable text in the editor. */
export function EditableLink({
  value,
  path,
  url,
  className,
  placeholder,
}: EditableTextProps & { url: string }) {
  const editing = useResumeEditing();

  if (editing) {
    return <EditableText value={value} path={path} className={className} placeholder={placeholder} />;
  }

  const href = url.startsWith("http") ? url : `https://${url}`;
  return (
    <a className={className} href={href}>
      {value}
    </a>
  );
}
