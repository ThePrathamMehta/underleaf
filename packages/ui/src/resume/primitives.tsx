"use client";

import type {
  CertificationItem,
  CustomItem,
  DividerItem,
  EducationItem,
  ExperienceItem,
  ImageItem,
  PersonalInfo,
  PlacedItem,
  ProjectItem,
  Section,
  SkillsItem,
  SummaryItem,
  TextItem,
} from "@repo/types";
import { isDividerItem, isImageItem, isTextItem } from "@repo/types";
import { createContext, useContext } from "react";
import { EditableLink, EditableText, useResumeEditing, type FieldPath } from "./editable";
import { htmlToPlainText, isBlankHtml } from "./rich-text";
import { BLOCK_ATTR, type BlockKind, type SectionSlice } from "./paginate";

/**
 * Which slice of each section the sheet being rendered should show.
 *
 * Absent when nobody has measured anything — the template gallery and the
 * thumbnails render whole sections, and the export's own measuring pass runs
 * against an unsliced document. In that case every body renders all its items,
 * which is exactly the behaviour that existed before pagination.
 */
const PageSlicesContext = createContext<ReadonlyMap<string, SectionSlice> | null>(null);

export const PageSlicesProvider = PageSlicesContext.Provider;

function usePageSlice(sectionId: string): SectionSlice | null {
  return useContext(PageSlicesContext)?.get(sectionId) ?? null;
}

/**
 * Attributes that make an element measurable by the pagination pass. The names
 * come from paginate.ts so the reader and the writer can't drift apart.
 */
function blockAttrs(
  kind: BlockKind,
  sectionId: string,
  itemIndex?: number,
  bulletIndex?: number,
): Record<string, string | number> {
  return {
    [BLOCK_ATTR.kind]: kind,
    [BLOCK_ATTR.section]: sectionId,
    ...(itemIndex === undefined ? {} : { [BLOCK_ATTR.item]: itemIndex }),
    ...(bulletIndex === undefined ? {} : { [BLOCK_ATTR.bullet]: bulletIndex }),
  };
}

/** One item as this sheet should render it. */
type RenderedItem<T> = {
  item: T;
  /** Index in the section's real `items` array — edit paths depend on it. */
  index: number;
  /** Whether the entry's heading rows render here. */
  head: boolean;
  /** Bullet range to render, or null for all of them. */
  range: [number, number] | null;
};

/**
 * The items this sheet shows for a section, in render order.
 *
 * `index` is always the item's position in the real content array, never its
 * position on the sheet — editing a bullet that landed on sheet 2 has to write
 * back to that same bullet, and the edit path is built from this index.
 */
function usePageItems<T>(sectionId: string, items: T[]): RenderedItem<T>[] {
  const slice = usePageSlice(sectionId);
  if (!slice) return items.map((item, index) => ({ item, index, head: true, range: null }));

  return slice.items.flatMap((entry) => {
    const item = items[entry.itemIndex];
    return item === undefined
      ? []
      : [{ item, index: entry.itemIndex, head: entry.head, range: entry.bullets }];
  });
}

/** Joins a date range, tolerating either side being blank. */
function dateRange(start: string, end: string): string {
  if (start && end) return `${start} – ${end}`;
  return start || end;
}

/**
 * The date column of an entry.
 *
 * Printed as a single joined run so a half-filled range doesn't leave a dangling
 * dash, but edited as its two real fields — previously this rendered as static
 * text, which left no way to change an entry's dates at all.
 */
function EditableDateRange({
  start,
  end,
  basePath,
  startKey = "startDate",
  endKey = "endDate",
}: {
  start: string;
  end: string;
  basePath: FieldPath;
  startKey?: string;
  endKey?: string;
}) {
  const editing = useResumeEditing();

  if (!editing) {
    return <span className="rd-entry-meta">{dateRange(htmlToPlainText(start), htmlToPlainText(end))}</span>;
  }

  // Both halves always render while editing, so an empty one still offers a
  // placeholder to click into.
  return (
    <span className="rd-entry-meta rd-date-range">
      <EditableText value={start} path={[...basePath, startKey]} placeholder="Start" rich={false} />
      <span className="rd-date-sep"> – </span>
      <EditableText value={end} path={[...basePath, endKey]} placeholder="End" rich={false} />
    </span>
  );
}

