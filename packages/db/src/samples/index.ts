import type { ResumeContent } from "@repo/types";
import { SAMPLE_CONTENT } from "../sample-content.js";
import { ACCOUNTANT_SAMPLE } from "./accountant.js";
import { ACADEMIC_SAMPLE } from "./academic.js";
import { DESIGNER_SAMPLE } from "./designer.js";
import { GENERAL_SAMPLE } from "./general.js";
import { HEALTHCARE_SAMPLE } from "./healthcare.js";
import { LAWYER_SAMPLE } from "./lawyer.js";
import { MARKETING_SAMPLE } from "./marketing.js";
import { STUDENT_SAMPLE } from "./student.js";

/**
 * One sample resume per profession, keyed by `Profession.slug`.
 *
 * These are not the same document with the names changed. Each follows the
 * conventions of its own field, because that is what makes the preview useful:
 * a CA's resume leads with the qualification and articleship, a lawyer's with
 * education and bar admissions, a student's with coursework and projects. The
 * section *set* differs too — a physician's CV needs Licensure, a designer's
 * needs a portfolio link, and neither wants the engineer's Projects section.
 *
 * `software-engineer` maps to the original shared sample, which was written for
 * exactly that audience — so it stays the fallback for any template viewed
 * outside a profession filter.
 */
export const SAMPLE_CONTENT_BY_PROFESSION: Record<string, ResumeContent> = {
  "software-engineer": SAMPLE_CONTENT,
  accountant: ACCOUNTANT_SAMPLE,
  lawyer: LAWYER_SAMPLE,
  healthcare: HEALTHCARE_SAMPLE,
  academic: ACADEMIC_SAMPLE,
  designer: DESIGNER_SAMPLE,
  marketing: MARKETING_SAMPLE,
  student: STUDENT_SAMPLE,
  general: GENERAL_SAMPLE,
};

export {
  ACADEMIC_SAMPLE,
  ACCOUNTANT_SAMPLE,
  DESIGNER_SAMPLE,
  GENERAL_SAMPLE,
  HEALTHCARE_SAMPLE,
  LAWYER_SAMPLE,
  MARKETING_SAMPLE,
  STUDENT_SAMPLE,
};
