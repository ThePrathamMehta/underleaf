import { describe, expect, test } from "bun:test";
import { buildLatexImportRequest, parseLatexReply, LATEX_IMPORT_SYSTEM_PROMPT } from "./ai";

/**
 * The AI fallback's half of the import.
 *
 * Every test here is a *reply*, not a source — these are the cases a live provider
 * would only produce by accident, and the ones where getting it wrong means either
 * losing a user's resume or presenting a mangled one as if it were fine.
 */

/** A minimal well-formed reply, spread into the specific shapes below. */
const GOOD_REPLY = {
  personalInfo: {
    name: "Jake Ryan",
    title: "",
    email: "jake@su.edu",
    phone: "123-456-7890",
    location: "Georgetown, TX",
    links: [{ label: "github.com/jake", url: "https://github.com/jake" }],
  },
  sections: [
    {
      type: "experience",
      title: "Experience",
      items: [
        {
          org: "Texas A&M University",
          role: "Research Assistant",
          location: "College Station, TX",
          startDate: "June 2020",
          endDate: "Present",
          bullets: ["Developed a REST API using FastAPI"],
        },
      ],
    },
    {
      type: "skills",
      title: "Technical Skills",
      items: [{ category: "Languages", skills: ["Java", "Python"] }],
    },
  ],
};

describe("the request", () => {
  test("carries the source and the shape the reply is held to", () => {
    const request = buildLatexImportRequest("\\section{Education}");

    expect(request).toContain("\\section{Education}");
    expect(request).toContain('"personalInfo"');
    expect(request).toContain('"// experience"');
  });

  test("tells the model not to invent content, which is the rule that matters", () => {
    expect(LATEX_IMPORT_SYSTEM_PROMPT).toContain("Never write a bullet");
    expect(LATEX_IMPORT_SYSTEM_PROMPT).toContain("JSON only");
  });
});