export function SectionShell({
  section,
  index,
  showRule = true,
  children,
}: {
  section: Section;
  index: number;
  showRule?: boolean;
  children: React.ReactNode;
}) {
  const slice = usePageSlice(section.id);

  return (
    <section
      className="rd-section"
      data-section-id={section.id}
      // Marks a sheet that re-prints a heading shown earlier, so the reader
      // knows what these entries belong to.
      data-continued={slice?.continued ? "" : undefined}
    >
      {/* Title and rule are one measurable unit: a heading that can't keep at
          least one entry with it has to move to the next sheet whole. */}
      <div className="rd-section-head" {...blockAttrs("heading", section.id)}>
        <EditableText
          as="h2"
          className="rd-section-title"
          value={section.title}
          path={["sections", index, "title"]}
          placeholder="Section title"
        />
        {showRule ? <div className="rd-rule" /> : null}
      </div>
      {children}
    </section>
  );
}

export function Bullets({
  bullets,
  basePath,
  sectionId,
  itemIndex,
  range,
}: {
  bullets: string[];
  basePath: FieldPath;
  sectionId: string;
  itemIndex: number;
  /** Half-open slice of `bullets` to render; null renders all of them. */
  range?: [number, number] | null;
}) {
  const [start, end] = range ?? [0, bullets.length];
  const shown = bullets.slice(start, end);
  if (shown.length === 0) return null;

  return (
    <ul className="rd-bullets">
      {shown.map((bullet, offset) => {
        const i = start + offset;
        return (
          <EditableText
            key={i}
            as="li"
            className="rd-bullet"
            value={bullet}
            path={[...basePath, i]}
            placeholder="Describe an accomplishment"
            multiline
            blockAttrs={blockAttrs("bullet", sectionId, itemIndex, i)}
          />
        );
      })}
    </ul>
  );
}

export function ResumeHeader({
  personalInfo,
  centered = false,
}: {
  personalInfo: PersonalInfo;
  centered?: boolean;
}) {
  const editing = useResumeEditing();
  const { name, title, email, phone, location, links } = personalInfo;
  const contactItems: React.ReactNode[] = [];

  // While editing, a blank contact field still renders so there's a placeholder
  // to click into; in print it's simply absent.
  if (editing || !isBlankHtml(email)) {
    contactItems.push(
      <EditableText key="email" value={email} path={["personalInfo", "email"]} placeholder="Email" />,
    );
  }
  if (editing || !isBlankHtml(phone)) {
    contactItems.push(
      <EditableText key="phone" value={phone} path={["personalInfo", "phone"]} placeholder="Phone" />,
    );
  }
  if (editing || !isBlankHtml(location)) {
    contactItems.push(
      <EditableText key="location" value={location} path={["personalInfo", "location"]} placeholder="Location" />,
    );
  }

  links.forEach((link, i) => {
    contactItems.push(
      <EditableLink
        key={link.id}
        className="rd-link"
        value={link.label}
        url={link.url}
        path={["personalInfo", "links", i, "label"]}
      />,
    );
  });

  return (
    <header className={centered ? "rd-center" : undefined}>
      <EditableText
        as="h1"
        className="rd-name"
        value={name}
        path={["personalInfo", "name"]}
        placeholder="Your name"
      />
      {editing || !isBlankHtml(title) ? (
        <EditableText
          as="div"
          className="rd-role"
          value={title}
          path={["personalInfo", "title"]}
          placeholder="Your title"
        />
      ) : null}
      <div className="rd-contact">
        {contactItems.map((item, i) => (
          <span key={i}>
            {item}
            {i < contactItems.length - 1 ? <span className="rd-contact-sep"> · </span> : null}
          </span>
        ))}
      </div>
    </header>
  );
}

// --- Per-type item renderers ---

/** Props every section body takes; `sectionId` keys its page slice. */
type BodyProps<T> = { items: T[]; sectionIndex: number; sectionId: string };

/**
 * A free text block: prose the user placed between entries.
 *
 * A block-level `EditableText` and nothing else, which is the point — it inherits
 * the whole editing surface the rest of the document already has, so the
 * selection toolbar's bold, italic, colour and link work inside it with no extra
 * wiring, and the exported PDF renders it through the same component.
 *
 * It renders even when blank, unlike the blank inline optionals elsewhere. The
 * measuring mirror renders print form, and a block missing from the measurement
 * gets no page slice — which would make a freshly added, still-empty block
 * invisible on the canvas.
 */
function TextBlock({
  item,
  sectionIndex,
  sectionId,
  itemIndex,
}: {
  item: TextItem;
  sectionIndex: number;
  sectionId: string;
  itemIndex: number;
}) {
  return (
    <EditableText
      as="p"
      className="rd-text-block"
      value={item.text}
      path={["sections", sectionIndex, "items", itemIndex, "text"]}
      placeholder="Write anything here"
      multiline
      // `data-item-id` is what puts the canvas's per-item controls on this block,
      // so it can be moved and removed like any other entry.
      blockAttrs={{ ...blockAttrs("entry", sectionId, itemIndex), "data-item-id": item.id }}
    />
  );
}

