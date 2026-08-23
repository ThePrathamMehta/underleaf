import type { ResumeContent } from "@repo/types";

/**
 * CA / Accountant.
 *
 * Written to the conventions audit and tax recruiters actually screen for:
 * the qualification and its attempt history sit at the top (both are asked),
 * articleship is a named section because it is a required three-year training
 * contract rather than an ordinary job, and engagements are described by client
 * scale and standard applied (Ind AS, IFRS, SA 700) rather than by duty.
 *
 * Projects are absent — the software convention. What replaces them is
 * Certifications, made visible: a CA resume that omits the membership number
 * reads as unverifiable.
 */
export const ACCOUNTANT_SAMPLE: ResumeContent = {
  personalInfo: {
    name: "Rhea Iyer",
    title: "Chartered Accountant — Audit & Assurance",
    email: "rhea.iyer@example.com",
    phone: "+91 98200 41776",
    location: "Mumbai, India",
    links: [
      { id: "lnk_li", label: "linkedin.com/in/rheaiyer", url: "https://linkedin.com/in/rheaiyer" },
      { id: "lnk_icai", label: "ICAI Member No. 246831", url: "" },
    ],
  },
  sections: [
    {
      id: "sec_summary",
      type: "summary",
      title: "Professional Summary",
      order: 0,
      visible: true,
      items: [
        {
          id: "itm_summary",
          text: "Chartered Accountant with six years in statutory audit and direct tax, cleared both CA Final groups in the first attempt. Leads Ind AS 116 transitions for listed manufacturing clients across a portfolio of 14 engagements.",
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
          org: "Deloitte Haskins & Sells LLP",
          role: "Assistant Manager — Statutory Audit",
          location: "Mumbai, India",
          startDate: "Apr 2022",
          endDate: "Present",
          bullets: [
            "Manage statutory audits for 14 clients across manufacturing and NBFC sectors, with combined turnover of ₹4,200 crore.",
            "Led Ind AS 116 lease transition for two listed clients, remeasuring 380 contracts without a single audit adjustment on review.",
            "Identified an unrecorded ₹18 crore contingent liability from a pending GST demand, forcing a revised provisioning policy.",
          ],
        },
        {
          id: "itm_exp2",
          org: "S. R. Batliboi & Co. LLP (EY)",
          role: "Audit Executive",
          location: "Mumbai, India",
          startDate: "Jun 2020",
          endDate: "Mar 2022",
          bullets: [
            "Executed limited reviews and year-end audits for eight private clients, drafting the financial statements and the CARO 2020 annexure.",
            "Completed the Section 143(3)(i) internal financial controls assessment for a ₹900 crore auto-components client, testing 142 control points.",
          ],
        },
      ],
    },
    {
      id: "sec_articleship",
      type: "custom",
      title: "Articleship",
      order: 2,
      visible: true,
      items: [
        {
          id: "itm_art1",
          heading: "S. R. Batliboi & Co. LLP (EY)",
          subheading: "Article Assistant — Audit & Taxation",
          dateRange: "Jul 2017 – Jun 2020",
          bullets: [
            "Completed the full three-year training contract across statutory audit, internal audit and direct tax.",
          ],
        },
      ],
    },
    {
      id: "sec_edu",
      type: "education",
      title: "Education & Qualification",
      order: 3,
      visible: true,
      items: [
        {
          id: "itm_edu1",
          institution: "The Institute of Chartered Accountants of India",
          degree: "Chartered Accountancy — Final (Both Groups, First Attempt)",
          location: "New Delhi, India",
          startDate: "2017",
          endDate: "2020",
          bullets: ["All India Rank 214. Exemption in Advanced Auditing and Financial Reporting."],
        },
        {
          id: "itm_edu2",
          institution: "University of Mumbai",
          degree: "B.Com (Accountancy & Finance)",
          location: "Mumbai, India",
          startDate: "2014",
          endDate: "2017",
          bullets: [],
        },
      ],
    },
    {
      id: "sec_skills",
      type: "skills",
      title: "Technical Skills",
      order: 4,
      visible: true,
      items: [
        {
          id: "itm_sk1",
          category: "Audit & Assurance",
          skills: ["Statutory Audit", "Internal Financial Controls", "CARO 2020"],
        },
        {
          id: "itm_sk2",
          category: "Standards & Taxation",
          skills: ["Ind AS", "IFRS", "Direct Tax", "GST", "Transfer Pricing", "Tax Audit (Form 3CD)"],
        },
        {
          id: "itm_sk3",
          category: "Systems",
          skills: ["SAP FICO", "Tally Prime", "CaseWare", "Advanced Excel", "Power BI"],
        },
      ],
    },
    {
      id: "sec_cert",
      type: "certifications",
      title: "Certifications & Memberships",
      order: 5,
      visible: true,
      items: [
        {
          id: "itm_ct1",
          name: "Associate Chartered Accountant (ACA), Member No. 246831",
          issuer: "The Institute of Chartered Accountants of India",
          date: "2020",
          link: "",
        },
      ],
    },
  ],
};
