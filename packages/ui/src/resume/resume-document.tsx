"use client";

import type { ResumeContent, Theme } from "@repo/types";
import { splitSectionsIntoPages } from "@repo/types";
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

/**
 * Separates a variant slug from the structural layout it restyles, as in
 * `classic--garamond`.
 *
 * Profession curation needs 5–7 templates each, which is more gallery items
 * than there are distinct layouts. A variant is a real `Template` row with its
 * own theme, name and description — but it reuses one of the five components
 * above, because what differs is the theme, not the structure.
 *
 * Resolving by convention rather than registering each variant keeps this file
 * a list of layouts that actually exist. Seeding a new variant needs no change
 * here, and a variant of a layout that was removed still degrades to the same
 * default an unknown slug always has.
 */
const VARIANT_SEPARATOR = "--";

/** The structural layout a slug renders as, variant or not. */
export function baseTemplateSlug(slug: string): string {
  return slug.split(VARIANT_SEPARATOR)[0] ?? slug;
}

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
 *
 * Multi-page: sections are grouped into pages by `pageBreakBefore` markers, and
 * each page is rendered as its own `.rd-page` sheet. The template renders once
 * per page with only that page's sections marked visible — so templates need no
 * page awareness, and a resume with no breaks renders as one page exactly as
 * before. Continuation pages suppress the repeated header via `data-page-index`.
 */
export function ResumeDocument({ templateSlug, content, theme, fontFaces }: ResumeDocumentProps) {
  const Template = TEMPLATES[baseTemplateSlug(templateSlug) as TemplateSlug] ?? JakesTemplate;
  const css = themeToCss(theme, { fontFaces });
  const pages = splitSectionsIntoPages(content);

  return (
    <div className="rd-root">
      <style dangerouslySetInnerHTML={{ __html: css }} />
      {pages.map((sectionIds, pageIndex) => {
        // Same content shape, but only this page's sections are visible. The
        // template's own `visible` filter then renders exactly this page, while
        // section indices (used by edit paths) stay pointing at the real array.
        const ids = new Set(sectionIds);
        const pageContent: ResumeContent = {
          ...content,
          sections: content.sections.map((section) => ({
            ...section,
            visible: section.visible && ids.has(section.id),
          })),
        };

        return (
          <div
            key={pageIndex}
            className="rd-page"
            data-page-size={theme.pageSize}
            data-page-index={pageIndex}
          >
            <Template content={pageContent} />
          </div>
        );
      })}
    </div>
  );
}
