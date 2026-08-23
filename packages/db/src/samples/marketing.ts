import type { ResumeContent } from "@repo/types";

/**
 * Marketing / Sales.
 *
 * The one field where the numbers are the qualification: quota attainment,
 * pipeline sourced and revenue influenced are read first and everything else is
 * supporting detail. So the summary opens with attainment across years rather
 * than with adjectives, and every experience bullet carries a figure.
 *
 * Vendor certifications are visible because they are cheap to verify and
 * routinely filtered on in this field, unlike in engineering.
 */
export const MARKETING_SAMPLE: ResumeContent = {
  personalInfo: {
    name: "Jordan Whitfield",
    title: "Senior Demand Generation Manager",
    email: "jordan.whitfield@example.com",
    phone: "(312) 555-0148",
    location: "Chicago, IL",
    links: [
      { id: "lnk_li", label: "linkedin.com/in/jordanwhitfield", url: "https://linkedin.com/in/jordanwhitfield" },
      { id: "lnk_site", label: "jordanwhitfield.co", url: "https://jordanwhitfield.co" },
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
          text: "Demand generation lead who has hit or beaten pipeline target in eleven of the last twelve quarters, most recently sourcing $34M in qualified pipeline against a $26M goal. Built the full-funnel attribution model that redirected 40% of a $6M budget.",
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
          org: "Northlight Software",
          role: "Senior Demand Generation Manager",
          location: "Chicago, IL",
          startDate: "Mar 2022",
          endDate: "Present",
          bullets: [
            "Own a $6.2M annual programme budget across paid, events, webinars and lifecycle; sourced $34M in qualified pipeline in FY25 against a $26M target (131%).",
            "Rebuilt attribution from last-touch to a W-shaped model in HubSpot and Snowflake, revealing that paid search was claiming 38% of field-event credit.",
            "Cut blended cost per SQL from $840 to $517 in four quarters by reallocating that spend and killing two syndication vendors.",
            "Launched an ABM programme for 120 enterprise accounts; those accounts closed at 2.4× the rate of the general funnel.",
          ],
        },
        {
          id: "itm_exp2",
          org: "Cadence Analytics",
          role: "Marketing Manager, Growth",
          location: "Chicago, IL",
          startDate: "Jul 2019",
          endDate: "Feb 2022",
          bullets: [
            "Grew inbound MQLs from 310 to 1,450 per month over 30 months while holding cost per MQL flat.",
            "Ran the lifecycle programme end to end — 40+ nurture tracks in Marketo — lifting MQL-to-SQL conversion from 12% to 19%.",
          ],
        },
        {
          id: "itm_exp3",
          org: "Cadence Analytics",
          role: "Account Executive, Mid-Market",
          location: "Chicago, IL",
          startDate: "Jan 2018",
          endDate: "Jun 2019",
          bullets: [
            "Closed $2.3M in new ARR against a $1.8M quota (128%); President's Club, 2018.",
          ],
        },
      ],
    },
    {
      id: "sec_skills",
      type: "skills",
      title: "Skills",
      order: 2,
      visible: true,
      items: [
        {
          id: "itm_sk1",
          category: "Demand Generation",
          skills: ["Paid Search & Social", "ABM", "Lifecycle Marketing", "Field Events", "Webinars"],
        },
        {
          id: "itm_sk2",
          category: "Analytics",
          skills: ["Multi-Touch Attribution", "Funnel Modelling", "Cohort Analysis", "SQL", "Looker"],
        },
        {
          id: "itm_sk3",
          category: "Platforms",
          skills: ["Salesforce", "HubSpot", "Marketo", "6sense", "Outreach", "Google Ads"],
        },
      ],
    },
    {
      id: "sec_edu",
      type: "education",
      title: "Education",
      order: 3,
      visible: true,
      items: [
        {
          id: "itm_edu1",
          institution: "University of Illinois Urbana-Champaign",
          degree: "B.S. Business Administration, Marketing",
          location: "Urbana, IL",
          startDate: "2013",
          endDate: "2017",
          bullets: ["Minor in Statistics. Vice President, American Marketing Association chapter."],
        },
      ],
    },
    {
      id: "sec_cert",
      type: "certifications",
      title: "Certifications",
      order: 4,
      visible: true,
      items: [
        {
          id: "itm_ct1",
          name: "Salesforce Certified Marketing Cloud Administrator",
          issuer: "Salesforce",
          date: "2024",
          link: "",
        },
        {
          id: "itm_ct2",
          name: "HubSpot Marketing Software Certified",
          issuer: "HubSpot Academy",
          date: "2023",
          link: "",
        },
      ],
    },
  ],
};
