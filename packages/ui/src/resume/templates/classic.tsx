"use client";

import type { ResumeContent } from "@repo/types";
import { ResumeHeader, SectionBody, SectionShell } from "../primitives";

/**
 * Classic Professional — centered header over a full-width rule, serif-leaning,
 * conventional. The safe choice for corporate and legal applications.
 */
export function ClassicTemplate({ content }: { content: ResumeContent }) {
  const visible = content.sections
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => section.visible)
    .sort((a, b) => a.section.order - b.section.order);

  return (
    <div className="rd-classic">
      <ResumeHeader personalInfo={content.personalInfo} centered />
      <div className="rd-header-divider" />
      {visible.map(({ section, index }) => (
        <SectionShell key={section.id} section={section} index={index}>
          <SectionBody section={section} index={index} />
        </SectionShell>
      ))}
    </div>
  );
}
