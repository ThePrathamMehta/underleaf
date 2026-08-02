"use client";

import type { ResumeContent } from "@repo/types";
import { ResumeHeader, SectionBody, SectionShell } from "../primitives";

/**
 * "Jake's Resume" — the single-column, ATS-friendly software engineering
 * standard. Ruled section headings, right-aligned dates, tight spacing.
 *
 * Layout structure only; no content is hardcoded, so this renders any resume.
 */
export function JakesTemplate({ content }: { content: ResumeContent }) {
  const visible = content.sections
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => section.visible)
    .sort((a, b) => a.section.order - b.section.order);

  return (
    <>
      <ResumeHeader personalInfo={content.personalInfo} centered />
      {visible.map(({ section, index }) => (
        <SectionShell key={section.id} section={section} index={index}>
          <SectionBody section={section} index={index} />
        </SectionShell>
      ))}
    </>
  );
}
