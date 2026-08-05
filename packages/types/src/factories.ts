import type { ResumeContent, Section, SectionType } from "./content";

/**
 * Ids only need to be unique within one resume document, and both the seed
 * script and the browser editor mint them, so a counter-free random suffix is
 * simpler than threading a generator through the editor reducer.
 */
export function makeId(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

const SECTION_DEFAULT_TITLES: Record<SectionType, string> = {
  summary: "Summary",
  experience: "Experience",
  education: "Education",
  skills: "Skills",
  projects: "Projects",
  certifications: "Certifications",
  custom: "Custom Section",
};

export function defaultSectionTitle(type: SectionType): string {
  return SECTION_DEFAULT_TITLES[type];
}

/** An empty section of the given type, with one blank item to edit into. */
export function createEmptySection(type: SectionType, order: number): Section {
  const base = { id: makeId("sec"), order, visible: true };

  switch (type) {
    case "summary":
      return { ...base, type, title: SECTION_DEFAULT_TITLES.summary, items: [{ id: makeId("item"), text: "" }] };
    case "experience":
      return {
        ...base,
        type,
        title: SECTION_DEFAULT_TITLES.experience,
        items: [
          {
            id: makeId("item"),
            org: "Company",
            role: "Role",
            location: "",
            startDate: "",
            endDate: "",
            bullets: [""],
          },
        ],
      };
    case "education":
      return {
        ...base,
        type,
        title: SECTION_DEFAULT_TITLES.education,
        items: [
          {
            id: makeId("item"),
            institution: "Institution",
            degree: "Degree",
            location: "",
            startDate: "",
            endDate: "",
            bullets: [],
          },
        ],
      };
    case "skills":
      return {
        ...base,
        type,
        title: SECTION_DEFAULT_TITLES.skills,
        items: [{ id: makeId("item"), category: "Languages", skills: [] }],
      };
    case "projects":
      return {
        ...base,
        type,
        title: SECTION_DEFAULT_TITLES.projects,
        items: [
          {
            id: makeId("item"),
            name: "Project",
            tech: "",
            link: "",
            startDate: "",
            endDate: "",
            bullets: [""],
          },
        ],
      };
    case "certifications":
      return {
        ...base,
        type,
        title: SECTION_DEFAULT_TITLES.certifications,
        items: [{ id: makeId("item"), name: "Certification", issuer: "", date: "", link: "" }],
      };
    case "custom":
      return {
        ...base,
        type,
        title: SECTION_DEFAULT_TITLES.custom,
        items: [{ id: makeId("item"), heading: "", subheading: "", dateRange: "", bullets: [""] }],
      };
  }
}

/** A blank-but-valid resume, used when creating from a template with no sample. */
export function createEmptyContent(): ResumeContent {
  return {
    personalInfo: {
      name: "Your Name",
      title: "Your Title",
      email: "",
      phone: "",
      location: "",
      links: [],
    },
    sections: (["summary", "experience", "education", "skills", "projects"] as const).map(
      (type, index) => createEmptySection(type, index),
    ),
  };
}

/**
 * A truly blank document for "Start from Blank": empty personal info and a few
 * scaffolded sections with *no* items, so the canvas has structure to build on
 * without any placeholder content to clear out first.
 */
export function createBlankContent(): ResumeContent {
  return {
    personalInfo: { name: "", title: "", email: "", phone: "", location: "", links: [] },
    sections: [
      { id: makeId("sec"), type: "experience", title: SECTION_DEFAULT_TITLES.experience, order: 0, visible: true, items: [] },
      { id: makeId("sec"), type: "education", title: SECTION_DEFAULT_TITLES.education, order: 1, visible: true, items: [] },
      { id: makeId("sec"), type: "skills", title: SECTION_DEFAULT_TITLES.skills, order: 2, visible: true, items: [] },
    ],
  };
}
