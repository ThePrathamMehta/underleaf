"use client";

import type { ResumeContent, Theme } from "@repo/types";
import { themeToCss } from "./resume-styles";
import { JakesTemplate } from "./templates/jakes";
import { DeedyTemplate } from "./templates/deedy";
import { ModernMinimalTemplate } from "./templates/modern-minimal";
import { ClassicTemplate } from "./templates/classic";
import { CreativeTemplate } from "./templates/creative";

// Re-exported so consumers have one import specifier for the whole renderer.
export { ResumeEditingProvider, useResumeEditing } from "./editable";
export type { FieldPath } from "./editable";

export type TemplateSlug =
  | "jakes"
  | "deedy"
  | "modern-minimal"
  | "classic"
  | "creative";

const TEMPLATES: Record<TemplateSlug, (props: { content: ResumeContent }) => React.ReactNode> = {
  jakes: JakesTemplate,
  deedy: DeedyTemplate,
  "modern-minimal": ModernMinimalTemplate,
  classic: ClassicTemplate,
  creative: CreativeTemplate,
};

export type ResumeDocumentProps = {
  templateSlug: string;
  content: ResumeContent;
  theme: Theme;
  /**
   * Inline `@font-face` blocks with base64 font data. Supplied only by the PDF
   * export path — `page.setContent()` has no origin, so relative font URLs
   * cannot resolve there. In the browser, `next/font` has already loaded them.
   */
  fontFaces?: string;
};

/**
 * The single resume renderer, imported by both the editor canvas and the
 * Puppeteer export. Any change here necessarily affects both, which is what
 * keeps the PDF identical to the screen.
 *
 * It carries its own stylesheet so it is self-contained: hand it a `(content,
 * theme)` pair and it renders correctly in any host page.
 */
export function ResumeDocument({ templateSlug, content, theme, fontFaces }: ResumeDocumentProps) {
  const Template = TEMPLATES[templateSlug as TemplateSlug] ?? JakesTemplate;
  const css = themeToCss(theme, { fontFaces });

  return (
    <div className="rd-root">
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="rd-page" data-page-size={theme.pageSize}>
        <Template content={content} />
      </div>
    </div>
  );
}