/**
 * An image the user placed between entries.
 *
 * Width is a percentage of the column, so the same item reads correctly in Jake's
 * full-width column and in a Deedy sidebar a third as wide. Height is left to the
 * intrinsic aspect ratio: a resume image is a headshot, a logo or a QR code, and
 * all three look wrong stretched.
 *
 * Renders a placeholder frame while `src` is empty. That is the state between the
 * user picking a file and the upload finishing, and an item that only appears once
 * the bytes land would leave the click that inserted it looking like it failed.
 */
function ImageBlock({
  item,
  sectionId,
  itemIndex,
}: {
  item: ImageItem;
  sectionId: string;
  itemIndex: number;
}) {
  const width = `${item.widthPercent ?? 40}%`;

  return (
    <div
      className="rd-item-image"
      data-align={item.align ?? "left"}
      data-item-id={item.id}
      // Carried on the wrapper rather than the <img>, so the pagination pass
      // measures the space the image occupies including its own margins.
      {...blockAttrs("entry", sectionId, itemIndex)}
    >
      {item.src ? (
        // A plain <img> on purpose: this is a print renderer, and next/image needs
        // a layout server and emits a wrapper Puppeteer can't size. (No disable
        // directive — `@next/next/no-img-element` isn't part of this package's
        // config, so naming it here is itself a lint warning.)
        <img src={item.src} alt={item.alt ?? ""} style={{ width }} draggable={false} />
      ) : (
        <div className="rd-item-image-empty" style={{ width }} aria-hidden />
      )}
    </div>
  );
}

/**
 * A horizontal rule between entries.
 *
 * The line is a `.rd-rule` — the very element that sits under a section heading —
 * so one inserted into Jake's matches the rules already on that page, and one
 * inserted into Classic picks up that template's heavier line for free.
 */
function DividerBlock({ item, sectionId, itemIndex }: { item: DividerItem; sectionId: string; itemIndex: number }) {
  return (
    <div
      className="rd-item-divider"
      data-item-id={item.id}
      {...blockAttrs("entry", sectionId, itemIndex)}
    >
      <div className="rd-rule" />
    </div>
  );
}

/**
 * The shared shape of every section body: takes the items this sheet shows,
 * renders any placed blocks itself, and hands the section's own entries back to
 * the caller.
 *
 * Written once rather than seven times — a note, an image and a rule each look the
 * same wherever they sit, and only the entries around them differ by section type.
 *
 * Callers name their entry type explicitly. Inferring it from a union argument
 * works, but only by subtraction, and the two tsconfigs in this repo don't agree
 * on the result; being explicit costs one word per call site and can't drift.
 */
function SectionItems<E>({
  items,
  sectionIndex,
  sectionId,
  children,
}: {
  items: (E | PlacedItem)[];
  sectionIndex: number;
  sectionId: string;
  children: (rendered: RenderedItem<E>) => React.ReactNode;
}) {
  const rendered = usePageItems(sectionId, items);

  return (
    <>
      {rendered.map((entry) => {
        // Narrowing `entry.item` doesn't narrow `entry` itself, so each branch
        // restates once what its guard already established.
        if (isTextItem(entry.item)) {
          return (
            <TextBlock
              key={entry.item.id}
              item={entry.item}
              sectionIndex={sectionIndex}
              sectionId={sectionId}
              itemIndex={entry.index}
            />
          );
        }
        if (isImageItem(entry.item)) {
          return (
            <ImageBlock
              key={entry.item.id}
              item={entry.item}
              sectionId={sectionId}
              itemIndex={entry.index}
            />
          );
        }
        if (isDividerItem(entry.item)) {
          return (
            <DividerBlock
              key={entry.item.id}
              item={entry.item}
              sectionId={sectionId}
              itemIndex={entry.index}
            />
          );
        }
        return children(entry as RenderedItem<E>);
      })}
    </>
  );
}

export function SummaryBody({ items, sectionIndex, sectionId }: BodyProps<SummaryItem | PlacedItem>) {
  return (
    <SectionItems<SummaryItem> items={items} sectionIndex={sectionIndex} sectionId={sectionId}>
      {({ item, index: i }) => (
        <EditableText
          key={item.id}
          as="p"
          className="rd-summary"
          value={item.text}
          path={["sections", sectionIndex, "items", i, "text"]}
          placeholder="A short professional summary"
          multiline
          blockAttrs={blockAttrs("entry", sectionId, i)}
        />
      )}
    </SectionItems>
  );
}

