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
import { EditableLink, EditableText, type FieldPath } from "./editable";

/** Joins a date range, tolerating either side being blank. */
function dateRange(start: string, end: string): string {
  if (start && end) return `${start} – ${end}`;
  return start || end;
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
  const { name, title, email, phone, location, links } = personalInfo;
  const contactItems: React.ReactNode[] = [];

  if (email) {
    contactItems.push(
      <EditableText key="email" value={email} path={["personalInfo", "email"]} placeholder="Email" />,
    );
  }
  if (phone) {
    contactItems.push(
      <EditableText key="phone" value={phone} path={["personalInfo", "phone"]} placeholder="Phone" />,
    );
  }
  if (location) {
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
      {title ? (
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
              <span className="rd-entry-meta">{dateRange(item.startDate, item.endDate)}</span>
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
              <span className="rd-entry-meta">{dateRange(item.startDate, item.endDate)}</span>
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
  return (
    <>
      {items.map((item, i) => {
        const base: FieldPath = ["sections", sectionIndex, "items", i];
        return (
          <div className="rd-skill-row" key={item.id} data-item-id={item.id}>
            {item.category ? (
              <>
                <EditableText className="rd-skill-label" value={item.category} path={[...base, "category"]} placeholder="Category" />
                <span>: </span>
              </>
            ) : null}
            <EditableText
              value={item.skills.join(", ")}
              path={[...base, "skills"]}
              placeholder="Comma-separated skills"
            />
          </div>
        );
      })}
    </>
  );
}

export function ProjectsBody({ items, sectionIndex }: { items: ProjectItem[]; sectionIndex: number }) {
  return (
    <>
      {items.map((item, i) => {
        const base: FieldPath = ["sections", sectionIndex, "items", i];
        return (
          <div className="rd-entry" key={item.id} data-item-id={item.id}>
            <div className="rd-entry-row">
              <span>
                <EditableText className="rd-entry-primary" value={item.name} path={[...base, "name"]} placeholder="Project" />
                {item.tech ? (
                  <>
                    <span> | </span>
                    <EditableText className="rd-entry-secondary" value={item.tech} path={[...base, "tech"]} placeholder="Tech used" />
                  </>
                ) : null}
              </span>
              <span className="rd-entry-meta">{dateRange(item.startDate, item.endDate)}</span>
            </div>
            <Bullets bullets={item.bullets} basePath={[...base, "bullets"]} />
          </div>
        );
      })}
    </>
  );
}

export function CertificationsBody({ items, sectionIndex }: { items: CertificationItem[]; sectionIndex: number }) {
  return (
    <>
      {items.map((item, i) => {
        const base: FieldPath = ["sections", sectionIndex, "items", i];
        return (
          <div className="rd-entry" key={item.id} data-item-id={item.id}>
            <div className="rd-entry-row">
              <span>
                <EditableText className="rd-entry-primary" value={item.name} path={[...base, "name"]} placeholder="Certification" />
                {item.issuer ? (
                  <>
                    <span> — </span>
                    <EditableText className="rd-entry-secondary" value={item.issuer} path={[...base, "issuer"]} placeholder="Issuer" />
                  </>
                ) : null}
              </span>
              <EditableText className="rd-entry-meta" value={item.date} path={[...base, "date"]} placeholder="Year" />
            </div>
          </div>
        );
      })}
    </>
  );
}

export function CustomBody({ items, sectionIndex }: { items: CustomItem[]; sectionIndex: number }) {
  return (
    <>
      {items.map((item, i) => {
        const base: FieldPath = ["sections", sectionIndex, "items", i];
        return (
          <div className="rd-entry" key={item.id} data-item-id={item.id}>
            <div className="rd-entry-row">
              <EditableText className="rd-entry-primary" value={item.heading} path={[...base, "heading"]} placeholder="Heading" />
              <EditableText className="rd-entry-meta" value={item.dateRange} path={[...base, "dateRange"]} placeholder="Dates" />
            </div>
            {item.subheading ? (
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
