"use client";

import type { FreeformBlock, ResumeContent } from "@repo/types";
import { orderedFreeformBlocks } from "@repo/types";
import { EditableText } from "../editable";

/**
 * The blank canvas: a sheet with no imposed structure, holding absolutely
 * positioned blocks the user placed themselves.
 *
 * This is the one template that does not render `content.sections`, because it is
 * not a flow document. There are no measured page breaks to honour and no
 * section rhythm to keep — every block already says where it goes, so the
 * pagination pipeline is bypassed entirely and each block simply lands on the
 * sheet whose index it names.
 *
 * Coordinates are millimetres from the sheet's own top-left corner, *not* from
 * inside the theme margin: on a canvas the user decides where the margin is, and
 * anchoring to the padding box would silently shift every block if they later
 * changed `marginSize`. The pre-placed name heading supplies its own inset (see
 * `createBlankCanvasContent`).
 *
 * Millimetres, because that is the renderer's unit throughout — the same numbers
 * describe the screen, the thumbnail and the PDF with no DPI conversion anywhere.
 */
export function BlankTemplate({
  content,
  pageIndex = 0,
}: {
  content: ResumeContent;
  pageIndex?: number;
}) {
  const blocks = content.freeformBlocks ?? [];
  // Reading order, so the PDF's text comes out of an extractor top-to-bottom
  // rather than in the order the user happened to type — an ATS reads the
  // content stream, and insertion order would scramble a two-column canvas.
  const ordered = orderedFreeformBlocks(blocks);
  // Edit paths address the real array, so the sorted-and-filtered view has to
  // carry each block's original index with it.
  const indexById = new Map(blocks.map((block, index) => [block.id, index]));

  return (
    <div className="rd-free-layer" data-free-page={pageIndex}>
      {ordered
        .filter((block) => (block.page ?? 0) === pageIndex)
        .map((block) => (
          <FreeformBlockView
            key={block.id}
            block={block}
            index={indexById.get(block.id) ?? 0}
            // The topmost heading is the one the export filename reads as the
            // person's name (see `getExportFilename`), so it is the one that
            // prompts for it.
            isName={block.id === ordered.find((candidate) => candidate.type === "heading")?.id}
          />
        ))}
    </div>
  );
}

/** `12.5` → `"12.5mm"`. */
function mm(value: number): string {
  return `${value}mm`;
}

/**
 * Geometry and typography for one block, as inline style.
 *
 * Inline rather than CSS because every value is per-block data.
 *
 * Height means two different things by design. For text the dragged height is a
 * floor (`minHeight`): a box grows downward as it fills, the way Word's "resize
 * shape to fit text" does, because the alternative is a box that quietly hides
 * the words someone is still writing. For an image or a divider it is exact — the
 * frame *is* the content there, and an image needs a resolved height to fit
 * itself into.
 *
 * Type sizes are absolute points and deliberately not multiplied by
 * `theme.fontSizeScale`: on a canvas the user set 22pt by hand, so 22pt is what
 * they get.
 */
function blockStyle(block: FreeformBlock): React.CSSProperties {
  const style = block.style ?? {};
  const size = block.size;
  const exactHeight = block.type === "image" || block.type === "divider";

  return {
    left: mm(block.position.x),
    top: mm(block.position.y),
    ...(size
      ? {
          width: mm(size.width),
          ...(exactHeight ? { height: mm(size.height) } : { minHeight: mm(size.height) }),
        }
      : {}),
    ...(style.fontSize ? { fontSize: `${style.fontSize}pt` } : {}),
    ...(style.fontWeight ? { fontWeight: style.fontWeight } : {}),
    ...(style.textAlign ? { textAlign: style.textAlign } : {}),
    ...(style.color ? { color: style.color } : {}),
  };
}

/**
 * The widths a block gets when it carries no explicit size — a block created by
 * a bare click, before anyone has dragged its handles.
 *
 * Text needs a wrap width or a long line would run off the sheet; a divider
 * needs a length to be visible at all. Heights are left to the content.
 */
const DEFAULT_WIDTH_MM: Record<FreeformBlock["type"], number | undefined> = {
  heading: 120,
  text: 90,
  image: 60,
  divider: 90,
};

/**
 * Image sources a block may name.
 *
 * Uploaded images are served from the API behind an ownership check, so the
 * stored value is a URL rather than the bytes — `content` is capped at rich-text
 * length precisely so a base64 payload can't be smuggled into the document JSON
 * and re-sent on every autosave. Anything that isn't a plain image reference is
 * dropped: a `javascript:` src is inert in an `<img>`, but this content also
 * renders in the PDF process, and narrowing it here means one fewer sink to
 * reason about.
 */
function imageSrc(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^data:image\/(png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=]+$/i.test(value)) return value;
  // App-relative, as the upload route returns. Protocol-relative `//host` is not
  // that, and would reach out to another origin.
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  return null;
}

function FreeformBlockView({
  block,
  index,
  isName,
}: {
  block: FreeformBlock;
  index: number;
  isName: boolean;
}) {
  const style = blockStyle(block);
  if (!block.size && DEFAULT_WIDTH_MM[block.type]) {
    style.width = mm(DEFAULT_WIDTH_MM[block.type]!);
  }

  return (
    <div
      className="rd-free-block"
      style={style}
      // What the canvas hit-tests, drags and resizes. The id addresses the block
      // and the index addresses its edit path, so neither has to be recomputed
      // from a DOM position.
      data-free-block={block.id}
      data-free-index={index}
      data-free-type={block.type}
    >
      <FreeformBlockBody block={block} index={index} isName={isName} />
    </div>
  );
}

function FreeformBlockBody({
  block,
  index,
  isName,
}: {
  block: FreeformBlock;
  index: number;
  isName: boolean;
}) {
  if (block.type === "divider") {
    // Drawn inside the block rather than being the block: the rule is a hairline,
    // and a hairline-tall box is impossible to grab or click.
    return <div className="rd-free-rule" aria-hidden />;
  }

  if (block.type === "image") {
    const src = imageSrc(block.content);
    // A placeholder rather than a broken image: an image block exists for a
    // moment before its upload finishes, and again if the upload failed.
    if (!src) return <div className="rd-free-image-empty" aria-hidden />;
    // A plain <img>, as everywhere else in the renderer — see primitives.tsx.
    return <img className="rd-free-image" src={src} alt="" />;
  }

  return (
    <EditableText
      as="div"
      className={block.type === "heading" ? "rd-free-heading" : "rd-free-text"}
      value={block.content}
      path={["freeformBlocks", index, "content"]}
      placeholder={block.type === "heading" ? (isName ? "Your Name" : "Heading") : "Type here"}
      // A heading is one line by design; a text box is a place to write, and
      // Enter inside it should make a new line rather than end the edit.
      multiline={block.type !== "heading"}
    />
  );
}