export function ExperienceBody({ items, sectionIndex, sectionId }: BodyProps<ExperienceItem | PlacedItem>) {
  return (
    <SectionItems<ExperienceItem> items={items} sectionIndex={sectionIndex} sectionId={sectionId}>
      {({ item, index: i, head, range }) => {
        const base: FieldPath = ["sections", sectionIndex, "items", i];
        return (
          <div className="rd-entry" key={item.id} data-item-id={item.id} data-continued={head ? undefined : ""}>
            {head ? (
              <div className="rd-entry-head" {...blockAttrs("entry", sectionId, i)}>
                <div className="rd-entry-row">
                  <EditableText className="rd-entry-primary" value={item.org} path={[...base, "org"]} placeholder="Company" />
                  <EditableDateRange start={item.startDate} end={item.endDate} basePath={base} />
                </div>
                <div className="rd-entry-row">
                  <EditableText className="rd-entry-secondary" value={item.role} path={[...base, "role"]} placeholder="Role" />
                  <EditableText className="rd-entry-meta" value={item.location} path={[...base, "location"]} placeholder="Location" />
                </div>
              </div>
            ) : null}
            <Bullets bullets={item.bullets} basePath={[...base, "bullets"]} sectionId={sectionId} itemIndex={i} range={range} />
          </div>
        );
      }}
    </SectionItems>
  );
}

export function EducationBody({ items, sectionIndex, sectionId }: BodyProps<EducationItem | PlacedItem>) {
  return (
    <SectionItems<EducationItem> items={items} sectionIndex={sectionIndex} sectionId={sectionId}>
      {({ item, index: i, head, range }) => {
        const base: FieldPath = ["sections", sectionIndex, "items", i];
        return (
          <div className="rd-entry" key={item.id} data-item-id={item.id} data-continued={head ? undefined : ""}>
            {head ? (
              <div className="rd-entry-head" {...blockAttrs("entry", sectionId, i)}>
                <div className="rd-entry-row">
                  <EditableText
                    className="rd-entry-primary"
                    value={item.institution}
                    path={[...base, "institution"]}
                    placeholder="Institution"
                  />
                  <EditableDateRange start={item.startDate} end={item.endDate} basePath={base} />
                </div>
                <div className="rd-entry-row">
                  <EditableText className="rd-entry-secondary" value={item.degree} path={[...base, "degree"]} placeholder="Degree" />
                  <EditableText className="rd-entry-meta" value={item.location} path={[...base, "location"]} placeholder="Location" />
                </div>
              </div>
            ) : null}
            <Bullets bullets={item.bullets} basePath={[...base, "bullets"]} sectionId={sectionId} itemIndex={i} range={range} />
          </div>
        );
      }}
    </SectionItems>
  );
}

export function SkillsBody({ items, sectionIndex, sectionId }: BodyProps<SkillsItem | PlacedItem>) {
  const editing = useResumeEditing();

  return (
    <SectionItems<SkillsItem> items={items} sectionIndex={sectionIndex} sectionId={sectionId}>
      {({ item, index: i }) => {
        const base: FieldPath = ["sections", sectionIndex, "items", i];
        return (
          <div className="rd-skill-row" key={item.id} data-item-id={item.id} {...blockAttrs("entry", sectionId, i)}>
            {editing || !isBlankHtml(item.category) ? (
              <>
                <EditableText className="rd-skill-label" value={item.category} path={[...base, "category"]} placeholder="Category" />
                <span>: </span>
              </>
            ) : null}
            {/*
              Stored as an array and shown as one comma-separated field, so this
              one field stays plain text — inline markup would be chopped up by
              the reducer's comma split.
            */}
            <EditableText
              value={item.skills.join(", ")}
              path={[...base, "skills"]}
              placeholder="Comma-separated skills"
              rich={false}
            />
          </div>
        );
      }}
    </SectionItems>
  );
}

