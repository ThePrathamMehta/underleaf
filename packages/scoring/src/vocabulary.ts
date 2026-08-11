/**
 * Local word lists.
 *
 * These are the reason half of ATS scoring costs nothing and never fails: a
 * bullet either starts with a verb from a list or it doesn't, and that answer is
 * the same offline, on the tenth run, and when the provider is down. The AI half
 * judges what a list can't — whether a quantified bullet is *actually* about an
 * outcome — and is additive on top.
 */

/**
 * Strong openers. Past tense, because a bullet describes something that happened;
 * the present-tense forms a current role legitimately uses are matched by
 * stemming in `startsWithActionVerb`, not by listing both.
 */
export const ACTION_VERBS = new Set([
  "accelerated", "achieved", "acquired", "adapted", "added", "addressed", "advanced", "advised",
  "advocated", "analyzed", "analysed", "architected", "assembled", "assessed", "audited",
  "authored", "automated", "balanced", "benchmarked", "boosted", "briefed", "budgeted", "built",
  "cached", "calculated", "captured", "centralized", "chaired", "championed", "clarified",
  "coached", "codified", "collaborated", "compiled", "completed", "composed", "computed",
  "conceived", "condensed", "conducted", "configured", "connected", "consolidated", "constructed",
  "consulted", "containerized", "converted", "coordinated", "corrected", "created", "cultivated",
  "curated", "cut", "debugged", "decreased", "defined", "delivered", "demonstrated", "deployed",
  "designed", "detected", "determined", "developed", "devised", "diagnosed", "directed",
  "documented", "doubled", "drafted", "drove", "earned", "edited", "eliminated", "enabled",
  "encouraged", "enforced", "engineered", "enhanced", "ensured", "established", "estimated",
  "evaluated", "examined", "executed", "expanded", "expedited", "explained", "extended",
  "extracted", "facilitated", "finalized", "forecast", "forecasted", "formalized", "formulated",
  "founded", "generated", "grew", "guided", "halved", "handled", "headed", "hired", "identified",
  "implemented", "improved", "increased", "influenced", "informed", "initiated", "innovated",
  "inspected", "installed", "instituted", "instructed", "integrated", "interpreted", "interviewed",
  "introduced", "invented", "investigated", "launched", "led", "leveraged", "localized",
  "maintained", "managed", "mapped", "marketed", "measured", "mediated", "mentored", "merged",
  "migrated", "minimized", "mobilized", "modeled", "modelled", "modernized", "modified",
  "monitored", "motivated", "negotiated", "onboarded", "operated", "optimized", "orchestrated",
  "organized", "originated", "outlined", "overhauled", "oversaw", "parallelized", "partnered",
  "penetrated", "performed", "persuaded", "piloted", "pioneered", "planned", "prepared",
  "presented", "prevented", "prioritized", "processed", "produced", "programmed", "projected",
  "promoted", "proposed", "prototyped", "proved", "provided", "published", "purchased", "queried",
  "raised", "ran", "rated", "rearchitected", "rebuilt", "recommended", "reconciled", "recorded",
  "recovered", "recruited", "redesigned", "reduced", "refactored", "refined", "regulated",
  "reinforced", "released", "remodeled", "removed", "reorganized", "repaired", "replaced",
  "reported", "represented", "researched", "resolved", "restored", "restructured", "revamped",
  "reviewed", "revised", "revitalized", "rewrote", "saved", "scaled", "scheduled", "screened",
  "scripted", "secured", "segmented", "selected", "shaped", "shipped", "simplified", "simulated",
  "solved", "sourced", "spearheaded", "specified", "sponsored", "staffed", "standardized",
  "steered", "streamlined", "strengthened", "structured", "studied", "submitted", "succeeded",
  "supervised", "supported", "surveyed", "sustained", "synthesized", "systematized", "targeted",
  "taught", "tested", "tightened", "tracked", "trained", "transferred", "transformed",
  "translated", "trimmed", "tripled", "troubleshot", "tuned", "unified", "updated", "upgraded",
  "validated", "verified", "visualized", "won", "wrote",
]);

/**
 * Openers that describe a job description rather than a contribution.
 *
 * "Responsible for testing" and "Tested" contain the same fact; only the second
 * says the person did it. These are flagged specifically, because "no action
 * verb" is unhelpful next to a bullet that opens with a phrase the writer
 * plainly chose on purpose.
 */
export const WEAK_OPENERS = [
  "responsible for",
  "responsibilities included",
  "tasked with",
  "duties included",
  "helped with",
  "worked on",
  "worked with",
  "involved in",
  "participated in",
  "assisted with",
  "in charge of",
  "part of a team",
  "hard worker",
  "team player",
  "go-getter",
  "detail-oriented",
  "self-starter",
  "think outside the box",
];

/**
 * Section headings an ATS is known to recognize.
 *
 * Parsers key off literal headings, so a section called "Where I've Been"
 * renders beautifully and files under nothing. Matched loosely — "Work
 * Experience" contains "experience".
 */
