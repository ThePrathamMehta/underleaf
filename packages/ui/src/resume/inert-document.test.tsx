import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_THEME, createEmptyContent, type ResumeContent } from "@repo/types";
import { ResumeDocument } from "./resume-document";

/**
 * The invariant behind `inert`: a thumbnail's markup has to be legal inside the
 * `<Link>` its callers wrap it in, and `<a>` inside `<a>` is not. Asserted on
 * rendered output rather than by reading the components, because the anchors come
 * from two unrelated places — the contact links in the header, and the inline links
 * the selection toolbar writes into a bullet's own HTML.
 */
const WITH_LINKS: ResumeContent = {
  ...createEmptyContent(),
  personalInfo: {
    name: "Avery Chen",
    title: "",
    email: "avery@example.com",
    phone: "",
    location: "",
    links: [{ id: "l1", label: "averychen.dev", url: "https://averychen.dev" }],
  },
  sections: [
    {
      id: "s1",
      type: "experience",
      title: "Experience",
      order: 0,
      visible: true,
      items: [
        {
          id: "i1",
          org: "Northwind",
          role: "Engineer",
          location: "",
          startDate: "2021",
          endDate: "Present",
          bullets: ['Shipped <a href="https://northwind.test/case">the case study</a>'],
        },
      ],
    },
  ],
};

const render = (inert: boolean) =>
  renderToStaticMarkup(
    <ResumeDocument templateSlug="jakes" content={WITH_LINKS} theme={DEFAULT_THEME} inert={inert} />,
  );

describe("an inert document", () => {
  test("emits no anchors, from the header or from inside a bullet", () => {
    const markup = render(true);

    expect(markup).not.toContain("<a ");
    expect(markup).not.toContain("<a>");
    // The words survive; only the navigation is gone.
    expect(markup).toContain("averychen.dev");
    expect(markup).toContain("the case study");
  });

  test("still renders both kinds of link when it isn't inert, which the PDF needs", () => {
    const markup = render(false);

    expect(markup).toContain('href="https://averychen.dev"');
    expect(markup).toContain('href="https://northwind.test/case"');
  });
});