export function ProjectsBody({ items, sectionIndex, sectionId }: BodyProps<ProjectItem | PlacedItem>) {
  const editing = useResumeEditing();

  return (
    <SectionItems<ProjectItem> items={items} sectionIndex={sectionIndex} sectionId={sectionId}>
      {({ item, index: i, head, range }) => {
        const base: FieldPath = ["sections", sectionIndex, "items", i];
        return (
          <div className="rd-entry" key={item.id} data-item-id={item.id} data-continued={head ? undefined : ""}>
            {head ? (
              <div className="rd-entry-head" {...blockAttrs("entry", sectionId, i)}>
                <div className="rd-entry-row">
                  <span>
                    <EditableText className="rd-entry-primary" value={item.name} path={[...base, "name"]} placeholder="Project" />
                    {editing || !isBlankHtml(item.tech) ? (
                      <>
                        <span className="rd-entry-divider"> | </span>
                        <EditableText className="rd-entry-secondary" value={item.tech} path={[...base, "tech"]} placeholder="Tech used" />
                      </>
                    ) : null}
                  </span>
                  <EditableDateRange start={item.startDate} end={item.endDate} basePath={base} />
                </div>
              </div>
            ) : null}
            <Bullets bullets={item.bullets} basePath={[...base, "bullets"]} sectionId={sectionId} itemIndex={i} range={range} />
          </div>
        );
      }}
    </SectionItems>
  );
}

export function CertificationsBody({ items, sectionIndex, sectionId }: BodyProps<CertificationItem | PlacedItem>) {
  const editing = useResumeEditing();

  return (
    <SectionItems<CertificationItem> items={items} sectionIndex={sectionIndex} sectionId={sectionId}>
      {({ item, index: i }) => {
        const base: FieldPath = ["sections", sectionIndex, "items", i];
        return (
          <div className="rd-entry" key={item.id} data-item-id={item.id}>
            <div className="rd-entry-head" {...blockAttrs("entry", sectionId, i)}>
              <div className="rd-entry-row">
                <span>
                  <EditableText className="rd-entry-primary" value={item.name} path={[...base, "name"]} placeholder="Certification" />
                  {editing || !isBlankHtml(item.issuer) ? (
                    <>
                      <span className="rd-entry-divider"> — </span>
                      <EditableText className="rd-entry-secondary" value={item.issuer} path={[...base, "issuer"]} placeholder="Issuer" />
                    </>
                  ) : null}
                </span>
                <EditableText className="rd-entry-meta" value={item.date} path={[...base, "date"]} placeholder="Year" rich={false} />
              </div>
            </div>
          </div>
        );
      }}
    </SectionItems>
  );
}

export function CustomBody({ items, sectionIndex, sectionId }: BodyProps<CustomItem | PlacedItem>) {
  const editing = useResumeEditing();

  return (
    <SectionItems<CustomItem> items={items} sectionIndex={sectionIndex} sectionId={sectionId}>
      {({ item, index: i, head, range }) => {
        const base: FieldPath = ["sections", sectionIndex, "items", i];
        return (
          <div className="rd-entry" key={item.id} data-item-id={item.id} data-continued={head ? undefined : ""}>
            {head ? (
              <div className="rd-entry-head" {...blockAttrs("entry", sectionId, i)}>
                <div className="rd-entry-row">
                  <EditableText className="rd-entry-primary" value={item.heading} path={[...base, "heading"]} placeholder="Heading" />
                  <EditableText className="rd-entry-meta" value={item.dateRange} path={[...base, "dateRange"]} placeholder="Dates" rich={false} />
                </div>
                {editing || !isBlankHtml(item.subheading) ? (
                  <EditableText
                    as="div"
                    className="rd-entry-secondary"
                    value={item.subheading}
                    path={[...base, "subheading"]}
                    placeholder="Subheading"
                  />
                ) : null}
              </div>
            ) : null}
            <Bullets bullets={item.bullets} basePath={[...base, "bullets"]} sectionId={sectionId} itemIndex={i} range={range} />
          </div>
        );
      }}
    </SectionItems>
  );
}

/**
 * Dispatches a section to the renderer for its type. Exhaustive over the
 * discriminated union, so adding a section type is a compile error until handled.
 */
export function SectionBody({ section, index }: { section: Section; index: number }) {
  switch (section.type) {
    case "summary":
      return <SummaryBody items={section.items} sectionIndex={index} sectionId={section.id} />;
    case "experience":
      return <ExperienceBody items={section.items} sectionIndex={index} sectionId={section.id} />;
    case "education":
      return <EducationBody items={section.items} sectionIndex={index} sectionId={section.id} />;
    case "skills":
      return <SkillsBody items={section.items} sectionIndex={index} sectionId={section.id} />;
    case "projects":
      return <ProjectsBody items={section.items} sectionIndex={index} sectionId={section.id} />;
    case "certifications":
      return <CertificationsBody items={section.items} sectionIndex={index} sectionId={section.id} />;
    case "custom":
      return <CustomBody items={section.items} sectionIndex={index} sectionId={section.id} />;
  }
}
