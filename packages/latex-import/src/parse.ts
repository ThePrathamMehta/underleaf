import {
  makeId,
  type CertificationItem,
  type CustomItem,
  type EducationItem,
  type ExperienceItem,
  type PersonalInfo,
  type ProjectItem,
  type ResumeContent,
  type Section,
  type SectionType,
  type SkillsItem,
  type SummaryItem,
} from "@repo/types";
import { detex, detexPlain, hasWords, readGroup, readGroups, stripComments } from "./detex";

/**
 * The deterministic half of LaTeX import.
 *
 * It recognises the shape of the resume templates people actually paste — Jake's
 * Resume above all, which is the most-forked resume template on Overleaf — by
 * pattern-matching the three commands that carry all of its structure:
 * `\section`, `\resumeSubheading` and `\resumeItem`.
 *
 * When it recognises a document it is *exact*: every field is a span of the
 * source, so nothing can be invented. When it doesn't, it says so rather than
 * guessing, and the caller sends the source to a model instead. That honesty is
 * the whole point of the split — a deterministic miss leaves a field empty, where
 * a model's miss can fill it with something plausible and wrong.
 */

/** Sectioning commands, across the templates that don't use plain `\section`. */
const SECTION_COMMANDS = new Set([
  "section",
  "cvsection",
  "resumeSection",
  "rSection",
  "sectionTitle",
]);

/** Entry heading commands, and how many arguments each takes. */
const HEADING_COMMANDS: Record<string, number> = {
  resumeSubheading: 4,
  resumeProjectHeading: 2,
  resumeSubSubheading: 2,
};

/**
 * Titles to section types.
 *
 * Ordered, and matched on the first hit: "Technical Skills" has to reach `skills`
 * before anything else claims it. Anything unmatched becomes a custom section
 * with its title intact, which is the right answer for the "Leadership",
 * "Coursework" and "Publications" headings that a fixed list will never cover.
 */
const SECTION_ALIASES: [RegExp, SectionType][] = [
  [/summary|objective|profile|about\s*me|overview/i, "summary"],
  [/skills|technolog|competenc|expertise|proficien|languages\s*&|tool/i, "skills"],
  [/experience|employment|work\s*history|career|internship/i, "experience"],
  [/education|academic|schooling|qualification/i, "education"],
  [/projects?|portfolio/i, "projects"],
  [/certificat|licen[cs]e|accreditation|awards?|honors?|honours?|achievements?/i, "certifications"],
];

/** Words that mark a field as a job title rather than an employer. */
const ROLE_WORDS =
  /\b(engineer|developer|intern|manager|analyst|scientist|designer|consultant|lead|director|architect|administrator|specialist|assistant|associate|officer|founder|head|president|coordinator|technician|researcher|programmer|strategist|writer|editor|teacher|instructor|professor|freelance|contractor|vp|cto|ceo|coo)\b/i;

/** Words that mark a field as an organisation rather than a job title. */
const ORG_WORDS =
  /\b(inc|llc|ltd|llp|plc|gmbh|corp|corporation|company|technologies|technology|systems|solutions|labs|laboratories|university|college|school|institute|hospital|bank|group|partners|studios?|foundation|agency|consulting|ventures|capital|media|networks|software|digital)\b\.?/i;

/** Words that mark a field as a qualification rather than an institution. */
const DEGREE_WORDS =
  /\b(bachelors?|masters?|b\.?s\.?c?|b\.?a\.?|m\.?s\.?c?|m\.?a\.?|mba|ph\.?d|doctorate|diploma|certificate|associate|b\.?tech|m\.?tech|b\.?e\.?|m\.?e\.?|honou?rs|major|minor)\b/i;

/** Words that mark a field as a school rather than a qualification. */
const SCHOOL_WORDS = /\b(university|college|school|institute|academy|polytechnic)\b/i;

