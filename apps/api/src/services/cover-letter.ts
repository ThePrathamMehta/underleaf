import { complete } from "@repo/ai";
import { AiError, toAiError } from "@repo/ai/errors";
import { resumeOutline } from "@repo/scoring";
import {
  COVER_LETTER_TONE_BLURBS,
  type CoverLetterTone,
  type ResumeContent,
} from "@repo/types";

/**
 * Cover letter generation.
 *
 * Unlike the other three AI features there is no deterministic half to fall back
 * on — a rules engine cannot write a letter, and pretending otherwise with a
 * mail-merge template would produce exactly the letter every reader has learned
 * to skim past. So this one propagates its failures: if the provider is down,
 * the user is told, and no letter is written.
 *
 * The output is plain text with blank lines between paragraphs. Not markdown,
 * not HTML: the editor is a textarea and the export wraps paragraphs itself, so
 * markup here would only ever arrive as literal asterisks in a printed letter.
 */

/** Letters longer than this stop being read. The prompt says so, this enforces it. */
const MAX_WORDS = 400;

const TONE_DIRECTION: Record<CoverLetterTone, string> = {
  formal:
    "Measured and traditional. Complete sentences, no contractions, no exclamation marks. Four paragraphs.",
  friendly:
    "Warm and direct, with a recognisable human voice. Contractions are fine. Still professional — this is a letter to a stranger who is deciding whether to spend an hour on you. Four paragraphs.",
  concise:
    "Three short paragraphs and nothing else. No throat-clearing, no restating the job title back at them. Every sentence earns its place.",
};

const SYSTEM_PROMPT = [
  "You write cover letters for a candidate, using only what their resume actually says.",
  "",
  "Rules:",
  "1. Invent nothing. Every company, role, technology, metric and date must appear in the resume. If the resume does not say how long they used something, do not say either.",
  "2. Do not restate the resume line by line. Pick the two or three things most relevant to this application and say why they matter.",
  `3. Stay under ${MAX_WORDS} words. Shorter is better.`,
  "4. Plain text only. Paragraphs separated by a single blank line. No markdown, no bullet points, no headings.",
  "5. Do not write the letterhead, the date, the recipient's address, or a signature block. Start at the salutation and end at the closing line. The application form has fields for the rest.",
  "6. Address a specific person only if the posting names one. Otherwise open with 'Dear Hiring Manager,'.",
  "7. No filler openings. Never begin with 'I am writing to apply for' or 'I was excited to see'.",
  "8. If no job posting is supplied, write to the role the resume itself describes, and keep it general enough to attach to a specific posting later.",
].join("\n");

export type GenerateLetterOptions = {
  content: ResumeContent;
  tone: CoverLetterTone;
  /** The posting, when there is one. */
  jobDescriptionText: string | null;
  userId: string;
};

/**
 * Trims what the model returns down to the letter itself.
 *
 * Models like to introduce their work ("Here's the letter:") and to fence it.
 * Both are prose the user would have to delete by hand, and both are cheap to
 * remove here — once — rather than in the panel and the export separately.
 */
function cleanLetter(text: string): string {
  let body = text.trim();

  const fenced = body.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) body = fenced[1].trim();

  // A preamble line before the salutation, e.g. "Here is the cover letter:".
  const salutation = body.search(/^\s*(Dear|To whom|Hello|Hi)\b/im);
  if (salutation > 0 && salutation < 200) body = body.slice(salutation).trim();

  // Collapse runs of blank lines to exactly one, which is the paragraph break
  // the editor and the export both assume.
  return body.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}

export async function generateCoverLetter(options: GenerateLetterOptions): Promise<string> {
  const posting = options.jobDescriptionText?.trim();

  const prompt = [
    "Resume:",
    resumeOutline(options.content),
    "",
    posting
      ? ["Job posting:", posting.slice(0, 8000)].join("\n")
      : "No job posting was supplied. Write to the kind of role this resume is aimed at.",
    "",
    `Tone: ${options.tone} — ${TONE_DIRECTION[options.tone]}`,
    `(${COVER_LETTER_TONE_BLURBS[options.tone]})`,
    "",
    "Write the letter. Output the letter text and nothing else.",
  ].join("\n");

  try {
    const completion = await complete(
      { purpose: "coverLetter", userId: options.userId },
      { system: SYSTEM_PROMPT, messages: [{ role: "user", content: prompt }] },
    );

    const letter = cleanLetter(completion.text);
    if (!letter) {
      // An empty completion is a provider problem wearing a success status, and
      // saving it would leave the user staring at a blank box with no reason why.
      throw new AiError("invalid_response", "The model returned an empty letter.");
    }

    return letter;
  } catch (error) {
    // Rethrown as an AiError so the route surfaces its specific message —
    // "the configured key is not set", "the request timed out" — rather than a
    // generic failure, which the Definition of Done rules out.
    throw toAiError(error);
  }
}
