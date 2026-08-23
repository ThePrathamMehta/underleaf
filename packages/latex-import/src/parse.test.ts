import { describe, expect, test } from "bun:test";
import { resumeContentSchema, type EducationItem, type ExperienceItem, type ProjectItem, type SkillsItem } from "@repo/types";
import { parseLatexResume } from "./parse";

/**
 * The fixture is Jake's Resume, the most-forked resume template on Overleaf and
 * the one this fast path exists for. Abridged — two entries per section rather
 * than three — but every command and every quirk of the real thing is here: the
 * preamble that *defines* the commands the parser looks for, the `$|$` separators,
 * the `\vspace` after every row, and a commented-out bullet.
 */
const JAKES = String.raw`
\documentclass[letterpaper,11pt]{article}
\usepackage{titlesec}
\input{glyphtounicode}

%-------------------------
% Custom commands
\newcommand{\resumeItem}[1]{
  \item\small{
    {#1 \vspace{-2pt}}
  }
}
\newcommand{\resumeSubheading}[4]{
  \vspace{-2pt}\item
    \begin{tabular*}{0.97\textwidth}[t]{l@{\extracolsep{\fill}}r}
      \textbf{#1} & #2 \\
      \textit{\small#3} & \textit{\small #4} \\
    \end{tabular*}\vspace{-7pt}
}
\newcommand{\resumeProjectHeading}[2]{
    \item
    \begin{tabular*}{0.97\textwidth}{l@{\extracolsep{\fill}}r}
      \small#1 & #2 \\
    \end{tabular*}\vspace{-7pt}
}

\begin{document}

\begin{center}
    \textbf{\Huge \scshape Jake Ryan} \\ \vspace{1pt}
    \small 123-456-7890 $|$ \href{mailto:jake@su.edu}{\underline{jake@su.edu}} $|$
    \href{https://linkedin.com/in/jake}{\underline{linkedin.com/in/jake}} $|$
    \href{https://github.com/jake}{\underline{github.com/jake}}
\end{center}

\section{Education}
  \resumeSubHeadingListStart
    \resumeSubheading
      {Southwestern University}{Aug. 2018 -- May 2021}
      {Bachelor of Arts in Computer Science, Minor in Business}{Georgetown, TX}
    \resumeSubheading
      {Blinn College}{Aug. 2014 -- May 2018}
      {Associate's in Liberal Arts}{Bryan, TX}
  \resumeSubHeadingListEnd

\section{Experience}
  \resumeSubHeadingListStart
    \resumeSubheading
      {Undergraduate Research Assistant}{June 2020 -- Present}
      {Texas A\&M University}{College Station, TX}
      \resumeItemListStart
        \resumeItem{Developed a REST API using FastAPI to gather data from \textbf{4 datasets}}
        % \resumeItem{An older wording nobody deleted}
        \resumeItem{Explored ways to visualize GitHub collaboration in a classroom setting}
      \resumeItemListEnd

    \resumeSubheading
      {Information Technology Support Specialist}{Sep. 2018 -- Present}
      {Southwestern University}{Georgetown, TX}
      \resumeItemListStart
        \resumeItem{Communicate with managers to set up campus computers used on campus}
      \resumeItemListEnd
  \resumeSubHeadingListEnd

\section{Projects}
    \resumeSubHeadingListStart
      \resumeProjectHeading
          {\textbf{Gitlytics} $|$ \emph{Python, Flask, React, PostgreSQL, Docker}}{June 2020 -- Present}
          \resumeItemListStart
            \resumeItem{Developed a full-stack web application using Flask serving a REST API}
            \resumeItem{Implemented GitHub OAuth to get data from user's repositories}
          \resumeItemListEnd
      \resumeProjectHeading
          {\textbf{Simple Paintball} $|$ \emph{Spigot API, Java, Maven}}{May 2018 -- May 2020}
          \resumeItemListStart
            \resumeItem{Published plugin to 2K+ servers and 20K+ total downloads}
          \resumeItemListEnd
    \resumeSubHeadingListEnd

\section{Technical Skills}
 \begin{itemize}[leftmargin=0.15in, label={}]
    \small{\item{
     \textbf{Languages}{: Java, Python, C/C++, SQL (Postgres), JavaScript} \\
     \textbf{Frameworks}{: React, Node.js, Flask, JUnit, Material-UI} \\
     \textbf{Developer Tools}{: Git, Docker, VS Code, PyCharm} \\
    }}
 \end{itemize}

\end{document}
`;

