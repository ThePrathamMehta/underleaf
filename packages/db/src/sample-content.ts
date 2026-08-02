import type { ResumeContent } from "@repo/types";

/**
 * One realistic sample document, reused by every seeded template. Sharing it is
 * deliberate: it proves each template renders the *same* content correctly,
 * which is the contract templates have to honour.
 */
export const SAMPLE_CONTENT: ResumeContent = {
  personalInfo: {
    name: "Avery Chen",
    title: "Senior Software Engineer",
    email: "avery.chen@example.com",
    phone: "(415) 555-0138",
    location: "San Francisco, CA",
    links: [
      { id: "lnk_site", label: "averychen.dev", url: "https://averychen.dev" },
      { id: "lnk_gh", label: "github.com/averychen", url: "https://github.com/averychen" },
      { id: "lnk_li", label: "linkedin.com/in/averychen", url: "https://linkedin.com/in/averychen" },
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
          text: "Backend-leaning full-stack engineer with seven years building high-throughput data infrastructure. Led the migration of a monolithic billing service to event-driven microservices, cutting p99 latency by 68%. Comfortable owning a system from schema design through on-call.",
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
          org: "Meridian Data",
          role: "Senior Software Engineer",
          location: "San Francisco, CA",
          startDate: "Mar 2022",
          endDate: "Present",
          bullets: [
            "Designed and shipped an event-sourced ledger processing 40M transactions/day, replacing a batch pipeline and reducing settlement lag from 6 hours to under 90 seconds.",
            "Cut infrastructure spend $310K/year by introducing tiered storage and rewriting the hottest query path to use covering indexes.",
            "Led a team of four through a zero-downtime Postgres 12 to 16 migration across 22 services.",
            "Established the service-level objective review process now used by all eight platform teams.",
          ],
        },
        {
          id: "itm_exp2",
          org: "Northwind Systems",
          role: "Software Engineer",
          location: "Portland, OR",
          startDate: "Jul 2019",
          endDate: "Feb 2022",
          bullets: [
            "Built the multi-tenant permissions layer backing 1,200 enterprise accounts, with row-level isolation enforced in Postgres.",
            "Reduced median API response time 44% by replacing N+1 ORM access patterns with batched data loaders.",
            "Introduced contract testing between the web client and six backend services, eliminating a recurring class of deploy-time breakages.",
          ],
        },
        {
          id: "itm_exp3",
          org: "Tessellate Labs",
          role: "Software Engineer, Intern to Full-time",
          location: "Remote",
          startDate: "Jun 2018",
          endDate: "Jun 2019",
          bullets: [
            "Shipped the customer-facing analytics dashboard used by 80% of active accounts within the first quarter of launch.",
            "Automated the release pipeline, taking deploys from a 40-minute manual checklist to a 6-minute single command.",
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
          institution: "University of Washington",
          degree: "B.S. Computer Science",
          location: "Seattle, WA",
          startDate: "2014",
          endDate: "2018",
          bullets: ["Graduated cum laude. Teaching assistant for Databases and Distributed Systems."],
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
          skills: ["TypeScript", "Go", "Python", "SQL", "Rust"],
        },
        {
          id: "itm_sk2",
          category: "Infrastructure",
          skills: ["PostgreSQL", "Kafka", "Redis", "Kubernetes", "Terraform", "AWS"],
        },
        {
          id: "itm_sk3",
          category: "Frameworks",
          skills: ["Node.js", "React", "Next.js", "gRPC", "Express"],
        },
      ],
    },
    {
      id: "sec_proj",
      type: "projects",
      title: "Projects",
      order: 4,
      visible: true,
      items: [
        {
          id: "itm_pr1",
          name: "Sifter",
          tech: "Go, ClickHouse, React",
          link: "github.com/averychen/sifter",
          startDate: "2023",
          endDate: "Present",
          bullets: [
            "Open-source log search engine ingesting 200GB/day on a single node; 900+ GitHub stars.",
            "Implemented a custom inverted index that answers typical queries in under 50ms.",
          ],
        },
        {
          id: "itm_pr2",
          name: "Kettle",
          tech: "Rust, WebAssembly",
          link: "github.com/averychen/kettle",
          startDate: "2021",
          endDate: "2022",
          bullets: [
            "Browser-native CSV transformation tool handling 1M-row files entirely client-side with no server round-trip.",
          ],
        },
      ],
    },
    {
      id: "sec_cert",
      type: "certifications",
      title: "Certifications",
      order: 5,
      visible: false,
      items: [
        {
          id: "itm_ct1",
          name: "AWS Certified Solutions Architect – Professional",
          issuer: "Amazon Web Services",
          date: "2023",
          link: "",
        },
      ],
    },
  ],
};
