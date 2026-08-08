"use client";

import type { ResumeContent, Theme } from "@repo/types";
import { splitSectionsIntoPages } from "@repo/types";
import { themeToCss, themeToCssVars } from "./resume-styles";
import { PageSlicesProvider } from "./primitives";
import type { PageLayout, SectionSlice } from "./paginate";
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
  /**
   * Measured pagination: one entry per sheet, each listing the slice of every
   * section that sheet shows.
   *
   * Omitted by callers that render the whole document in one flow — the
   * thumbnails, the template gallery, and the measuring pass that produces this
   * very value. Without it the renderer falls back to manual `pageBreakBefore`
   * splitting, which is what existed before content-driven pagination.
   */
  layout?: PageLayout[];
};

/**
 * The single resume renderer, imported by both the editor canvas and the
 * Puppeteer export. Any change here necessarily affects both, which is what
 * keeps the PDF identical to the screen.
 *
 * It carries its own stylesheet so it is self-contained: hand it a `(content,
 * theme)` pair and it renders correctly in any host page.
 *
 * Multi-page: a sheet is a fixed physical size, so content that outgrows one
 * continues on the next. Where those breaks fall is decided by `packBlocks`
 * from measured heights and arrives here as `layout`; each entry becomes its own
 * `.rd-page`. The template renders once per sheet with only that sheet's
 * sections marked visible and its slices in context — so templates need no page
 * awareness at all. Continuation sheets suppress the repeated name/contact
 * header via `data-page-index`, but do re-print section headings.
 *
 * With no `layout`, sections are grouped by `pageBreakBefore` alone, which is
 * how the thumbnails and the measuring pass itself render.
 */
export function ResumeDocument({ templateSlug, content, theme, fontFaces, layout }: ResumeDocumentProps) {
  const Template = TEMPLATES[baseTemplateSlug(templateSlug) as TemplateSlug] ?? JakesTemplate;
  const css = themeToCss(theme, { fontFaces });

  // Either source produces the same thing: for each sheet, which sections it
  // shows and — when measured — how much of each.
  const sheets: { ids: Set<string>; slices: ReadonlyMap<string, SectionSlice> | null }[] =
    layout && layout.length > 0
      ? layout.map((page) => ({
          ids: new Set(page.map((slice) => slice.sectionId)),
          slices: new Map(page.map((slice) => [slice.sectionId, slice])),
        }))
      : splitSectionsIntoPages(content).map((ids) => ({ ids: new Set(ids), slices: null }));

  return (
    // The theme rides on this element, not in the stylesheet: `.rd-root` is a
    // class, so several documents on one page (the gallery renders six) would
    // otherwise each overwrite the others' page size, fonts and type scale.
    <div className="rd-root" style={themeToCssVars(theme) as React.CSSProperties}>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      {sheets.map(({ ids, slices }, pageIndex) => {
        // Same content shape, but only this sheet's sections are visible. The
        // template's own `visible` filter then renders exactly this sheet, while
        // section indices (used by edit paths) stay pointing at the real array.
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
            <PageSlicesProvider value={slices}>
              <Template content={pageContent} />
            </PageSlicesProvider>
          </div>
        );
      })}
    </div>
  );
}
