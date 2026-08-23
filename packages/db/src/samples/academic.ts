import type { ResumeContent } from "@repo/types";

/**
 * Academic / Researcher.
 *
 * The one sample that is genuinely a CV: search committees read for evidence of
 * an independent research programme, so publications and funding are the
 * substance and everything else is context. Grants carry amounts and role (PI
 * vs co-I), because that distinction is the whole question at tenure review.
 *
 * Trimmed to a single page, which for a CV means *selected* rather than
 * complete: two grants, two papers, and teaching folded in with service. A real
 * CV of this shape runs to five pages and is meant to — but a default that opens
 * on two sheets asks the user to delete before they can edit, and the publication
 * list is the one section that grows on its own anyway.
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
          text: "Computational models of memory consolidation, with emphasis on how sleep-dependent replay shapes generalisation. Current work combines high-density EEG with recurrent network models.",
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
          ],
        },
        {
          id: "itm_edu2",
          institution: "University of Chicago",
          degree: "B.A. Psychology, with honours",
          location: "Chicago, IL",
          startDate: "2010",
          endDate: "2014",
          bullets: [],
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
          role: "Assistant Professor, Psychological and Brain Sciences",
          location: "Amherst, MA",
          startDate: "Sep 2023",
          endDate: "Present",
          bullets: [
            "Direct a lab of two graduate students, one postdoc and five undergraduates; secured $1.9M in external funding in two years.",
          ],
        },
        {
          id: "itm_app2",
          org: "Stanford University",
          role: "Postdoctoral Fellow, Wu Tsai Neurosciences Institute",
          location: "Stanford, CA",
          startDate: "Sep 2020",
          endDate: "Aug 2023",
          bullets: [
            "Developed the recurrent network framework underlying three first-author papers, released as an open-source package.",
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
      ],
    },
    {
      id: "sec_pub",
      type: "custom",
      title: "Selected Publications",
      order: 4,
      visible: true,
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
      ],
    },
    {
      id: "sec_service",
      type: "custom",
      title: "Teaching, Talks & Service",
      order: 5,
      visible: true,
      items: [
        {
          id: "itm_srv1",
          heading: "Teaching",
          subheading:
            "Computational Cognitive Science (graduate); Introduction to Memory (240 students)",
          dateRange: "2023 – Present",
          bullets: [],
        },
        {
          id: "itm_srv2",
          heading: "Invited talks and service",
          subheading:
            "Cognitive Neuroscience Society symposium; colloquia at MIT and NYU; reviewer for <i>eLife</i>",
          dateRange: "2021 – Present",
          bullets: [],
        },
      ],
    },
  ],
};
