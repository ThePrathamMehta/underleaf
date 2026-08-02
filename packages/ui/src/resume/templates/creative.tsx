"use client";

import type { ResumeContent } from "@repo/types";
import { ResumeHeader, SectionBody, SectionShell } from "../primitives";

/**
 * Creative — a colored header band bleeding to the page edge, with an otherwise
 * conventional body. The one splash of color a design or marketing resume can
 * carry without becoming hard to skim.
 */
export function CreativeTemplate({ content }: { content: ResumeContent }) {
  const visible = content.sections
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => section.visible)
    .sort((a, b) => a.section.order - b.section.order);

  return (
    <div className="rd-creative">
      <div className="rd-band">
        <ResumeHeader personalInfo={content.personalInfo} />
      </div>
      {visible.map(({ section, index }) => (
        <SectionShell key={section.id} section={section} index={index} showRule={false}>
          <SectionBody section={section} index={index} />
        </SectionShell>
      ))}
    </div>
  );
}
