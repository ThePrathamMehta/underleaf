"use client";

import { Reorder, useDragControls } from "framer-motion";
import { useState } from "react";
import type { Section, SectionType } from "@repo/types";
import { SECTION_TYPES } from "@repo/types";
import { htmlToPlainText } from "@repo/ui/resume/rich-text";
import { FieldLabel, Popover } from "./controls";

const SECTION_LABELS: Record<SectionType, string> = {
  summary: "Summary",
  experience: "Experience",
  education: "Education",
  skills: "Skills",
  projects: "Projects",
  certifications: "Certifications",
  custom: "Custom section",
};

/**
 * Right-hand outline: reorder, show/hide and remove sections.
 *
 * Reordering happens here rather than on the canvas itself — dragging a page
 * element that is also `contentEditable` fights the text caret, and the spec
 * rules out free positioning anyway.
 */
export function SectionPanel({
  sections,
  onReorder,
  onToggle,
  onRemove,
  onAdd,
  onFocusSection,
}: {
  sections: Section[];
  onReorder: (fromId: string, toId: string) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: (type: SectionType) => void;
  onFocusSection: (id: string) => void;
}) {
  const ordered = [...sections].sort((a, b) => a.order - b.order);
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <aside className="hidden w-10 shrink-0 border-l border-rule bg-paper xl:flex xl:flex-col xl:items-center">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="Show sections"
          aria-label="Show sections"
          className="mt-4 rounded-md p-2 text-ink-faint transition-colors hover:bg-paper-sunken hover:text-ink"
        >
          <ChevronLeftIcon />
        </button>
      </aside>
    );
  }

  return (
    <aside className="hidden w-[17.5rem] shrink-0 border-l border-rule bg-paper xl:flex xl:flex-col">
      <div className="flex items-center justify-between px-5 pb-3 pt-5">
        <FieldLabel>Sections</FieldLabel>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[0.625rem] tabular-nums text-ink-faint">
            {ordered.filter((s) => s.visible).length}/{ordered.length}
          </span>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            title="Hide sections"
            aria-label="Hide sections"
            className="rounded p-1 text-ink-faint transition-colors hover:text-ink"
          >
            <ChevronRightIcon />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <Reorder.Group
          axis="y"
          values={ordered}
          // Framer hands back the reordered array; translate it into the single
          // move that happened so the reducer keeps one undo step per drag.
          onReorder={(next: Section[]) => {
            const movedIndex = next.findIndex((section, index) => section.id !== ordered[index]?.id);
            if (movedIndex === -1) return;
            const moved = next[movedIndex];
            const displaced = ordered[movedIndex];
            if (moved && displaced) onReorder(moved.id, displaced.id);
          }}
          className="space-y-1"
        >
          {ordered.map((section) => (
            <SectionRow
              key={section.id}
              section={section}
              onToggle={() => onToggle(section.id)}
              onRemove={() => onRemove(section.id)}
              onFocus={() => onFocusSection(section.id)}
            />
          ))}
        </Reorder.Group>

        {ordered.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-ink-faint">
            No sections yet. Add one below.
          </p>
        )}
      </div>

      <div className="border-t border-rule p-3">
        <Popover
          width={220}
          align="right"
          trigger={({ open, toggle }) => (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              className="flex h-9 w-full items-center justify-center gap-2 rounded-lg text-sm text-ink-muted ring-1 ring-inset ring-rule-strong transition-colors hover:bg-paper-sunken hover:text-ink"
            >
              <PlusIcon />
              Add section
            </button>
          )}
        >
          {(close) => (
            <div className="space-y-0.5">
              {SECTION_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => {
                    onAdd(type);
                    close();
                  }}
                  className="w-full rounded-md px-2 py-1.5 text-left text-sm text-ink-muted transition-colors hover:bg-paper-sunken hover:text-ink"
                >
                  {SECTION_LABELS[type]}
                </button>
              ))}
            </div>
          )}
        </Popover>
      </div>
    </aside>
  );
}

function SectionRow({
  section,
  onToggle,
  onRemove,
  onFocus,
}: {
  section: Section;
  onToggle: () => void;
  onRemove: () => void;
  onFocus: () => void;
}) {
  // Drag starts only from the handle, so the row's buttons stay clickable.
  const controls = useDragControls();
  const title = htmlToPlainText(section.title).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim() || SECTION_LABELS[section.type];

  return (
    <Reorder.Item
      value={section}
      dragListener={false}
      dragControls={controls}
      layout
      transition={{ type: "spring", stiffness: 520, damping: 38 }}
      whileDrag={{ scale: 1.02, zIndex: 10 }}
      className="group flex list-none items-center gap-1 rounded-lg bg-paper px-1.5 py-1 transition-colors hover:bg-paper-sunken"
    >
      <button
        type="button"
        aria-label={`Reorder ${title}`}
        onPointerDown={(event) => controls.start(event)}
        className="cursor-grab touch-none p-1 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
      >
        <GripIcon />
      </button>

      <button
        type="button"
        onClick={onFocus}
        className={`min-w-0 flex-1 truncate py-1 text-left text-sm transition-colors ${
          section.visible ? "text-ink" : "text-ink-faint line-through decoration-1"
        }`}
      >
        {title}
      </button>

      <button
        type="button"
        onClick={onToggle}
        title={section.visible ? "Hide section" : "Show section"}
        aria-label={section.visible ? `Hide ${title}` : `Show ${title}`}
        className="rounded p-1 text-ink-faint transition-colors hover:text-ink"
      >
        {section.visible ? <EyeIcon /> : <EyeOffIcon />}
      </button>

      <button
        type="button"
        onClick={onRemove}
        title="Delete section"
        aria-label={`Delete ${title}`}
        className="rounded p-1 text-ink-faint opacity-0 transition-all hover:text-danger group-hover:opacity-100"
      >
        <TrashIcon />
      </button>
    </Reorder.Item>
  );
}

const svg = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function GripIcon() {
  return (
    <svg {...svg} strokeWidth={2}>
      <circle cx="9" cy="6" r="0.6" fill="currentColor" />
      <circle cx="9" cy="12" r="0.6" fill="currentColor" />
      <circle cx="9" cy="18" r="0.6" fill="currentColor" />
      <circle cx="15" cy="6" r="0.6" fill="currentColor" />
      <circle cx="15" cy="12" r="0.6" fill="currentColor" />
      <circle cx="15" cy="18" r="0.6" fill="currentColor" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg {...svg}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg {...svg}>
      <path d="M3 3l18 18" />
      <path d="M10.6 6.2A9.6 9.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.3 4.1" />
      <path d="M6.3 7.5A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 4-.85" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg {...svg}>
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg {...svg} width={15} height={15}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return <svg {...svg}><path d="m15 18-6-6 6-6" /></svg>;
}

function ChevronRightIcon() {
  return <svg {...svg}><path d="m9 18 6-6-6-6" /></svg>;
}
