import type { ResumeContent } from "@repo/types";

/**
 * General / Other.
 *
 * The sample for someone whose field isn't listed, so it has to read plausibly
 * to almost any reader. Operations management is the choice because its work is
 * legible outside itself — schedules, budgets, vendors, headcount — where a
 * domain specialist's resume would look wrong to everyone but that domain.
 *
 * Section set is the conventional one with no additions: summary, experience,
 * education, skills. Certifications stay hidden, since an unfilled section is a
 * worse first impression than an absent one.
 */
export const GENERAL_SAMPLE: ResumeContent = {
  personalInfo: {
    name: "Alex Morgan",
    title: "Operations Manager",
    email: "alex.morgan@example.com",
    phone: "(720) 555-0115",
    location: "Denver, CO",
    links: [
      { id: "lnk_li", label: "linkedin.com/in/alexmorgan", url: "https://linkedin.com/in/alexmorgan" },
    ],
  },
  sections: [
    {
      id: "sec_summary",
      type: "summary",
      title: "Summary",
      order: 0,
      visible: true,
      items: [
        {
          id: "itm_summary",
          text: "Operations manager with nine years running distribution and service teams, currently responsible for a 60-person site and a $12M operating budget. Track record of finding the constraint rather than adding headcount — most recently taking order accuracy from 94% to 99.3% without increasing labour cost.",
        },
      ],
    },
    {
      id: "sec_exp",
      type: "experience",
      title: "Experience",
      order: 1,
      visible: true,
      items: [
        {
          id: "itm_exp1",
          org: "Rampart Distribution",
          role: "Operations Manager",
          location: "Denver, CO",
          startDate: "Apr 2022",
          endDate: "Present",
          bullets: [
            "Run daily operations for a 140,000 sq ft facility shipping 8,000 orders a day, with a team of 60 and a $12M operating budget.",
            "Raised order accuracy from 94% to 99.3% in three quarters by reworking pick-path zoning and adding a scan verification step, at no additional labour cost.",
            "Renegotiated three carrier contracts, reducing outbound freight spend 14% ($680K annually) while improving on-time delivery two points.",
            "Cut voluntary turnover from 38% to 21% by introducing a written shift-bid process and a formal promotion ladder for leads.",
            "Own the site safety programme; 640 days without a lost-time incident as of this quarter.",
            "Report weekly on throughput, cost per order and fill rate to the regional operations director.",
          ],
        },
        {
          id: "itm_exp2",
          org: "Rampart Distribution",
          role: "Assistant Operations Manager",
          location: "Denver, CO",
          startDate: "Jun 2019",
          endDate: "Mar 2022",
          bullets: [
            "Supervised two shifts totalling 34 associates, including hiring, scheduling and performance reviews.",
            "Led the WMS migration for the site — 11 weeks, no missed shipping days — and wrote the training material used across all four facilities.",
            "Rebuilt the inbound receiving schedule around carrier arrival windows, cutting trailer detention charges 22%.",
            "Ran the site's continuous improvement board, closing 40 associate-submitted process changes in the first year.",
          ],
        },
        {
          id: "itm_exp3",
          org: "Summit Retail Group",
          role: "Store Operations Supervisor",
          location: "Boulder, CO",
          startDate: "Aug 2017",
          endDate: "May 2019",
          bullets: [
            "Managed inventory and scheduling for a location doing $9M in annual revenue.",
            "Reduced shrink 1.8 points by tightening receiving reconciliation and retraining the receiving team.",
            "Coordinated seasonal hiring of 25 temporary associates across two peak cycles, retaining 80% through the season.",
          ],
        },
      ],
    },
    {
      id: "sec_edu",
      type: "education",
      title: "Education",
      order: 2,
      visible: true,
      items: [
        {
          id: "itm_edu1",
          institution: "Colorado State University",
          degree: "B.S. Business Administration, Operations & Supply Chain",
          location: "Fort Collins, CO",
          startDate: "2013",
          endDate: "2017",
          bullets: ["Graduated with honours. Treasurer, Supply Chain Management Association."],
        },
      ],
    },
    {
      id: "sec_skills",
      type: "skills",
      title: "Skills",
      order: 3,
      visible: true,
      items: [
        {
          id: "itm_sk1",
          category: "Operations",
          skills: ["Process Improvement", "Capacity Planning", "Vendor Management", "Inventory Control", "Safety Compliance"],
        },
        {
          id: "itm_sk2",
          category: "Leadership",
          skills: ["Team Development", "Hiring & Onboarding", "Performance Management", "Cross-Functional Coordination"],
        },
        {
          id: "itm_sk3",
          category: "Systems",
          skills: ["SAP", "NetSuite", "Manhattan WMS", "Advanced Excel", "Tableau"],
        },
      ],
    },
    {
      id: "sec_cert",
      type: "certifications",
      title: "Certifications",
      order: 4,
      visible: false,
      items: [
        {
          id: "itm_ct1",
          name: "Lean Six Sigma Green Belt",
          issuer: "ASQ",
          date: "2021",
          link: "",
        },
      ],
    },
  ],
};
