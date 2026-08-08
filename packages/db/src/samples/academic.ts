import type { ResumeContent } from "@repo/types";

/**
 * Academic / Researcher.
 *
 * The one sample that is genuinely a CV: search committees read for evidence of
 * an independent research programme, so publications and funding are the
 * substance and everything else is context. Grants carry amounts and role (PI
 * vs co-I), because that distinction is the whole question at tenure review.
 *
 * Uses a page break before Publications — the section that most often pushes a
 * CV onto a second sheet, and the natural place to split it.
 */
export const ACADEMIC_SAMPLE: ResumeContent = {
  personalInfo: {
    name: "Dr. Mateo Salinas",
    title: "Assistant Professor of Cognitive Science",
    email: "m.salinas@example.edu",
    phone: "(413) 555-0107",
    location: "Amherst, MA",
    links: [
      { id: "lnk_site", label: "salinaslab.example.edu", url: "https://salinaslab.example.edu" },
      { id: "lnk_scholar", label: "Google Scholar", url: "https://scholar.google.com" },
      { id: "lnk_orcid", label: "ORCID 0000-0001-7742-6650", url: "https://orcid.org" },
    ],
  },
  sections: [
    {
      id: "sec_summary",
      type: "summary",
      title: "Research Interests",
      order: 0,
      visible: true,
      items: [
        {
          id: "itm_summary",
          text: "Computational models of memory consolidation, with emphasis on how sleep-dependent replay shapes generalisation. Current work combines high-density EEG with recurrent network models to test whether replay order predicts which memories survive interference. Committed to open data and preregistration.",
        },
      ],
    },
    {
      id: "sec_edu",
      type: "education",
      title: "Education",
      order: 1,
      visible: true,
      items: [
        {
          id: "itm_edu1",
          institution: "Princeton University",
          degree: "Ph.D., Psychology and Neuroscience",
          location: "Princeton, NJ",
          startDate: "2014",
          endDate: "2020",
          bullets: [
            "Dissertation: <i>Replay Order and the Generalisation of Episodic Memory</i>. Advisor: Prof. Helena Vogt.",
            "Charlotte Elizabeth Procter Fellowship, 2019–2020.",
          ],
        },
        {
          id: "itm_edu2",
          institution: "University of Chicago",
          degree: "B.A. Psychology, with honours",
          location: "Chicago, IL",
          startDate: "2010",
          endDate: "2014",
          bullets: ["Phi Beta Kappa. Honours thesis awarded departmental distinction."],
        },
      ],
    },
    {
      id: "sec_appointments",
      type: "experience",
      title: "Academic Appointments",
      order: 2,
      visible: true,
      items: [
        {
          id: "itm_app1",
          org: "University of Massachusetts Amherst",
          role: "Assistant Professor, Department of Psychological and Brain Sciences",
          location: "Amherst, MA",
          startDate: "Sep 2023",
          endDate: "Present",
          bullets: [
            "Direct a lab of two graduate students, one postdoc and five undergraduates; secured $1.9M in external funding within the first two years.",
            "Built and maintain a 128-channel EEG suite now used by four other groups in the department.",
            "Teach Computational Cognitive Science (graduate, 18 students) and Introduction to Memory (undergraduate, 240 students).",
          ],
        },
        {
          id: "itm_app2",
          org: "Stanford University",
          role: "Postdoctoral Research Fellow, Wu Tsai Neurosciences Institute",
          location: "Stanford, CA",
          startDate: "Sep 2020",
          endDate: "Aug 2023",
          bullets: [
            "Developed the recurrent network framework underlying three first-author papers, released as an open-source package with 1,100+ installs.",
            "Mentored four rotation students, two of whom continued to doctoral programmes in the field.",
          ],
        },
      ],
    },
    {
      id: "sec_grants",
      type: "custom",
      title: "Grants & Funding",
      order: 3,
      visible: true,
      items: [
        {
          id: "itm_gr1",
          heading: "NIH R01 MH134982 — Replay Dynamics and Memory Generalisation",
          subheading: "Principal Investigator — $1,640,000 direct costs",
          dateRange: "2025 – 2030",
          bullets: [],
        },
        {
          id: "itm_gr2",
          heading: "NSF CAREER Award BCS-2418803",
          subheading: "Principal Investigator — $712,000",
          dateRange: "2024 – 2029",
          bullets: [],
        },
        {
          id: "itm_gr3",
          heading: "Sloan Research Fellowship in Neuroscience",
          subheading: "Fellow — $75,000",
          dateRange: "2026",
          bullets: [],
        },
        {
          id: "itm_gr4",
          heading: "NIH K99/R00 MH128441",
          subheading: "Principal Investigator — $249,000 (K99 phase, relinquished on appointment)",
          dateRange: "2022 – 2023",
          bullets: [],
        },
      ],
    },
    {
      id: "sec_pub",
      type: "custom",
      title: "Peer-Reviewed Publications",
      order: 4,
      visible: true,
      pageBreakBefore: true,
      items: [
        {
          id: "itm_pub1",
          heading: "Salinas M, Vogt H, Ferreira K. Replay order constrains generalisation in human episodic memory.",
          subheading: "<i>Nature Neuroscience</i>, 28(6), 1104–1117",
          dateRange: "2025",
          bullets: [],
        },
        {
          id: "itm_pub2",
          heading: "Salinas M, Okada R. A recurrent account of sleep-dependent abstraction.",
          subheading: "<i>Psychological Review</i>, 131(4), 812–840",
          dateRange: "2024",
          bullets: [],
        },
        {
          id: "itm_pub3",
          heading: "Ferreira K, Salinas M, Vogt H. Interference resolution during slow-wave sleep.",
          subheading: "<i>Journal of Neuroscience</i>, 43(31), 5620–5634",
          dateRange: "2023",
          bullets: [],
        },
        {
          id: "itm_pub4",
          heading: "Salinas M, Vogt H. Hippocampal replay and the schema-consistency effect.",
          subheading: "<i>eLife</i>, 11:e78219",
          dateRange: "2022",
          bullets: [],
        },
      ],
    },
    {
      id: "sec_talks",
      type: "custom",
      title: "Invited Talks & Conference Presentations",
      order: 5,
      visible: true,
      items: [
        {
          id: "itm_talk1",
          heading: "Cognitive Neuroscience Society Annual Meeting",
          subheading: "Invited symposium speaker, San Francisco, CA",
          dateRange: "2026",
          bullets: [],
        },
        {
          id: "itm_talk2",
          heading: "Society for Neuroscience Annual Meeting",
          subheading: "Nanosymposium talk, Chicago, IL",
          dateRange: "2025",
          bullets: [],
        },
        {
          id: "itm_talk3",
          heading: "Colloquia: MIT, NYU, University of Toronto, Max Planck Institute (Leipzig)",
          subheading: "Departmental invited talks",
          dateRange: "2024 – 2026",
          bullets: [],
        },
      ],
    },
    {
      id: "sec_service",
      type: "custom",
      title: "Teaching & Service",
      order: 6,
      visible: true,
      items: [
        {
          id: "itm_srv1",
          heading: "Ad hoc reviewer",
          subheading: "<i>Nature Human Behaviour</i>, <i>Psychological Science</i>, <i>eLife</i>, <i>Cognition</i>",
          dateRange: "2021 – Present",
          bullets: [],
        },
        {
          id: "itm_srv2",
          heading: "Departmental service",
          subheading: "Graduate admissions committee; undergraduate curriculum review",
          dateRange: "2024 – Present",
          bullets: [],
        },
      ],
    },
  ],
};