export const STANDARD_HEADINGS: Record<string, string[]> = {
  summary: ["summary", "profile", "objective", "about"],
  experience: ["experience", "employment", "work history", "professional background"],
  education: ["education", "academic"],
  skills: ["skills", "technical skills", "competencies", "technologies"],
  projects: ["projects", "portfolio", "selected work"],
  certifications: ["certifications", "certificates", "licenses", "credentials", "awards"],
  custom: [],
};

/**
 * Vocabulary that identifies a token as a real skill rather than prose.
 *
 * Used by JD keyword extraction to lift terms that look like tools, and by the
 * ATS keyword check to notice that a resume names none. Not exhaustive by
 * design — frequency analysis catches the long tail, and this list only has to
 * be right about what it does contain.
 */
export const SKILL_TERMS = new Set([
  // Languages
  "javascript", "typescript", "python", "java", "kotlin", "swift", "go", "golang", "rust", "ruby",
  "php", "c", "c++", "c#", "scala", "elixir", "erlang", "haskell", "clojure", "perl", "r", "matlab",
  "sql", "bash", "shell", "powershell", "solidity", "dart", "lua", "objective-c", "vba", "sas",
  // Web and app frameworks
  "react", "next.js", "nextjs", "vue", "angular", "svelte", "solid", "remix", "astro", "jquery",
  "node", "node.js", "nodejs", "express", "nestjs", "fastify", "deno", "bun", "django", "flask",
  "fastapi", "rails", "laravel", "spring", "hibernate", "dotnet", ".net", "asp.net", "blazor",
  "flutter", "react-native", "swiftui", "android", "ios", "electron", "tailwind", "bootstrap",
  "sass", "webpack", "vite", "rollup", "babel", "graphql", "trpc", "rest", "grpc", "websockets",
  "html", "css", "wcag", "accessibility",
  // Data and storage
  "postgres", "postgresql", "mysql", "mariadb", "sqlite", "mongodb", "redis", "elasticsearch",
  "opensearch", "cassandra", "dynamodb", "neo4j", "clickhouse", "snowflake", "bigquery",
  "redshift", "databricks", "kafka", "rabbitmq", "sqs", "airflow", "dbt", "spark", "hadoop",
  "hive", "flink", "prisma", "sequelize", "typeorm", "sqlalchemy", "etl", "olap", "oltp",
  "data-warehouse", "data-modeling",
  // Cloud and platform
  "aws", "azure", "gcp", "ec2", "s3", "lambda", "cloudfront", "route53", "rds", "eks", "ecs",
  "fargate", "docker", "kubernetes", "k8s", "helm", "terraform", "pulumi", "ansible", "puppet",
  "chef", "jenkins", "circleci", "github-actions", "gitlab", "argocd", "vercel", "netlify",
  "heroku", "cloudflare", "nginx", "apache", "linux", "unix", "serverless", "microservices",
  "ci/cd", "cicd", "devops", "sre", "observability", "prometheus", "grafana", "datadog",
  "sentry", "opentelemetry", "splunk",
  // ML and analytics
  "machine-learning", "ml", "ai", "llm", "nlp", "pytorch", "tensorflow", "keras", "scikit-learn",
  "sklearn", "pandas", "numpy", "scipy", "xgboost", "huggingface", "langchain", "opencv",
  "tableau", "powerbi", "looker", "excel", "statistics", "regression", "forecasting",
  "a/b-testing", "experimentation",
  // Security
  "oauth", "oauth2", "saml", "jwt", "sso", "encryption", "tls", "pki", "owasp", "penetration",
  "pentesting", "siem", "iam", "zero-trust", "soc2", "gdpr", "hipaa", "pci",
  // Practice and process
  "agile", "scrum", "kanban", "jira", "confluence", "git", "github", "tdd", "bdd",
  "unit-testing", "integration-testing", "cypress", "playwright", "selenium", "jest", "vitest",
  "pytest", "junit", "mocha", "storybook", "figma", "sketch", "adobe", "photoshop",
  "illustrator", "indesign", "premiere", "aftereffects", "blender", "autocad", "solidworks",
  "revit", "salesforce", "hubspot", "marketo", "sap", "oracle", "quickbooks", "netsuite",
  "workday", "servicenow", "zendesk", "notion", "airtable", "wordpress", "shopify", "seo",
  "sem", "ppc", "ga4", "analytics", "crm", "erp", "gaap", "ifrs", "audit", "reconciliation",
  "forecast", "budgeting", "valuation", "underwriting", "litigation", "compliance",
  "contracts", "due-diligence", "phlebotomy", "triage", "ehr", "epic", "cerner", "hl7",
  "icd-10", "cpt", "acls", "bls", "cpr",
]);

/**
 * Phrases that mark a line in a posting as a hard requirement.
 *
 * Terms found near one of these are weighted up, so "Kubernetes" in the
 * requirements list outranks "Kubernetes" in the closing paragraph about the
 * team's tech blog.
 */
export const REQUIREMENT_CUES = [
  "required", "requirements", "must have", "must-have", "you have", "you'll need", "you will need",
  "qualifications", "minimum", "essential", "we expect", "proficiency", "proficient", "expertise",
  "strong knowledge", "hands-on", "demonstrated", "experience with", "experience in",
];
