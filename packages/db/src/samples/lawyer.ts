import type { ResumeContent } from "@repo/types";

/**
 * Lawyer.
 *
 * Legal hiring inverts the usual order: education leads, because the school,
 * the class rank and the law review masthead are the first screen at firms and
 * for clerkships. Bar admissions are their own section and never merely a
 * bullet — an unadmitted candidate cannot do the job in that jurisdiction.
 *
 * Matters are described by posture and forum rather than by outcome alone, and
 * publications are visible: legal employers read them as evidence of the
 * writing the role is actually made of.
 */
export const LAWYER_SAMPLE: ResumeContent = {
  personalInfo: {
    name: "Daniel Okonjo",
    title: "Litigation Associate — Commercial Disputes",
    email: "d.okonjo@example.com",
    phone: "(212) 555-0164",
    location: "New York, NY",
    links: [
      { id: "lnk_li", label: "linkedin.com/in/danielokonjo", url: "https://linkedin.com/in/danielokonjo" },
    ],
  },
  sections: [
    {
      id: "sec_edu",
      type: "education",
      title: "Education",
      order: 0,
      visible: true,
      items: [
        {
          id: "itm_edu1",
          institution: "Columbia Law School",
          degree: "J.D., cum laude",
          location: "New York, NY",
          startDate: "2016",
          endDate: "2019",
          bullets: [
            "Notes Editor, <i>Columbia Law Review</i>. Harlan Fiske Stone Scholar, 2017 and 2018.",
          ],
        },
        {
          id: "itm_edu2",
          institution: "Georgetown University",
          degree: "B.A. Government, magna cum laude",
          location: "Washington, DC",
          startDate: "2012",
          endDate: "2016",
          bullets: ["Phi Beta Kappa. Thesis on federal preemption in securities regulation."],
        },
      ],
    },
    {
      id: "sec_bar",
      type: "custom",
      title: "Bar Admissions",
      order: 1,
      visible: true,
      items: [
        {
          id: "itm_bar1",
          heading: "New York",
          subheading: "Admitted, First Judicial Department",
          dateRange: "2020",
          bullets: [],
        },
        {
          id: "itm_bar2",
          heading: "New Jersey",
          subheading: "Admitted; also S.D.N.Y. and E.D.N.Y.",
          dateRange: "2021",
          bullets: [],
        },
      ],
    },
    {
      id: "sec_exp",
      type: "experience",
      title: "Experience",
      order: 2,
      visible: true,
      items: [
        {
          id: "itm_exp1",
          org: "Sullivan & Marsh LLP",
          role: "Litigation Associate",
          location: "New York, NY",
          startDate: "Sep 2021",
          endDate: "Present",
          bullets: [
            "Second-chaired a three-week S.D.N.Y. jury trial defending a $140M breach-of-contract claim; examined two fact witnesses and drafted the Rule 50 motion.",
            "Drafted the successful motion to dismiss a putative securities class action on materiality grounds, disposing of all federal claims before discovery.",
            "Manage document review and privilege logging for a multidistrict antitrust matter spanning 2.1 million documents.",
          ],
        },
        {
          id: "itm_exp2",
          org: "Hon. Marcia L. Whitfield, U.S. District Court, D.N.J.",
          role: "Law Clerk",
          location: "Newark, NJ",
          startDate: "Aug 2020",
          endDate: "Aug 2021",
          bullets: [
            "Drafted 24 opinions and orders on summary judgment, class certification and Daubert motions.",
            "Managed the chambers' patent docket, including claim construction in four Hatch-Waxman cases.",
          ],
        },
      ],
    },
    {
      id: "sec_skills",
      type: "skills",
      title: "Practice Areas & Skills",
      order: 3,
      visible: true,
      items: [
        {
          id: "itm_sk1",
          category: "Practice Areas",
          skills: ["Commercial Litigation", "Securities Litigation", "Antitrust", "Contract Disputes"],
        },
        {
          id: "itm_sk2",
          category: "Skills",
          skills: ["Brief Writing", "Oral Argument", "Depositions", "E-Discovery Management"],
        },
        {
          id: "itm_sk3",
          category: "Tools",
          skills: ["Westlaw", "Lexis+", "Relativity", "Everlaw", "PACER"],
        },
      ],
    },
    {
      id: "sec_pub",
      type: "custom",
      title: "Publications",
      order: 4,
      visible: true,
      items: [
        {
          id: "itm_pub1",
          heading: "Materiality After <i>Omnicare</i>: A Pleading-Stage Problem",
          subheading: "119 Colum. L. Rev. 1483",
          dateRange: "2019",
          bullets: [],
        },
        {
          id: "itm_pub2",
          heading: "Note, Successor Liability and the Limits of the De Facto Merger Doctrine",
          subheading: "118 Colum. L. Rev. 2201",
          dateRange: "2018",
          bullets: [],
        },
      ],
    },
  ],
};