describe("reading a reply", () => {
  test("takes the document out of a well-formed reply", () => {
    const outcome = parseLatexReply(JSON.stringify(GOOD_REPLY));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.warnings).toEqual([]);
    expect(outcome.content.personalInfo.name).toBe("Jake Ryan");
    expect(outcome.content.sections.map((s) => s.type)).toEqual(["experience", "skills"]);
    // Bookkeeping the model was never asked for, added here.
    expect(outcome.content.sections[0]!.order).toBe(0);
    expect(outcome.content.sections[1]!.order).toBe(1);
    expect(outcome.content.sections.every((s) => s.visible && s.id.length > 0)).toBe(true);
    expect(outcome.content.personalInfo.links[0]!.id.length).toBeGreaterThan(0);
  });

  test("digs the JSON out of a fence and out of surrounding prose", () => {
    const fenced = parseLatexReply("Here you go:\n```json\n" + JSON.stringify(GOOD_REPLY) + "\n```");
    const prefaced = parseLatexReply("Sure! " + JSON.stringify(GOOD_REPLY) + " Let me know.");

    expect(fenced.ok).toBe(true);
    expect(prefaced.ok).toBe(true);
    if (fenced.ok) expect(fenced.content.sections).toHaveLength(2);
    if (prefaced.ok) expect(prefaced.content.sections).toHaveLength(2);
  });

  /**
   * The salvage the spec is most explicit about: one bad shape costs its own
   * section and names itself, and everything the model got right survives.
   */
  test("drops only the section it couldn't read, and says which", () => {
    const outcome = parseLatexReply(
      JSON.stringify({
        ...GOOD_REPLY,
        sections: [
          GOOD_REPLY.sections[0],
          // Items have to be objects before their fields mean anything; bare
          // strings have no field to read a category or a skill out of.
          { type: "skills", title: "Technical Skills", items: ["Java", "Python"] },
        ],
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.content.sections.map((s) => s.type)).toEqual(["experience"]);
    expect(outcome.warnings).toHaveLength(1);
    expect(outcome.warnings[0]).toContain("Technical Skills");
    // Order is over the sections that survived, not the ones that were asked for —
    // a gap here would put a hole in the rendered document.
    expect(outcome.content.sections[0]!.order).toBe(0);
  });

  /**
   * The repairs, both for shapes with one sensible reading. A section lost to a
   * field the model wrote as a scalar is a section the user has to retype from a
   * source they already pasted once.
   */
  test("reads a comma-joined skills string as the list it plainly is", () => {
    const outcome = parseLatexReply(
      JSON.stringify({
        personalInfo: { name: "Jake Ryan" },
        sections: [
          { type: "skills", title: "Skills", items: [{ category: "Languages", skills: "Java, Python , C++" }] },
        ],
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const item = outcome.content.sections[0]!.items[0] as { skills: string[] };
    expect(item.skills).toEqual(["Java", "Python", "C++"]);
    expect(outcome.warnings).toEqual([]);
  });

  test("reads a lone bullet string as one bullet, and a null as nothing", () => {
    const outcome = parseLatexReply(
      JSON.stringify({
        personalInfo: { name: "Jake Ryan" },
        sections: [
          {
            type: "experience",
            title: "Experience",
            items: [{ org: "Texas A&M", role: null, bullets: "Built the thing" }],
          },
        ],
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const item = outcome.content.sections[0]!.items[0] as { role: string; bullets: string[] };
    expect(item.bullets).toEqual(["Built the thing"]);
    // A null is the model declining to answer, which is an empty field — not a
    // reason to lose the job it belongs to.
    expect(item.role).toBe("");
  });

  test("keeps the sections when the header is the unusable part", () => {
    const outcome = parseLatexReply(
      JSON.stringify({ personalInfo: "Jake Ryan, jake@su.edu", sections: GOOD_REPLY.sections }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.content.sections).toHaveLength(2);
    expect(outcome.content.personalInfo.name).toBe("");
    expect(outcome.warnings.join(" ")).toContain("name and contact details");
  });

  test("fills in a missing section title and type rather than dropping the content", () => {
    const outcome = parseLatexReply(
      JSON.stringify({
        personalInfo: { name: "Jake Ryan" },
        // No `subheading`, no `dateRange` — both required by the schema, and
        // neither one the model has any reason to volunteer.
        sections: [{ items: [{ heading: "Volunteer Work", bullets: ["Ran the food bank rota"] }] }],
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.content.sections).toHaveLength(1);
    expect(outcome.content.sections[0]!.type).toBe("custom");
    expect(outcome.content.sections[0]!.title).toBe("Section");
    expect(outcome.content.sections[0]!.items[0]).toMatchObject({
      heading: "Volunteer Work",
      subheading: "",
      dateRange: "",
    });
  });

  test("ignores sections with no items instead of rendering empty headings", () => {
    const outcome = parseLatexReply(
      JSON.stringify({
        personalInfo: { name: "Jake Ryan" },
        sections: [{ type: "projects", title: "Projects", items: [] }, GOOD_REPLY.sections[1]],
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.content.sections.map((s) => s.title)).toEqual(["Technical Skills"]);
  });

  /**
   * The refusals. Each one sends the import back to whatever the deterministic
   * parser found, which is the honest answer — so it matters that a reply holding
   * nothing is never mistaken for a resume that happens to be empty.
   */
  test("refuses a reply with no JSON in it", () => {
    const outcome = parseLatexReply("I can't read that file, sorry.");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("JSON");
  });

  test("refuses JSON that isn't parseable", () => {
    const outcome = parseLatexReply('{"personalInfo": {"name": "Jake",}}');
    expect(outcome.ok).toBe(false);
  });

  test("refuses a well-formed reply that holds no content", () => {
    const outcome = parseLatexReply(JSON.stringify({ personalInfo: { name: "" }, sections: [] }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("no resume content");
  });

  test("keeps a name-only reply, which is thin but not a failure", () => {
    const outcome = parseLatexReply(JSON.stringify({ personalInfo: { name: "Jake Ryan" }, sections: [] }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.content.personalInfo.name).toBe("Jake Ryan");
    expect(outcome.content.sections).toEqual([]);
  });

  test("caps the links a reply can carry", () => {
    const outcome = parseLatexReply(
      JSON.stringify({
        personalInfo: {
          name: "Jake Ryan",
          links: Array.from({ length: 20 }, (_, i) => ({ label: `link ${i}`, url: `https://x.test/${i}` })),
        },
        sections: GOOD_REPLY.sections,
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.content.personalInfo.links).toHaveLength(8);
  });

  test("labels a link that came back with a url and no label", () => {
    const outcome = parseLatexReply(
      JSON.stringify({
        personalInfo: { name: "Jake Ryan", links: [{ url: "https://github.com/jake" }] },
        sections: GOOD_REPLY.sections,
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.content.personalInfo.links[0]!.label).toBe("https://github.com/jake");
  });
});
