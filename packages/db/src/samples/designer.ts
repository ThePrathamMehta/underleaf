import type { ResumeContent } from "@repo/types";

/**
 * Designer / Creative.
 *
 * The portfolio link is the single most important field here — most design
 * screens begin by opening it and the resume is read second — so it leads the
 * contact row rather than trailing the social links.
 *
 * Selected work replaces the engineer's "Projects": case studies stated as
 * problem → intervention → measured outcome, because "redesigned the
 * onboarding" says nothing a hiring manager can evaluate. Craft skills and
 * tools are split, since a tool list alone reads as a software inventory.
 */
export const DESIGNER_SAMPLE: ResumeContent = {
  personalInfo: {
    name: "Noor Haddad",
    title: "Senior Product Designer",
    email: "noor@example.com",
    phone: "(646) 555-0173",
    location: "Brooklyn, NY",
    links: [
      { id: "lnk_folio", label: "noorhaddad.design", url: "https://noorhaddad.design" },
      { id: "lnk_li", label: "linkedin.com/in/noorhaddad", url: "https://linkedin.com/in/noorhaddad" },
      { id: "lnk_dribbble", label: "dribbble.com/noorhaddad", url: "https://dribbble.com/noorhaddad" },
    ],
  },
  sections: [
    {
      id: "sec_summary",
      type: "summary",
      title: "Profile",
      order: 0,
      visible: true,
      items: [
        {
          id: "itm_summary",
          text: "Product designer with eight years across fintech and consumer subscription, working end to end from research through shipped interface. Built and now maintain a design system adopted by 40 engineers across six squads. Most comfortable on problems where the interface has to carry genuine complexity without looking like it does.",
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
          org: "Ferry",
          role: "Senior Product Designer",
          location: "New York, NY",
          startDate: "Feb 2023",
          endDate: "Present",
          bullets: [
            "Own the money-movement surface — transfers, scheduling and limits — used by 2.4M monthly active customers.",
            "Redesigned the transfer flow around a single confirm step, cutting drop-off 34% and support contacts about failed transfers by half.",
            "Created and maintain Harbour, the company design system: 94 components in Figma with matching React primitives, now used by 40 engineers across six squads.",
            "Run a fortnightly critique for eight designers, and introduced the written design-review doc that replaced ad hoc Slack feedback.",
            "Partner with the research team on quarterly generative studies; personally moderated 60+ usability sessions.",
          ],
        },
        {
          id: "itm_exp2",
          org: "Loomstate",
          role: "Product Designer",
          location: "Remote",
          startDate: "Jun 2020",
          endDate: "Jan 2023",
          bullets: [
            "Sole designer for the subscriber-facing app through a growth from 60K to 900K accounts.",
            "Rebuilt the plan-selection page; the resulting variant lifted paid conversion 18% and became the permanent default after a six-week test.",
            "Established the accessibility baseline — WCAG 2.1 AA contrast, focus order and reduced-motion support — and fixed 140 existing violations.",
          ],
        },
        {
          id: "itm_exp3",
          org: "Vantage Studio",
          role: "Visual Designer",
          location: "Chicago, IL",
          startDate: "Aug 2018",
          endDate: "May 2020",
          bullets: [
            "Designed brand and marketing systems for 11 client engagements, including two full identity rebuilds.",
          ],
        },
      ],
    },
    {
      id: "sec_work",
      type: "projects",
      title: "Selected Work",
      order: 2,
      visible: true,
      items: [
        {
          id: "itm_wk1",
          name: "Harbour Design System",
          tech: "Figma, Design Tokens, React, Storybook",
          link: "noorhaddad.design/harbour",
          startDate: "2023",
          endDate: "Present",
          bullets: [
            "Consolidated four divergent component libraries into one tokenised system, taking new-feature design time from roughly two weeks to four days.",
            "Documented every component with usage guidance and accessibility notes, which cut design-QA rework tickets 62%.",
          ],
        },
        {
          id: "itm_wk2",
          name: "Transfer Confirmation Redesign",
          tech: "Research, Prototyping, A/B Testing",
          link: "noorhaddad.design/transfers",
          startDate: "2024",
          endDate: "2024",
          bullets: [
            "Diary study with 22 customers found the failure was ambiguity about timing, not the form itself; the fix was a plain-language arrival estimate rather than fewer fields.",
          ],
        },
      ],
    },
    {
      id: "sec_skills",
      type: "skills",
      title: "Skills & Tools",
      order: 3,
      visible: true,
      items: [
        {
          id: "itm_sk1",
          category: "Craft",
          skills: ["Interaction Design", "Design Systems", "Prototyping", "Visual Design", "Information Architecture"],
        },
        {
          id: "itm_sk2",
          category: "Research",
          skills: ["Usability Testing", "Diary Studies", "A/B Testing", "Journey Mapping"],
        },
        {
          id: "itm_sk3",
          category: "Tools",
          skills: ["Figma", "Framer", "Adobe CC", "Rive", "Storybook", "Maze"],
        },
        {
          id: "itm_sk4",
          category: "Working knowledge",
          skills: ["HTML", "CSS", "React", "WCAG 2.1 AA"],
        },
      ],
    },
    {
      id: "sec_edu",
      type: "education",
      title: "Education",
      order: 4,
      visible: true,
      items: [
        {
          id: "itm_edu1",
          institution: "Rhode Island School of Design",
          degree: "BFA Graphic Design",
          location: "Providence, RI",
          startDate: "2014",
          endDate: "2018",
          bullets: ["Concentration in typography. Senior thesis exhibited in the 2018 degree show."],
        },
      ],
    },
    {
      id: "sec_cert",
      type: "certifications",
      title: "Recognition",
      order: 5,
      visible: false,
      items: [
        {
          id: "itm_ct1",
          name: "Communication Arts Design Annual, Interactive",
          issuer: "Communication Arts",
          date: "2024",
          link: "",
        },
      ],
    },
  ],
};