/** What the parser managed, and how far it trusts itself. */
export interface LatexParseOutcome {
  /** Everything extracted. Always a whole document, however thin. */
  content: ResumeContent;
  /**
   * Whether the structure was recognised well enough to skip the model.
   *
   * False does not mean nothing was extracted — `content` still holds whatever
   * was found, which is what the caller falls back to if the model is
   * unavailable too.
   */
  confident: boolean;
  /** Specific things that were skipped or left empty, in the user's words. */
  warnings: string[];
}

/** Trims a field to the length its schema allows, on a word boundary if it can. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return space > max * 0.6 ? cut.slice(0, space) : cut;
}

/** Every `\href{url}{label}` and `\url{url}` in a fragment, in order. */
function collectLinks(source: string): { url: string; label: string }[] {
  const found: { url: string; label: string }[] = [];
  const pattern = /\\(href|url)\s*\{/g;

  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const url = readGroup(source, match.index + match[0].length - 1);
    if (!url) continue;

    const label = match[1] === "href" ? readGroup(source, url.end) : null;
    found.push({
      // URLs escape the characters LaTeX reserves; putting them back is the one
      // place a raw unescape is right, since a URL has no markup in it.
      url: url.text.trim().replace(/\\([%#&_~{}$])/g, "$1").replace(/\s+/g, ""),
      label: label ? detexPlain(label.text) : "",
    });
    pattern.lastIndex = label ? label.end : url.end;
  }

  return found;
}

/** The document body, so the preamble's `\newcommand` definitions can't be read
 *  as content — they contain the very commands the parser looks for. */
function documentBody(tex: string): string {
  const start = tex.indexOf("\\begin{document}");
  const body = start === -1 ? tex : tex.slice(start + "\\begin{document}".length);
  const end = body.indexOf("\\end{document}");
  return end === -1 ? body : body.slice(0, end);
}

/** Every sectioning command in the body, with the span of text under each. */
function splitSections(body: string): { title: string; body: string }[] {
  const marks: { title: string; from: number; at: number }[] = [];
  const pattern = /\\([a-zA-Z]+)\*?\s*\{/g;

  for (let match = pattern.exec(body); match; match = pattern.exec(body)) {
    if (!SECTION_COMMANDS.has(match[1]!)) continue;
    const group = readGroup(body, match.index + match[0].length - 1);
    if (!group) continue;
    marks.push({ title: group.text, from: group.end, at: match.index });
    pattern.lastIndex = group.end;
  }

  return marks.map((mark, index) => ({
    title: mark.title,
    body: body.slice(mark.from, marks[index + 1]?.at ?? body.length),
  }));
}

function classify(title: string): SectionType {
  for (const [pattern, type] of SECTION_ALIASES) if (pattern.test(title)) return type;
  return "custom";
}

/** A heading command's arguments, plus the bullets that follow it. */
interface RawEntry {
  command: string;
  /** Raw LaTeX, one per argument — detexed at the point of use, since some are
   *  split on a separator first. */
  fields: string[];
  bullets: string[];
}

/** `\resumeItem{...}` and plain `\item` bullets in a span of a section. */
function collectBullets(chunk: string): string[] {
  const items: string[] = [];
  const pattern = /\\resumeItem\s*\{/g;

  for (let match = pattern.exec(chunk); match; match = pattern.exec(chunk)) {
    const group = readGroup(chunk, match.index + match[0].length - 1);
    if (!group) continue;
    items.push(detex(group.text));
    pattern.lastIndex = group.end;
  }
  if (items.length) return items.filter(Boolean);

  // No `\resumeItem`, so fall back to `\item` — which most other templates use,
  // and which runs to the next item or the end of its list.
  const plain = /\\item\b/g;
  const starts: number[] = [];
  for (let match = plain.exec(chunk); match; match = plain.exec(chunk)) {
    starts.push(match.index + match[0].length);
  }

  return starts
    .map((start, index) => {
      const next = starts[index + 1];
      const to = next === undefined ? chunk.length : next - "\\item".length;
      const stop = chunk.slice(start, to).search(/\\end\s*\{/);
      return detex(chunk.slice(start, stop === -1 ? to : start + stop));
    })
    .filter(Boolean);
}

/** Every entry heading in a section, with its bullets. */
function scanEntries(body: string): RawEntry[] {
  const marks: { command: string; fields: string[]; from: number; at: number }[] = [];
  const pattern = /\\([a-zA-Z]+)\s*\{/g;

  for (let match = pattern.exec(body); match; match = pattern.exec(body)) {
    const arity = HEADING_COMMANDS[match[1]!];
    if (arity === undefined) continue;

    const groups = readGroups(body, match.index + match[0].length - 1, arity);
    if (!groups) continue;
    marks.push({ command: match[1]!, fields: groups.texts, from: groups.end, at: match.index });
    pattern.lastIndex = groups.end;
  }

  return marks.map((mark, index) => ({
    command: mark.command,
    fields: mark.fields,
    bullets: collectBullets(body.slice(mark.from, marks[index + 1]?.at ?? body.length)),
  }));
}

/**
 * A date column as the two fields a resume entry holds.
 *
 * A single date with no range goes in `startDate`, because the renderer prints
 * `start || end` when one side is missing — so it reads as written either way.
 */
function splitDates(raw: string): { startDate: string; endDate: string } {
  const text = detexPlain(raw);
  if (!text) return { startDate: "", endDate: "" };

  const parts = text
    .split(/\s*[–—]\s*|\s+--?\s+|\s+to\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length >= 2
    ? { startDate: clip(parts[0]!, 60), endDate: clip(parts[parts.length - 1]!, 60) }
    : { startDate: clip(text, 60), endDate: "" };
}

/** Splits a field on the vertical bars and dots templates use inside one
 *  argument: `\textbf{Gitlytics} $|$ \emph{Python, Flask}`. */
function splitOnBar(raw: string): string[] {
  return raw
    .split(/\$\s*\\?(?:\||mid|vert|textbar|cdot|bullet)\s*\$|\\(?:textbar|textbullet)\b|\|/)
    .map((part) => part.trim())
    .filter((part) => hasWords(part));
}

/** Which of two fields reads more like a job title than an employer. */
function roleScore(text: string): number {
  return (ROLE_WORDS.test(text) ? 1 : 0) - (ORG_WORDS.test(text) ? 1 : 0);
}

function experienceItem(entry: RawEntry): ExperienceItem {
  const primary = detex(entry.fields[0] ?? "");
  const secondary = detex(entry.fields[2] ?? "");

  /**
   * Jake's template puts the role first and the employer second, and that is the
   * default. But the same four-argument command is just as often filled in the
   * other order, and the two are told apart by what the words *are* rather than
   * where they sit — so the fields swap when the evidence points the other way.
   */
  const flip = roleScore(secondary) > roleScore(primary);

  return {
    id: makeId("item"),
    role: clip(flip ? secondary : primary, 960),
    org: clip(flip ? primary : secondary, 960),
    location: clip(detex(entry.fields[3] ?? ""), 720),
    ...splitDates(entry.fields[1] ?? ""),
    bullets: entry.bullets.slice(0, 12).map((bullet) => clip(bullet, 3600)),
  };
}

function educationItem(entry: RawEntry): EducationItem {
  const primary = detex(entry.fields[0] ?? "");
  const secondary = detex(entry.fields[2] ?? "");

  // Same argument order, read for a school and a qualification instead. Either
  // signal on its own is enough: a "Bachelor of Arts" first, or a "University"
  // second, both mean the two are the other way round.
  const flip =
    (DEGREE_WORDS.test(primary) && !DEGREE_WORDS.test(secondary)) ||
    (SCHOOL_WORDS.test(secondary) && !SCHOOL_WORDS.test(primary));

  return {
    id: makeId("item"),
    institution: clip(flip ? secondary : primary, 960),
    degree: clip(flip ? primary : secondary, 960),
    location: clip(detex(entry.fields[3] ?? ""), 720),
    ...splitDates(entry.fields[1] ?? ""),
    bullets: entry.bullets.slice(0, 12).map((bullet) => clip(bullet, 3600)),
  };
}

function projectItem(entry: RawEntry): ProjectItem {
  // `\resumeProjectHeading` packs the name and the tech list into one argument,
  // separated by a bar; `\resumeSubheading` gives them their own.
  const parts = splitOnBar(entry.fields[0] ?? "");
  const name = parts[0] ?? entry.fields[0] ?? "";
  const tech =
    parts.length > 1
      ? parts.slice(1).join(", ")
      : (entry.fields[2] ?? "");

  return {
    id: makeId("item"),
    name: clip(detex(name), 960),
    tech: clip(detex(tech), 1200),
    link: clip(collectLinks(entry.fields[0] ?? "")[0]?.url ?? "", 300),
    ...splitDates(entry.fields[1] ?? ""),
    bullets: entry.bullets.slice(0, 12).map((bullet) => clip(bullet, 3600)),
  };
}

function certificationItem(entry: RawEntry): CertificationItem {
  return {
    id: makeId("item"),
    name: clip(detex(entry.fields[0] ?? ""), 960),
    issuer: clip(detex(entry.fields[2] ?? ""), 960),
    date: splitDates(entry.fields[1] ?? "").startDate,
    link: clip(collectLinks(entry.fields[0] ?? "")[0]?.url ?? "", 300),
  };
}

function customItem(entry: RawEntry): CustomItem {
  return {
    id: makeId("item"),
    heading: clip(detex(entry.fields[0] ?? ""), 960),
    subheading: clip(detex(entry.fields[2] ?? ""), 960),
    dateRange: splitDates(entry.fields[1] ?? "").startDate,
    bullets: entry.bullets.slice(0, 12).map((bullet) => clip(bullet, 3600)),
  };
}

/**
 * A skills section, which has no entry headings at all — it is a handful of
 * labelled lines, and the label is a `\textbf` run at the start of each.
 *
 * Split on the row breaks and list items that separate those lines, then read
 * each as "label: comma-separated list". A line with no label still yields its
 * skills; a line with no commas becomes a one-item list, which is what a resume
 * that writes its skills as prose deserves.
 */
function skillsItems(body: string): SkillsItem[] {
  const lines = body
    .split(/\\\\|\\item\b|\n\s*\n/)
    .map((line) => detex(line))
    .filter((line) => hasWords(line));

  return lines.slice(0, 30).map((line) => {
    const labelled = /^<b>\s*(.*?)\s*<\/b>\s*:?\s*(.*)$/s.exec(line);
    const category = labelled ? labelled[1]!.replace(/:$/, "").trim() : "";
    const rest = (labelled ? labelled[2]! : line).replace(/^[:·•|\s]+/, "");

    return {
      id: makeId("item"),
      category: clip(category, 480),
      skills: rest
        .split(/[,;·•|]|\s{2,}/)
        .map((skill) => detexPlain(skill).trim())
        .filter(Boolean)
        .slice(0, 40)
        .map((skill) => clip(skill, 80)),
    };
  });
}

/** A section's items, by type, from the entries and bullets found in its body. */
function buildItems(type: SectionType, body: string, entries: RawEntry[]) {
  if (type === "skills") return skillsItems(body);

  if (type === "summary") {
    // The whole section as one paragraph — bullets included, since a summary
    // written as a list still reads as a summary once it's joined up.
    const text = detex(body);
    const items: SummaryItem[] = text ? [{ id: makeId("item"), text: clip(text, 12000) }] : [];
    return items;
  }

  if (entries.length === 0) {
    // No headings: whatever bullets or prose the section does have, kept as one
    // entry rather than dropped. An empty result here is what marks the section
    // as a miss and sends the document to the model.
    const bullets = collectBullets(body);
    const loose = bullets.length ? bullets : hasWords(body) ? [detex(body)] : [];
    if (loose.length === 0) return [];
    entries = [{ command: "", fields: [], bullets: loose }];
  }

  switch (type) {
    case "experience":
      return entries.map(experienceItem);
    case "education":
      return entries.map(educationItem);
    case "projects":
      return entries.map(projectItem);
    case "certifications":
      return entries.flatMap((entry) =>
        // A certifications section is usually a bare list, and each line is its
        // own certificate rather than a bullet under one.
        entry.fields.length === 0
          ? entry.bullets.map((name) => ({
              id: makeId("item"),
              name: clip(name, 960),
              issuer: "",
              date: "",
              link: "",
            }))
          : [certificationItem(entry)],
      );
    default:
      return entries.map(customItem);
  }
}

/**
 * The header: everything above the first section, which is where every template
 * puts the name and the contact line.
 */
function parsePersonalInfo(header: string): { info: PersonalInfo; found: string[] } {
  const found: string[] = [];

  // A name in a command that says so, first — moderncv's `\name{First}{Last}`
  // and altacv's one-argument form both mean it literally.
  let name = "";
  const declared = /\\(?:name|candidate|myname)\s*\{/.exec(header);
  if (declared) {
    const first = readGroup(header, declared.index + declared[0].length - 1);
    const second = first ? readGroup(header, first.end) : null;
    name = detex([first?.text ?? "", second?.text ?? ""].filter(Boolean).join(" "));
  }

  // Otherwise the first bold run, which is how Jake's and its forks set a name:
  // `\textbf{\Huge \scshape Jake Ryan}`.
  if (!name) {
    const bold = /\\textbf\s*\{/.exec(header);
    const group = bold ? readGroup(header, bold.index + bold[0].length - 1) : null;
    const text = group ? detexPlain(group.text) : "";
    if (text && !text.includes("@") && text.length <= 80) name = text;
  }

  // Or a size command with the name written straight after it.
  if (!name) {
    const sized = /\\(?:Huge|huge|LARGE|Large)\b((?:\s*\\[a-zA-Z]+)*)([^\\{}$\n]+)/.exec(header);
    if (sized) name = detexPlain(sized[2] ?? "").trim();
  }

  if (name) found.push("name");

  const email = /[\w.+-]+@[\w-]+\.[\w.-]*[\w]/.exec(detexPlain(header))?.[0] ?? "";
  if (email) found.push("email");

  // The contact line, split the way the source separates it, so a phone number
  // can't absorb the date range or the address next to it.
  const pieces = header
    .split(/\\\\|\$\s*\\?(?:\||mid|vert|cdot|bullet)\s*\$|\\textbar\b|\n\s*\n/)
    .map((piece) => detexPlain(piece))
    .filter(Boolean);

  const phone =
    pieces.find((piece) => /^\+?[\d\s().-]{7,20}$/.test(piece.trim()))?.trim() ??
    /\+?\d[\d\s().-]{7,18}\d/.exec(pieces.join(" "))?.[0]?.trim() ??
    "";
  if (phone) found.push("phone");

  // "Austin, TX" — a place, and specifically not the name, an email or a date.
  const location =
    pieces.find(
      (piece) =>
        piece !== name &&
        /^[A-Za-z][A-Za-z .'À-ɏ-]*,\s*[A-Za-z][A-Za-z .'À-ɏ-]{1,}$/.test(
          piece.trim(),
        ),
    ) ?? "";

  // A tagline only where the source declared one. Anything else in the header is
  // as likely to be an address or a graduation year, and a title the importer
  // invented is worse than one the user types themselves.
  const tagged = /\\(?:tagline|subtitle|position|jobtitle)\s*\{/.exec(header);
  const taglineGroup = tagged ? readGroup(header, tagged.index + tagged[0].length - 1) : null;

  const links = collectLinks(header)
    .filter(({ url }) => url && !/^(mailto|tel):/i.test(url))
    .slice(0, 8)
    .map(({ url, label }) => ({
      id: makeId("link"),
      // Falls back to the URL with its scheme trimmed, which is exactly how a
      // resume prints a link it has no label for.
      label: clip(label || url.replace(/^https?:\/\/(www\.)?/i, ""), 480),
      url: clip(url, 300),
    }));

  return {
    info: {
      name: clip(name, 720),
      title: clip(taglineGroup ? detex(taglineGroup.text) : "", 960),
      email: clip(email, 960),
      phone: clip(phone, 360),
      location: clip(location.trim(), 720),
      links,
    },
    found,
  };
}

/**
 * Reads a pasted `.tex` resume.
 *
 * Never throws and never returns nothing: a source it cannot make sense of comes
 * back as an empty document with warnings saying why, which the caller shows in
 * the editor rather than as an error. That is the spec's bar — a partial import is
 * something to review, not something to fail.
 */
export function parseLatexResume(source: string): LatexParseOutcome {
  const tex = stripComments(source);
  const body = documentBody(tex);
  const raw = splitSections(body);

  const header = raw.length ? body.slice(0, body.indexOf(raw[0]!.body)) : body;
  const { info, found } = parsePersonalInfo(header);

  const warnings: string[] = [];
  const missed: string[] = [];
  const sections: Section[] = [];

  raw.forEach(({ title, body: sectionBody }) => {
    const heading = clip(detex(title), 480);
    const type = classify(detexPlain(title));
    const entries = scanEntries(sectionBody);

    /**
     * A structured section with no heading command in it is one the parser can't
     * fill in: `role`, `org` and `institution` all come from a heading's
     * arguments, and there are none to read.
     *
     * So the text is kept as a custom section under its own title — nothing is
     * lost — and the section is recorded as a miss, which sends the document to
     * the model. Building an experience entry with an empty employer instead
     * would be the silent half-failure the spec rules out: it looks like a
     * successful import right up until you read it.
     */
    const unstructured =
      entries.length === 0 &&
      (type === "experience" || type === "education" || type === "projects") &&
      hasWords(sectionBody);

    const effective = unstructured ? "custom" : type;
    const items = buildItems(effective, sectionBody, entries);

    if (items.length === 0) {
      // A heading with words under it that produced nothing is the signal that
      // this template's layout commands aren't ones the parser knows.
      if (hasWords(sectionBody)) missed.push(detexPlain(title) || "Untitled");
      return;
    }
    if (unstructured) missed.push(detexPlain(title) || "Untitled");

    sections.push({
      id: makeId("sec"),
      type: effective,
      title: heading || "Section",
      order: sections.length,
      visible: true,
      items,
    } as Section);
  });

  if (!found.includes("name")) {
    warnings.push("Couldn't find a name in the source — add yours at the top of the resume.");
  }
  if (!found.includes("email")) warnings.push("No email address was found in the header.");
  if (raw.length === 0) {
    warnings.push("No \\section{...} headings were found, so there was no structure to read.");
  }
  for (const title of missed.slice(0, 6)) {
    warnings.push(`Skipped the "${clip(title, 60)}" section — its entries use commands the importer doesn't recognise.`);
  }
  // Checked against the body rather than the whole source: a preamble `\input`
  // is nearly always a font or glyph helper — Jake's own template opens with
  // `\input{glyphtounicode}` — and warning about that would cry wolf on the one
  // template this fast path was written for.
  if (/\\(?:input|include)\s*\{/.test(body)) {
    warnings.push("The source includes other .tex files; only the text you pasted was read.");
  }
  if (/\\includegraphics/.test(body)) {
    warnings.push("Images in the source weren't imported — add them from the Insert menu.");
  }

  const entries = sections.reduce((total, section) => total + section.items.length, 0);

  return {
    content: { personalInfo: info, sections },
    // Two real sections and a name is the bar for skipping the model: enough
    // that the document was clearly understood, not so much that a short resume
    // is sent off to be re-read for no reason.
    confident: info.name !== "" && missed.length === 0 && sections.length >= 2 && entries >= 2,
    warnings: warnings.slice(0, 12).map((warning) => clip(warning, 300)),
  };
}
