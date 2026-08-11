import { describe, expect, test } from "bun:test";
import type { ResumeContent, Section, Theme } from "@repo/types";
import { dateFormat, isQuantified, scoreDocument, startsWithActionVerb } from "./rules";
import { diffAgainstResume, extractJdKeywords } from "./jd";
import { resumeBullets, toPlainText } from "./text";

/**
 * The rule engine is a pure function of the document, so it tests without a
 * database, a provider or a DOM. These cover the checks whose behaviour is easy
 * to get subtly wrong — markup stripping, verb stemming, weighted keyword
 * coverage — plus the guarantee the whole hybrid rests on: a weak resume scores
 * lower than a strong one, deterministically.
 */

const THEME: Theme = {
  fontFamily: "inter",
  headingFontFamily: "inter",
  fontSizeScale: 1,
  accentColor: "#1a1a1a",
  textColor: "#1a1a1a",
  lineSpacing: 1.25,
  marginSize: 14,
  layout: "single-column",
  pageSize: "letter",
};

function experience(bullets: string[]): Section {
  return {
    id: "s-exp",
    type: "experience",
    title: "Experience",
    order: 1,
    visible: true,
    items: [
      {
        id: "i-1",
        org: "Acme",
        role: "Senior Engineer",
        location: "Remote",
        startDate: "Jun 2021",
        endDate: "Present",
        bullets,
      },
    ],
  };
}

function content(sections: Section[], overrides: Partial<ResumeContent["personalInfo"]> = {}): ResumeContent {
  return {
    personalInfo: {
      name: "Ada Lovelace",
      title: "Backend Engineer",
      email: "ada@example.com",
      phone: "+1 555 010 2030",
      location: "London, UK",
      links: [],
      ...overrides,
    },
    sections,
  };
}

const STRONG = content([
  {
    id: "s-sum",
    type: "summary",
    title: "Summary",
    order: 0,
    visible: true,
    items: [
      {
        id: "i-sum",
        text: "Backend engineer with 6 years building Node and Postgres services handling 40k requests per second.",
      },
    ],
  },
  experience([
    "Cut checkout latency 45% by replacing a synchronous Postgres write path with a Kafka queue, serving 2M users.",
    "Led a team of 5 engineers migrating 30 services to Kubernetes, reducing deploy time from 40 minutes to 6.",
    "Automated integration testing with Playwright, raising coverage from 22% to 81% across 14 repositories.",
  ]),
  {
    id: "s-edu",
    type: "education",
    title: "Education",
    order: 2,
    visible: true,
    items: [
      {
        id: "i-edu",
        institution: "University of London",
        degree: "BSc Computer Science",
        location: "London, UK",
        startDate: "Sep 2014",
        endDate: "Jun 2017",
        bullets: [],
      },
    ],
  },
  {
    id: "s-skills",
    type: "skills",
    title: "Skills",
    order: 3,
    visible: true,
    items: [
      { id: "i-sk1", category: "Languages", skills: ["TypeScript", "Python", "Go", "SQL"] },
      { id: "i-sk2", category: "Infrastructure", skills: ["AWS", "Docker", "Kubernetes", "Terraform", "Kafka"] },
      { id: "i-sk3", category: "Data", skills: ["Postgres", "Redis", "Elasticsearch"] },
    ],
  },
]);

const WEAK = content(
  [
    experience([
      "Responsible for the backend",
      "Worked on various tasks",
    ]),
  ],
  { email: "ada at example dot com", phone: "" },
);

describe("text extraction", () => {
  test("strips the inline HTML subset and decodes entities", () => {
    expect(toPlainText("<strong>Led</strong> a team of&nbsp;5 &amp; shipped")).toBe("Led a team of 5 & shipped");
  });

  test("skips hidden sections, because they aren't in the exported PDF", () => {
    const hidden = content([{ ...experience(["Shipped a thing that mattered"]), visible: false }]);
    expect(resumeBullets(hidden)).toHaveLength(0);
  });
});

describe("bullet checks", () => {
  test("recognizes quantifiers an ATS would read as results", () => {
    expect(isQuantified("Cut latency 45%")).toBe(true);
    expect(isQuantified("Saved $2M annually")).toBe(true);
    expect(isQuantified("Led a team of 5 engineers")).toBe(true);
    expect(isQuantified("Improved the developer experience")).toBe(false);
  });

  test("accepts present-tense openers a current role legitimately uses", () => {
    expect(startsWithActionVerb("Led a migration")).toBe(true);
    expect(startsWithActionVerb("Leads a team of six")).toBe(true);
    expect(startsWithActionVerb("Designing the payment flow")).toBe(true);
    expect(startsWithActionVerb("Responsible for the backend")).toBe(false);
  });

  test("sees through markup to the first real word", () => {
    expect(startsWithActionVerb("<strong>Rebuilt</strong> the pipeline")).toBe(false);
    expect(startsWithActionVerb(toPlainText("<strong>Rebuilt</strong> the pipeline"))).toBe(true);
  });
});