describe("parsing Jake's Resume", () => {
  const outcome = parseLatexResume(JAKES);
  const { content } = outcome;

  test("is confident, because every section came back with entries", () => {
    expect(outcome.confident).toBe(true);
    expect(outcome.warnings).toEqual([]);
  });

  test("produces a document the schema accepts", () => {
    const parsed = resumeContentSchema.safeParse(content);
    expect(parsed.success).toBe(true);
  });

  test("reads the header the template sets in font switches and separators", () => {
    expect(content.personalInfo.name).toBe("Jake Ryan");
    expect(content.personalInfo.email).toBe("jake@su.edu");
    expect(content.personalInfo.phone).toBe("123-456-7890");
    expect(content.personalInfo.links.map((link) => link.label)).toEqual([
      "linkedin.com/in/jake",
      "github.com/jake",
    ]);
    // The mailto link is the email field, not a third profile link.
    expect(content.personalInfo.links).toHaveLength(2);
  });

  test("finds every section, typed by its heading", () => {
    expect(content.sections.map((section) => section.type)).toEqual([
      "education",
      "experience",
      "projects",
      "skills",
    ]);
    // The heading is kept as written — "Technical Skills", not "Skills".
    expect(content.sections[3]!.title).toBe("Technical Skills");
    expect(content.sections.map((section) => section.order)).toEqual([0, 1, 2, 3]);
  });

  test("tells the school from the degree, whichever order the arguments are in", () => {
    const items = content.sections[0]!.items as EducationItem[];
    expect(items).toHaveLength(2);
    expect(items[0]!.institution).toBe("Southwestern University");
    expect(items[0]!.degree).toBe("Bachelor of Arts in Computer Science, Minor in Business");
    expect(items[0]!.location).toBe("Georgetown, TX");
    expect(items[0]!.startDate).toBe("Aug. 2018");
    expect(items[0]!.endDate).toBe("May 2021");
  });

  test("tells the role from the employer, and keeps the bullets under each", () => {
    const items = content.sections[1]!.items as ExperienceItem[];
    expect(items).toHaveLength(2);
    expect(items[0]!.role).toBe("Undergraduate Research Assistant");
    expect(items[0]!.org).toBe("Texas A&amp;M University");
    expect(items[0]!.endDate).toBe("Present");

    // Two bullets, not three: the commented-out one is not content.
    expect(items[0]!.bullets).toHaveLength(2);
    expect(items[0]!.bullets[0]).toBe(
      "Developed a REST API using FastAPI to gather data from <b>4 datasets</b>",
    );
    // The second entry's bullets belong to the second entry.
    expect(items[1]!.bullets).toHaveLength(1);
    expect(items[1]!.org).toBe("Southwestern University");
  });

  test("splits a project's name from its tech list", () => {
    const items = content.sections[2]!.items as ProjectItem[];
    expect(items).toHaveLength(2);
    expect(items[0]!.name).toBe("<b>Gitlytics</b>");
    expect(items[0]!.tech).toBe("<i>Python, Flask, React, PostgreSQL, Docker</i>");
    expect(items[0]!.startDate).toBe("June 2020");
    expect(items[1]!.name).toBe("<b>Simple Paintball</b>");
  });

  test("reads skills as labelled lists", () => {
    const items = content.sections[3]!.items as SkillsItem[];
    expect(items.map((item) => item.category)).toEqual([
      "Languages",
      "Frameworks",
      "Developer Tools",
    ]);
    expect(items[0]!.skills).toEqual(["Java", "Python", "C/C++", "SQL (Postgres)", "JavaScript"]);
  });
});

describe("parsing a source it doesn't recognise", () => {
  /** Deedy-style: real `\section`s, but entries built from its own commands. */
  const DEEDY = String.raw`
\begin{document}
\namesection{Jane}{Doe}{jane@doe.com}
\section{Education}
  \subsection{Stanford University}
  \descript{BS in Computer Science}
  \location{Jun 2020 | Stanford, CA}
\section{Experience}
  \runsubsection{Google}
  \descript{| Software Engineer}
  \location{Jun 2021 - Present | Mountain View, CA}
\end{document}
`;

  test("says which sections it skipped rather than returning them empty", () => {
    const outcome = parseLatexResume(DEEDY);

    expect(outcome.confident).toBe(false);
    expect(outcome.warnings.join(" ")).toContain("Education");
    expect(outcome.warnings.join(" ")).toContain("Experience");
  });

  test("still returns a valid document, so nothing has to handle a null", () => {
    const outcome = parseLatexResume(DEEDY);
    expect(resumeContentSchema.safeParse(outcome.content).success).toBe(true);
  });

  test("survives text that is not LaTeX at all", () => {
    for (const source of ["", "   ", "just some plain text", "\\begin{document}\\end{document}"]) {
      const outcome = parseLatexResume(source);
      expect(outcome.confident).toBe(false);
      expect(resumeContentSchema.safeParse(outcome.content).success).toBe(true);
    }
  });

  test("says so when the source pulls in files that were not pasted", () => {
    const outcome = parseLatexResume(String.raw`
\begin{document}
\input{sections/experience}
\end{document}`);
    expect(outcome.warnings.join(" ")).toContain("other .tex files");
  });
});
