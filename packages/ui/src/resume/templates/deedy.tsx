"use client";

import type { ResumeContent, Section } from "@repo/types";
import { ResumeHeader, SectionBody, SectionShell } from "../primitives";

/**
 * Sidebar layout in the spirit of Deedy / Awesome-CV: a narrow left rail for
 * short factual sections, a wide main column for narrative ones.
 *
 * Original CSS — the reference layouts are LaTeX and licensed, so this borrows
 * the arrangement idea only, not any of their source.
 */

/** Section types that read well in a narrow rail. */
const SIDEBAR_TYPES = new Set(["skills", "education", "certifications"]);

export function DeedyTemplate({ content }: { content: ResumeContent }) {
  const visible = content.sections
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => section.visible)
    .sort((a, b) => a.section.order - b.section.order);

  const side = visible.filter(({ section }) => SIDEBAR_TYPES.has(section.type));
  const main = visible.filter(({ section }) => !SIDEBAR_TYPES.has(section.type));

  // With nothing to put in the rail, a two-column frame would leave an obvious
  // empty gutter — fall back to a single column instead.
  const columns = side.length > 0 && main.length > 0;

  return (
    <>
      <ResumeHeader personalInfo={content.personalInfo} />
      <div className="rd-header-divider" />

      {columns ? (
        <div className="rd-columns">
          <div className="rd-col-side">{side.map(renderSection)}</div>
          <div className="rd-col-main">{main.map(renderSection)}</div>
        </div>
      ) : (
        visible.map(renderSection)
      )}
    </>
  );
}

function renderSection({ section, index }: { section: Section; index: number }) {
  return (
    <SectionShell key={section.id} section={section} index={index} showRule={false}>
      <SectionBody section={section} index={index} />
    </SectionShell>
  );
}