describe("date consistency", () => {
  test("classifies shapes, and treats Present as no format at all", () => {
    expect(dateFormat("Jun 2021")).toBe("month-name");
    expect(dateFormat("06/2021")).toBe("numeric");
    expect(dateFormat("2021")).toBe("year");
    expect(dateFormat("Present")).toBeNull();
  });

  test("flags a document that mixes two formats", () => {
    const mixed = content([
      experience(["Shipped 4 releases covering 12 teams and 300 users"]),
      {
        id: "s-edu",
        type: "education",
        title: "Education",
        order: 2,
        visible: true,
        items: [
          {
            id: "i-edu",
            institution: "MIT",
            degree: "BSc",
            location: "MA",
            startDate: "09/2014",
            endDate: "06/2017",
            bullets: [],
          },
        ],
      },
    ]);

    const { issues } = scoreDocument(mixed, THEME, "jakes");
    expect(issues.some((issue) => issue.message.includes("different formats"))).toBe(true);
  });
});

describe("scoreDocument", () => {
  test("scores a strong resume well above a weak one", () => {
    const strong = scoreDocument(STRONG, THEME, "jakes");
    const weak = scoreDocument(WEAK, THEME, "jakes");

    expect(strong.overallScore).toBeGreaterThan(weak.overallScore + 25);
    expect(strong.overallScore).toBeLessThanOrEqual(100);
    expect(weak.overallScore).toBeGreaterThanOrEqual(0);
  });

  test("is deterministic — the same document twice gives the same result", () => {
    const first = scoreDocument(STRONG, THEME, "jakes");
    const second = scoreDocument(STRONG, THEME, "jakes");
    expect(second.overallScore).toBe(first.overallScore);
    expect(second.issues.map((issue) => issue.message)).toEqual(first.issues.map((issue) => issue.message));
  });

  test("every issue carries a fix, so none is a complaint with nothing to do", () => {
    const { issues } = scoreDocument(WEAK, THEME, "jakes");
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) expect(issue.fix.length).toBeGreaterThan(10);
  });

  test("anchors issues to real section ids", () => {
    const { issues } = scoreDocument(WEAK, THEME, "jakes");
    const ids = new Set(WEAK.sections.map((section) => section.id));
    for (const issue of issues) {
      if (issue.sectionRef) expect(ids.has(issue.sectionRef)).toBe(true);
    }
  });

  test("sorts critical issues first", () => {
    const { issues } = scoreDocument(WEAK, THEME, "jakes");
    const ranks = issues.map((issue) => ["critical", "warning", "suggestion"].indexOf(issue.severity));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  test("names the multi-column parsing risk rather than hiding it", () => {
    const { issues } = scoreDocument(STRONG, { ...THEME, layout: "sidebar-left" }, "deedy");
    expect(issues.some((issue) => issue.message.includes("sidebar left"))).toBe(true);
  });

  test("catches an unparseable email and a missing phone", () => {
    const { issues } = scoreDocument(WEAK, THEME, "jakes");
    expect(issues.some((issue) => issue.message.includes("parseable email"))).toBe(true);
    expect(issues.some((issue) => issue.message.includes("no phone number"))).toBe(true);
  });

  test("flags a creative heading an ATS wouldn't recognize", () => {
    const renamed = content([{ ...experience(["Shipped 6 services used by 4000 people"]), title: "Where I've Been" }]);
    const { issues } = scoreDocument(renamed, THEME, "jakes");
    expect(issues.some((issue) => issue.message.includes("isn't a heading an ATS recognizes"))).toBe(true);
  });
});

describe("JD matching", () => {
  const JD = `Senior Backend Engineer

Requirements:
- 5+ years of experience with TypeScript and Node.js
- Strong knowledge of Postgres and Redis
- Hands-on experience with Kubernetes and Terraform
- Experience with Kafka or another event streaming platform

Nice to have: Rust, GraphQL.

We offer competitive salary and benefits. We are an equal opportunity employer.`;

  test("lifts requirement-line terms above boilerplate", () => {
    const keywords = extractJdKeywords(JD);
    const terms = keywords.map((keyword) => keyword.term);

    expect(terms).toContain("kubernetes");
    expect(terms).toContain("postgres");
    expect(terms).not.toContain("benefits");
    expect(terms).not.toContain("salary");
  });

  test("splits matched from missing and weights the score by importance", () => {
    const diff = diffAgainstResume(STRONG, JD);
    const matched = diff.matched.map((keyword) => keyword.term);
    const missing = diff.missing.map((keyword) => keyword.term);

    expect(matched).toContain("kubernetes");
    expect(matched).toContain("terraform");
    expect(missing).toContain("rust");
    expect(diff.matchScore).toBeGreaterThan(50);
  });

  test("every matched keyword says where it was found", () => {
    for (const keyword of diffAgainstResume(STRONG, JD).matched) {
      expect(keyword.evidence).toBeTruthy();
    }
  });

  test("a resume with none of the requirements scores far lower", () => {
    expect(diffAgainstResume(WEAK, JD).matchScore).toBeLessThan(
      diffAgainstResume(STRONG, JD).matchScore,
    );
  });
});
