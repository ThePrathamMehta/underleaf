import type { ResumeContent } from "@repo/types";

/**
 * Student / Entry-Level.
 *
 * Education leads, which is the one context where that is correct: with no
 * full-time history the degree, coursework and graduation date are the primary
 * screen. Projects sit above the work history because coursework and personal
 * builds demonstrate more relevant capability than a part-time job does.
 *
 * The work history is deliberately ordinary — campus jobs and retail — and
 * written for transferable evidence rather than dressed up as something it
 * isn't. Padding is the failure mode of this resume, so it stays short and
 * every line carries a number or a specific.
 */
export const STUDENT_SAMPLE: ResumeContent = {
  personalInfo: {
    name: "Sam Ferreira",
    title: "Computer Science Undergraduate — Seeking Summer 2027 Internship",
    email: "sam.ferreira@example.edu",
    phone: "(512) 555-0129",
    location: "Austin, TX",
    links: [
      { id: "lnk_gh", label: "github.com/samferreira", url: "https://github.com/samferreira" },
      { id: "lnk_li", label: "linkedin.com/in/samferreira", url: "https://linkedin.com/in/samferreira" },
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
          institution: "The University of Texas at Austin",
          degree: "B.S. Computer Science, Minor in Statistics",
          location: "Austin, TX",
          startDate: "Aug 2023",
          endDate: "Expected May 2027",
          bullets: [
            "GPA 3.81 / 4.00. Dean's List, four semesters. Recipient, Forty Acres Scholarship.",
            "Coursework: Data Structures, Algorithms, Operating Systems, Databases, Computer Networks, Linear Algebra, Probability.",
          ],
        },
      ],
    },
    {
      id: "sec_proj",
      type: "projects",
      title: "Projects",
      order: 1,
      visible: true,
      items: [
        {
          id: "itm_pr1",
          name: "Transit Board",
          tech: "TypeScript, React, Go, PostgreSQL",
          link: "github.com/samferreira/transit-board",
          startDate: "Jan 2026",
          endDate: "Present",
          bullets: [
            "Live arrival display for Austin's CapMetro network, polling the GTFS-Realtime feed and serving predictions to roughly 400 weekly users.",
            "Cut median response time from 610ms to 45ms by caching feed snapshots in Redis instead of re-parsing protobuf per request.",
          ],
        },
        {
          id: "itm_pr2",
          name: "Course Atlas",
          tech: "Python, Flask, SQLite",
          link: "github.com/samferreira/course-atlas",
          startDate: "Sep 2025",
          endDate: "Dec 2025",
          bullets: [
            "Degree-plan checker that validates a proposed schedule against prerequisite chains; used by 120 students during registration week.",
            "Built as a team of three, where I owned the prerequisite graph traversal and the conflict-detection logic.",
          ],
        },
        {
          id: "itm_pr3",
          name: "Shell (course project)",
          tech: "C, POSIX",
          link: "",
          startDate: "Mar 2025",
          endDate: "May 2025",
          bullets: [
            "Unix shell supporting pipes, redirection, job control and background processes, written for Operating Systems and graded at 100%.",
          ],
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
          org: "UT Austin Department of Computer Science",
          role: "Undergraduate Teaching Assistant, Data Structures",
          location: "Austin, TX",
          startDate: "Jan 2026",
          endDate: "Present",
          bullets: [
            "Hold weekly office hours for a 240-student course and lead a discussion section of 30.",
            "Grade programming assignments and wrote four of the automated test suites now used department-wide.",
          ],
        },
        {
          id: "itm_exp2",
          org: "Fossil Coffee",
          role: "Shift Lead",
          location: "Austin, TX",
          startDate: "Jun 2024",
          endDate: "Dec 2025",
          bullets: [
            "Opened and closed the store, handling cash reconciliation and a team of four during peak hours.",
            "Rewrote the opening checklist after repeated ticket backlogs; open-to-first-order time dropped from 22 to 14 minutes.",
          ],
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
          category: "Languages",
          skills: ["Python", "TypeScript", "Java", "C", "SQL"],
        },
        {
          id: "itm_sk2",
          category: "Tools & Frameworks",
          skills: ["React", "Node.js", "Flask", "PostgreSQL", "Git", "Docker", "Linux"],
        },
      ],
    },
    {
      id: "sec_activities",
      type: "custom",
      title: "Leadership & Activities",
      order: 4,
      visible: true,
      items: [
        {
          id: "itm_act1",
          heading: "Association for Computing Machinery, UT Austin Chapter",
          subheading: "Projects Officer",
          dateRange: "2025 – Present",
          bullets: [
            "Run a semester-long mentored build programme pairing 40 first-years with upperclass mentors.",
          ],
        },
        {
          id: "itm_act2",
          heading: "HackTX 2025",
          subheading: "Second place, 380 participants",
          dateRange: "2025",
          bullets: [],
        },
      ],
    },
  ],
};
