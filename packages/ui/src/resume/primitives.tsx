"use client";

import type {
  CertificationItem,
  CustomItem,
  EducationItem,
  ExperienceItem,
  PersonalInfo,
  ProjectItem,
  Section,
  SkillsItem,
  SummaryItem,
} from "@repo/types";
import { EditableLink, EditableText, useResumeEditing, type FieldPath } from "./editable";
import { htmlToPlainText, isBlankHtml } from "./rich-text";

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
  return (
    <section className="rd-section" data-section-id={section.id}>
      <EditableText
        as="h2"
        className="rd-section-title"
        value={section.title}
        path={["sections", index, "title"]}
        placeholder="Section title"
      />
      {showRule ? <div className="rd-rule" /> : null}
      {children}
    </section>
  );
}

export function Bullets({ bullets, basePath }: { bullets: string[]; basePath: FieldPath }) {
  if (bullets.length === 0) return null;
  return (
    <ul className="rd-bullets">
      {bullets.map((bullet, i) => (
        <EditableText
          key={i}
          as="li"
          className="rd-bullet"
          value={bullet}
          path={[...basePath, i]}
          placeholder="Describe an accomplishment"
          multiline
        />
      ))}
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

export function SummaryBody({ items, sectionIndex }: { items: SummaryItem[]; sectionIndex: number }) {
  return (
    <>
      {items.map((item, i) => (
        <EditableText
          key={item.id}
          as="p"
          className="rd-summary"
          value={item.text}
          path={["sections", sectionIndex, "items", i, "text"]}
          placeholder="A short professional summary"
          multiline
        />
      ))}
    </>
  );
}

export function ExperienceBody({ items, sectionIndex }: { items: ExperienceItem[]; sectionIndex: number }) {
  return (
    <>
      {items.map((item, i) => {
        const base: FieldPath = ["sections", sectionIndex, "items", i];
        return (
          <div className="rd-entry" key={item.id} data-item-id={item.id}>
            <div className="rd-entry-row">
              <EditableText className="rd-entry-primary" value={item.org} path={[...base, "org"]} placeholder="Company" />
              <EditableDateRange start={item.startDate} end={item.endDate} basePath={base} />
            </div>
            <div className="rd-entry-row">
              <EditableText className="rd-entry-secondary" value={item.role} path={[...base, "role"]} placeholder="Role" />
              <EditableText className="rd-entry-meta" value={item.location} path={[...base, "location"]} placeholder="Location" />
            </div>
            <Bullets bullets={item.bullets} basePath={[...base, "bullets"]} />
          </div>
        );
      })}
    </>
  );
}

export function EducationBody({ items, sectionIndex }: { items: EducationItem[]; sectionIndex: number }) {
  return (
    <>
      {items.map((item, i) => {
        const base: FieldPath = ["sections", sectionIndex, "items", i];
        return (
          <div className="rd-entry" key={item.id} data-item-id={item.id}>
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
            <Bullets bullets={item.bullets} basePath={[...base, "bullets"]} />
          </div>
        );
      })}
    </>
  );
}

export function SkillsBody({ items, sectionIndex }: { items: SkillsItem[]; sectionIndex: number }) {
  const editing = useResumeEditing();

  return (
    <>
      {items.map((item, i) => {
        const base: FieldPath = ["sections", sectionIndex, "items", i];
        return (
          <div className="rd-skill-row" key={item.id} data-item-id={item.id}>
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
      })}
    </>
  );
}

export function ProjectsBody({ items, sectionIndex }: { items: ProjectItem[]; sectionIndex: number }) {
  const editing = useResumeEditing();

  return (
    <>
      {items.map((item, i) => {
        const base: FieldPath = ["sections", sectionIndex, "items", i];
        return (
          <div className="rd-entry" key={item.id} data-item-id={item.id}>
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
            <Bullets bullets={item.bullets} basePath={[...base, "bullets"]} />
          </div>
        );
      })}
    </>
  );
}

export function CertificationsBody({ items, sectionIndex }: { items: CertificationItem[]; sectionIndex: number }) {
  const editing = useResumeEditing();

  return (
    <>
      {items.map((item, i) => {
        const base: FieldPath = ["sections", sectionIndex, "items", i];
        return (
          <div className="rd-entry" key={item.id} data-item-id={item.id}>
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
        );
      })}
    </>
  );
}

export function CustomBody({ items, sectionIndex }: { items: CustomItem[]; sectionIndex: number }) {
  const editing = useResumeEditing();

  return (
    <>
      {items.map((item, i) => {
        const base: FieldPath = ["sections", sectionIndex, "items", i];
        return (
          <div className="rd-entry" key={item.id} data-item-id={item.id}>
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
            <Bullets bullets={item.bullets} basePath={[...base, "bullets"]} />
          </div>
        );
      })}
    </>
  );
}

/**
 * Dispatches a section to the renderer for its type. Exhaustive over the
 * discriminated union, so adding a section type is a compile error until handled.
 */
export function SectionBody({ section, index }: { section: Section; index: number }) {
  switch (section.type) {
    case "summary":
      return <SummaryBody items={section.items} sectionIndex={index} />;
    case "experience":
      return <ExperienceBody items={section.items} sectionIndex={index} />;
    case "education":
      return <EducationBody items={section.items} sectionIndex={index} />;
    case "skills":
      return <SkillsBody items={section.items} sectionIndex={index} />;
    case "projects":
      return <ProjectsBody items={section.items} sectionIndex={index} />;
    case "certifications":
      return <CertificationsBody items={section.items} sectionIndex={index} />;
    case "custom":
      return <CustomBody items={section.items} sectionIndex={index} />;
  }
}
