import type { ResumeContent } from "@repo/types";

/**
 * Doctor / Healthcare.
 *
 * A medical CV, not a resume, and the difference is structural: training is a
 * sequence (medical school → residency → fellowship) that credentialling
 * committees read in order, so it leads and is never compressed. Licensure and
 * board certification are their own section because a hospital cannot employ an
 * unlicensed physician, and both carry expiry dates the reader checks.
 *
 * Fits one page by shortening the *evidence*, never the credentials: training
 * keeps all four entries and licensure all three lines, while clinical bullets and
 * the publication list give up the room. The chief residency appears once, as a
 * line under the residency that earned it, rather than twice — a second entry
 * repeating a date already on the page is the cheapest thing here to cut. A
 * physician CV legitimately runs longer than this, which is what adding a page is
 * for.
 */
export const HEALTHCARE_SAMPLE: ResumeContent = {
  personalInfo: {
    name: "Priya Raghunathan, MD",
    title: "Board-Certified Internal Medicine — Cardiology Fellow",
    email: "p.raghunathan@example.com",
    phone: "(617) 555-0192",
    location: "Boston, MA",
    links: [
      { id: "lnk_npi", label: "NPI 1487326590", url: "" },
      { id: "lnk_orcid", label: "ORCID 0000-0002-8814-3376", url: "https://orcid.org" },
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
          text: "Cardiology fellow completing advanced heart failure training, board certified in Internal Medicine. Focus on cardiogenic shock and mechanical circulatory support.",
        },
      ],
    },
    {
      id: "sec_edu",
      type: "education",
      title: "Education & Training",
      order: 1,
      visible: true,
      items: [
        {
          id: "itm_edu1",
          institution: "Brigham and Women's Hospital / Harvard Medical School",
          degree: "Fellowship, Cardiovascular Disease",
          location: "Boston, MA",
          startDate: "Jul 2023",
          endDate: "Present",
          bullets: ["Advanced heart failure and transplant track. Chief Fellow, 2025–2026."],
        },
        {
          id: "itm_edu2",
          institution: "Massachusetts General Hospital",
          degree: "Residency, Internal Medicine",
          location: "Boston, MA",
          startDate: "Jul 2020",
          endDate: "Jun 2023",
          bullets: ["Chief Resident, 2022–2023. Clinical Excellence Award, Department of Medicine."],
        },
        {
          id: "itm_edu3",
          institution: "Johns Hopkins University School of Medicine",
          degree: "Doctor of Medicine (MD)",
          location: "Baltimore, MD",
          startDate: "2016",
          endDate: "2020",
          bullets: [],
        },
        {
          id: "itm_edu4",
          institution: "University of Michigan",
          degree: "B.S. Molecular Biology, summa cum laude",
          location: "Ann Arbor, MI",
          startDate: "2012",
          endDate: "2016",
          bullets: [],
        },
      ],
    },
    {
      id: "sec_lic",
      type: "certifications",
      title: "Licensure & Board Certification",
      order: 2,
      visible: true,
      items: [
        {
          id: "itm_lic1",
          name: "Board Certified, Internal Medicine",
          issuer: "American Board of Internal Medicine",
          date: "2023 (valid through 2033)",
          link: "",
        },
        {
          id: "itm_lic2",
          name: "Medical License, Massachusetts, No. 289471",
          issuer: "MA Board of Registration in Medicine",
          date: "Active through 2027",
          link: "",
        },
        {
          id: "itm_lic3",
          name: "DEA Registration; ACLS, BLS and Level II Echocardiography",
          issuer: "DEA / AHA / National Board of Echocardiography",
          date: "Current",
          link: "",
        },
      ],
    },
    {
      id: "sec_exp",
      type: "experience",
      title: "Clinical Experience",
      order: 3,
      visible: true,
      items: [
        {
          id: "itm_exp1",
          org: "Brigham and Women's Hospital",
          role: "Cardiology Fellow — Cardiac ICU and Advanced Heart Failure",
          location: "Boston, MA",
          startDate: "Jul 2023",
          endDate: "Present",
          bullets: [
            "Manage a 12-bed cardiac intensive care service, supervising two residents and four students.",
            "Co-authored the institutional cardiogenic shock protocol, adopted hospital-wide in 2025 alongside a 9% mortality reduction.",
          ],
        },
      ],
    },
    {
      id: "sec_research",
      type: "custom",
      title: "Research & Publications",
      order: 4,
      visible: true,
      items: [
        {
          id: "itm_res1",
          heading: "Risk Stratification for Durable LVAD Candidacy in Cardiogenic Shock",
          subheading: "Principal Investigator — cohort of 812 shock activations",
          dateRange: "2024 – Present",
          bullets: [],
        },
        {
          id: "itm_res2",
          heading: "Selected Publications",
          subheading: "11 peer-reviewed articles, including <i>JACC Heart Fail</i>; full list on request",
          dateRange: "2019 – 2026",
          bullets: [],
        },
      ],
    },
    {
      id: "sec_skills",
      type: "skills",
      title: "Clinical & Technical Skills",
      order: 5,
      visible: true,
      items: [
        {
          id: "itm_sk1",
          category: "Procedures",
          skills: ["Right/Left Heart Catheterization", "Temporary MCS", "TTE and TEE"],
        },
        {
          id: "itm_sk2",
          category: "Research & Systems",
          skills: ["R", "Survival Analysis", "REDCap", "Epic"],
        },
      ],
    },
  ],
};
