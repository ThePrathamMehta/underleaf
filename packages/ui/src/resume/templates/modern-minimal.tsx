"use client";

import type { ResumeContent } from "@repo/types";
import { ResumeHeader, SectionBody, SectionShell } from "../primitives";

/**
 * Modern Minimal — no rules, no uppercase headings, generous whitespace.
 * Distinguishes sections by space and weight alone, so it reads quietly.
 */
export function ModernMinimalTemplate({ content }: { content: ResumeContent }) {
  const visible = content.sections
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => section.visible)
    .sort((a, b) => a.section.order - b.section.order);

  return (
    <div className="rd-minimal">
      <ResumeHeader personalInfo={content.personalInfo} />
      {visible.map(({ section, index }) => (
        <SectionShell key={section.id} section={section} index={index} showRule={false}>
          <SectionBody section={section} index={index} />
        </SectionShell>
      ))}
    </div>
  );
}
