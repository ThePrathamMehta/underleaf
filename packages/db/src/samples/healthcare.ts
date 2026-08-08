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
 * Runs long deliberately — a two-page CV is expected here, and the second page
 * is where research and presentations live.
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
          text: "Cardiology fellow completing advanced heart failure training, board certified in Internal Medicine. Clinical focus on cardiogenic shock and mechanical circulatory support, with an active research interest in risk stratification for LVAD candidacy. Eleven peer-reviewed publications and a K23 application under preparation.",
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
          bullets: ["Advanced heart failure and transplant cardiology track. Chief Fellow, 2025–2026."],
        },
        {
          id: "itm_edu2",
          institution: "Massachusetts General Hospital",
          degree: "Residency, Internal Medicine",
          location: "Boston, MA",
          startDate: "Jul 2020",
          endDate: "Jun 2023",
          bullets: ["Chief Resident, 2022–2023. Recipient, Department of Medicine Clinical Excellence Award."],
        },
        {
          id: "itm_edu3",
          institution: "Johns Hopkins University School of Medicine",
          degree: "Doctor of Medicine (MD)",
          location: "Baltimore, MD",
          startDate: "2016",
          endDate: "2020",
          bullets: ["Alpha Omega Alpha. Distinction in Research for work on myocardial fibrosis imaging."],
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
          name: "Medical License, Commonwealth of Massachusetts, No. 289471",
          issuer: "Massachusetts Board of Registration in Medicine",
          date: "Active through 2027",
          link: "",
        },
        {
          id: "itm_lic3",
          name: "DEA Registration, Active",
          issuer: "U.S. Drug Enforcement Administration",
          date: "Through 2027",
          link: "",
        },
        {
          id: "itm_lic4",
          name: "ACLS, BLS and Level II Echocardiography (NBE)",
          issuer: "AHA / National Board of Echocardiography",
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
            "Manage a 12-bed cardiac intensive care service, supervising two residents and four students on a rotating basis.",
            "Performed or assisted in 340 diagnostic catheterizations and 95 right-heart studies; independently credentialed for temporary mechanical support device placement.",
            "Co-authored the institutional cardiogenic shock team protocol, adopted hospital-wide in 2025 and associated with a 9% reduction in 30-day mortality across the first 140 activations.",
            "Serve on the multidisciplinary transplant selection committee, presenting candidacy assessments for LVAD and orthotopic heart transplant.",
          ],
        },
        {
          id: "itm_exp2",
          org: "Massachusetts General Hospital",
          role: "Chief Resident, Internal Medicine",
          location: "Boston, MA",
          startDate: "Jul 2022",
          endDate: "Jun 2023",
          bullets: [
            "Directed scheduling, didactics and evaluation for a residency of 168 house officers.",
            "Led a quality improvement initiative that cut inappropriate telemetry use 31%, saving an estimated 1,400 monitored bed-days annually.",
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
          subheading: "Principal Investigator — institutional K23 application in preparation",
          dateRange: "2024 – Present",
          bullets: [
            "Retrospective cohort of 812 shock activations; derived and internally validated a nine-variable model outperforming INTERMACS profile alone (AUC 0.81 vs 0.68).",
          ],
        },
        {
          id: "itm_res2",
          heading: "Selected Publications",
          subheading: "11 peer-reviewed articles; full list available on request",
          dateRange: "2019 – 2026",
          bullets: [
            "Raghunathan P, Alvarez M, Chen L, et al. Early mechanical support in cardiogenic shock: a propensity-matched analysis. <i>JACC Heart Fail</i>. 2025;13(4):412–423.",
            "Raghunathan P, Whitmore S. Myocardial fibrosis burden and arrhythmic risk in non-ischemic cardiomyopathy. <i>Circ Cardiovasc Imaging</i>. 2023;16(9):e015228.",
          ],
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
          skills: ["Right/Left Heart Catheterization", "Temporary MCS", "TTE and TEE", "Pericardiocentesis", "Central Access"],
        },
        {
          id: "itm_sk2",
          category: "Clinical Systems",
          skills: ["Epic", "Cerner", "Syngo Dynamics", "REDCap"],
        },
        {
          id: "itm_sk3",
          category: "Research",
          skills: ["R", "Stata", "Survival Analysis", "IRB Protocol Development", "Grant Writing"],
        },
      ],
    },
  ],
};
