# CLAUDE.md — Underleaf v6: LaTeX Import, True Blank Canvas & Word-Style Editing

This is a follow-up spec to v1 (initial build), v2 (bug fixes, editor overhaul, OAuth), v3 (profession-based templates, PDF upload & edit), v4 (AI chat assistant, ATS scoring, JD matching, cover letters), and v5 (membership, billing, AI usage metering). It assumes v1–v5 are in place, including the shared block-based `content` model (`personalInfo` + `sections[]` of typed `SectionItem`s from v1 Section 3), the `packages/ai` provider layer with `resolveModel(purpose, planKey)` from v5 Section 4, and the metering helper `checkAndConsumeAiAction` from v5 Section 3.2.

v6 is about **onboarding and editing freedom** — get existing Overleaf users into Underleaf without re-typing their resume, make the "blank template" genuinely blank and Word-like, and fix click-to-edit so it works everywhere, not just in predefined regions. **Do not change the app's visual design language** (v1 Section 6) — this is new editor capability, not a redesign.

---

## 0. Why these four features, together

They all attack the same problem from different angles: **friction between "what the user already has" and "what Underleaf lets them do with it."**

- A returning Overleaf user has a finished resume in LaTeX and shouldn't have to retype it just to get Underleaf's visual editing.
- A user who deliberately picks "Blank" wants zero imposed structure — v1's block editor is great for templates but currently still forces a fixed section shape even on "blank," which defeats the point of choosing blank.
- Every user, template or blank, expects to click on any word on the page and start typing right there, the way they would in Word or Google Docs. Right now this only reliably works inside predefined block regions — clicking whitespace, a spot between blocks, or certain nested elements doesn't reliably create/focus an editable target.
- Exported filenames currently fall back to the template's name (`Jakes-Resume.pdf`) instead of the person's own name, which is a small thing that undermines the "polished, professional" feel v1 was going for.

None of this touches billing, templates' visual design, or the AI panels from v4 — it's purely editor and import capability.

---

## 1. Feature 1 — Paste LaTeX to import an existing resume

### 1.1 Entry point
On the template gallery (`/templates`), add a card alongside the 5 existing templates and the blank option: **"Import from LaTeX"**. Clicking it opens a modal/panel with a large code textarea ("Paste your Overleaf `.tex` source here") and an "Import" button. Also expose this as a step in the "New Resume" flow from the dashboard, so it isn't gallery-only.

### 1.2 Parsing approach — hybrid, not a full LaTeX interpreter
Do not attempt to build a general LaTeX renderer. Two-tier strategy:

1. **Deterministic fast path** for recognizable, popular templates (starting with Jake's Resume, since v1 already models its layout structure). Pattern-match on structural commands (`\section{...}`, `\resumeSubheading`, `\resumeItem`, etc.) with a small set of regex/AST rules in `packages/latex-import` to directly populate the existing `Resume.content` Zod schema from v1 Section 3. Fast, free, no AI cost, and accurate when it matches.
2. **AI fallback** via `packages/ai` (new `purpose: 'latexImport'` on `AiProviderConfig`, same pattern as v4's `chat | ats | jdMatch | coverLetter`) for anything the deterministic parser doesn't recognize: send the raw `.tex` source with a prompt instructing the model to extract `personalInfo` and `sections[]` into the same Zod schema, returning structured JSON only (per the existing `structured_outputs_in_xml` pattern already used elsewhere in the app). Validate the response against the schema before accepting it; on validation failure, show the user an editable pre-fill with whatever was extracted plus a clear "please review, some content may need fixing" banner rather than silently failing.

### 1.3 Metering
LaTeX import is a one-time-per-resume action, not a recurring content-generation feature like chat or cover letters. Treat it as **free on all plans, but rate-limited** (e.g., max N import attempts per hour per user) to prevent abuse of the AI fallback path — not part of the `UserAiUsage` allowance from v5, since it doesn't fit the "bursty AI usage" model that allowance was designed around. Still log token usage to `AiUsageLog` for cost visibility even though it isn't billed against the user's allowance.

### 1.4 Post-import flow
After successful extraction, land the user directly in the editor (`/editor/[resumeId]`) with:
- The extracted content populated into whichever template layout they choose next (default: Jake's Resume, since that's the most common Overleaf export and also Underleaf's own default template) — extraction is content-only, not visual, so the LaTeX's original visual styling is intentionally discarded in favor of Underleaf's rendered templates.
- A one-time dismissible banner: "Imported from LaTeX — review your resume below, some formatting may need adjusting."
- Nothing is auto-saved as final until the user's normal autosave kicks in — same debounced save behavior as any other edit (v1 Section 5).

### 1.5 Non-goals for this feature
- No support for multi-file LaTeX projects (`\input`/`\include` across files) — single pasted `.tex` body only.
- No preservation of custom LaTeX packages/macros users may have written — content extraction only, not a LaTeX interpreter.
- No round-trip export back to LaTeX — v1's explicit non-goal ("No LaTeX exposure anywhere in the UI") still holds for output; this feature is import-only.

---

## 2. Feature 2 — A genuinely blank canvas template

### 2.1 The problem with today's "blank"
Today, every resume — including ones started from "blank" — is still built from v1's fixed `Section` / `SectionItem` shape. That's correct for named templates but wrong for "blank," where the entire point is imposing no structure.

### 2.2 New content primitive: freeform blocks
Add a new block type to the Zod schema in `packages/types` that can live alongside the existing typed sections, used exclusively by the blank template:

```
FreeformBlock: {
  id,
  type: 'text' | 'heading' | 'image' | 'divider',
  position: { x, y },      // relative to the page, for free placement
  size: { width, height }, // optional, for text boxes and images
  content: string,         // rich text (for text/heading) or image URL/asset ref (for image)
  style: { fontSize, fontWeight, textAlign, color }  // per-block overrides
}
```

`Resume.content` gains an optional `freeformBlocks: FreeformBlock[]` alongside the existing `sections[]`, used when `Resume.templateId` points to the new **"Blank"** template (add it as a 6th seeded `Template` row, `category: 'Blank'`, `defaultTheme` minimal — no preset colors/fonts beyond sane body defaults). A resume is either section-based or freeform-based in practice (driven by which template it started from) but the schema doesn't need to hard-enforce exclusivity — the editor UI only shows one mode per template.

### 2.3 Editor behavior for the blank template
- On creating a new resume from "Blank," land in the editor with **one focused, empty heading block pre-placed at top-center of the page**, cursor active, placeholder text "Your Name" — this is the "default cursor position" the user asked for, matching how Word/Canva default to a title-first blank document rather than a truly empty page with no starting point.
- Clicking **anywhere else on the blank page** creates a new `text` FreeformBlock at that click position with the cursor focused and ready to type immediately — no menu, no click-to-add-block step first.
- Dragging a block moves its `position`; dragging a corner/edge handle resizes it (`size`). Use the same `@dnd-kit/core` dependency already in the stack from v1, since free positioning is a natural extension of its drag primitives rather than a new library.
- **"Insert Section" button** in the header/toolbar (see Section 4 below) opens a picker of the same named section types the templates use — Experience, Education, Skills, Projects, Summary, Certifications, Languages, Volunteer Work, Awards, Custom — and inserts a **pre-structured starter block** (heading + one example entry with placeholder text, e.g. "Company Name — Job Title" with two placeholder bullets) at the clicked/next available position. This is the "he doesn't have to create that from scratch" behavior: it's still a `FreeformBlock` of `type: 'text'` under the hood (positioned, not schema-locked), just pre-filled with sensible starter content and structure the user then edits or deletes freely.
- Because everything is a positioned block, there's no dedicated "reorder sections" drag handle for blank resumes the way there is for template resumes (v1 Section 5) — reordering is just moving blocks, which the same drag interaction already covers.

### 2.4 Insert menu (Word-style)
Add an **"Insert"** menu to the editor header, available on both blank and template resumes:
- **Image** — file picker or drag-and-drop; uploads to the existing blob storage added in v3, inserted as an `image` FreeformBlock (blank canvas) or into a new `ImageBlock`-typed `SectionItem` variant (template resumes, e.g. for a headshot in a sidebar layout). Support basic resize via corner-drag, matching Section 2.3's resize behavior.
- **Divider** — a simple horizontal rule block, useful for blank-canvas users who want visual separation without a named section.
- **Text Box** — an explicitly freestanding text block, for blank-canvas users who want a caption, note, or side annotation outside the normal flow.
- Keep this menu's scope to these three for v6 — no shapes, tables, icons, or charts; that's meaningfully more editor surface area than this pass needs.

---

## 3. Feature 3 — Universal click-to-edit ("fix wherever the user clicks")

This is a bug-fix/hardening item on top of v1's `contentEditable` block editor, not a new feature, but it's a real UX regression worth calling out explicitly since it affects every template resume today.

- **Root cause to check first:** confirm every text-bearing DOM node inside a rendered `SectionItem` (bullet text, org name, role, dates, location) is wrapped in its own properly-scoped `contentEditable` region — not just top-level fields. If any field currently renders as static text (not editable) because it was added later or missed in the original block-editor wiring, that's the bug.
- **Empty-space clicks:** clicking whitespace within a section (e.g., below the last bullet, or in the gap between two entries) should focus the nearest logical insertion point (new bullet, or new entry) rather than doing nothing — mirrors Word's "click below the last line to keep typing" behavior.
- **Click between sections:** clicking in the vertical gap between two sections should not throw focus into the wrong section's contentEditable region — verify hit-testing boundaries are tight to each section's actual rendered bounds, especially for the sidebar/two-column templates (Deedy-style, v1 Section 4 template #2) where left/right column click regions can currently overlap incorrectly.
- Add this as a dedicated QA pass across all 5 named templates plus the new Blank template before shipping v6 — click every field type in every template and confirm immediate, correctly-scoped edit focus.

---

## 4. Feature 4 — Export filename defaults to the person's name

### 4.1 Current behavior (bug)
PDF export (`GET /resumes/:id/export.pdf`, v1 Section 7) currently names the downloaded file after the template or a generic default, not the person.

### 4.2 New behavior
- On export, derive the filename from `content.personalInfo.name` when present: sanitize (strip special characters, replace spaces with hyphens or underscores — pick one and use it consistently, e.g. `Pratham-Mehta-Resume.pdf`) and use that as the `Content-Disposition` filename.
- **Blank-template fallback:** if `personalInfo.name` is empty (common on blank canvas, where "name" isn't a structured field but just whatever text the user typed into their top heading block), fall back to extracting text from the **first heading-styled `FreeformBlock`** on the page (the pre-placed top-center block from Section 2.3, or whichever block currently carries `type: 'heading'`) — that's the closest equivalent to a name field in a freeform document.
- **Final fallback**, if both are empty (a genuinely untitled, still-blank resume): use the existing `Resume.title` field, then `"Untitled-Resume.pdf"` if even that's unset — never let export fail or produce a blank filename.
- Apply the same naming logic to any other export/download surfaces added in later versions, so this stays a single shared utility (`getExportFilename(resume)` in `packages/types` or a shared utils package) rather than duplicated per-route logic.

---

## 5. Data model changes (`packages/db` / `packages/types`)

- `packages/types`: add `FreeformBlockSchema` (Zod) as described in Section 2.2; extend `ResumeContentSchema` with optional `freeformBlocks: FreeformBlock[]`.
- `packages/db`: seed a new `Template` row, `slug: 'blank'`, `category: 'Blank'`, minimal `defaultTheme`, empty/near-empty sample `content` (just the one pre-placed heading block).
- `packages/db`: add `AiProviderConfig` row(s) for `purpose: 'latexImport'` (v5's existing scoping pattern), and extend the `purpose` enum wherever it's currently typed (`chat | ats | jdMatch | coverLetter | latexImport`).
- `packages/db`: no changes needed to `Plan`/`Subscription`/`UserAiUsage` from v5 — LaTeX import is explicitly unmetered against the AI allowance (Section 1.3).
- New `packages/latex-import` package: houses the deterministic parser(s) and the AI-fallback prompt/schema-validation logic from Section 1.2, exported for use by the API route below.

---

## 6. API (`apps/api`)

- `POST /resumes/import/latex` — body: `{ latexSource: string }`. Runs the Section 1.2 hybrid parser, returns extracted `content` (not yet persisted) plus a `confidence: 'deterministic' | 'ai-assisted'` flag so the frontend can decide whether to show the "please review" banner. Rate-limited per Section 1.3, not routed through `checkAndConsumeAiAction`.
- `POST /resumes` — extend existing route (v1 Section 7) to accept an optional `importedContent` body field, used when creating a resume immediately after a successful `/resumes/import/latex` call, so the extracted content is saved directly rather than requiring a second round-trip.
- `POST /uploads/image` — (if not already present from v3's blob-storage work) generic authenticated image upload endpoint used by the Insert → Image feature from Section 2.4; returns a URL to store in the block's `content` field.
- `GET /resumes/:id/export.pdf` — update to use the shared `getExportFilename(resume)` utility from Section 4.2 when setting `Content-Disposition`.

---

## 7. Frontend (`apps/web`)

- Template gallery: add "Import from LaTeX" card and "Blank" card (if blank wasn't already a first-class gallery option before v6) alongside the 5 named templates.
- LaTeX import modal: textarea + import button + loading state + post-import review banner (Section 1.4).
- Editor: implement freeform canvas rendering/interaction for the Blank template (click-to-place text blocks, drag-to-move/resize, pre-placed centered name heading) per Section 2.3.
- Editor header: add **Insert** menu (Image, Divider, Text Box) and confirm **Insert Section** starter-block behavior for blank resumes, both per Section 2.4.
- Apply the Section 3 click-to-edit hardening across all templates as a cross-cutting fix, not a new UI surface.

---

## 8. Non-goals for v6

- No LaTeX round-trip export (import only, per Section 1.5).
- No multi-file LaTeX project import.
- No shapes/tables/icons/charts in the Insert menu — image, divider, and text box only.
- No AI-assisted layout suggestions for the blank canvas (e.g., "auto-arrange my blocks") — purely manual placement in this pass.
- No changes to billing, metering allowances, or the visual design language of the app chrome (v5's rule still applies: new capability, not a redesign).

---

## Suggested Execution Order

1. `packages/types` schema changes (`FreeformBlock`, filename utility) + `packages/db` seed for the Blank template.
2. Section 3's click-to-edit QA/hardening pass across existing templates — do this early since it's a correctness fix, not new surface, and de-risks everything else built on top of the editor this version.
3. Blank-canvas editor: pre-placed centered heading, click-to-place text blocks, drag move/resize (Section 2.3).
4. Insert menu: Image, Divider, Text Box (Section 2.4) — Image upload depends on v3's blob storage already being in place.
5. Insert Section starter-block picker for blank resumes.
6. Export filename logic (Section 4) — small, isolated, ship independently whenever convenient.
7. `packages/latex-import` deterministic parser for Jake's Resume structure, then the AI-fallback path + `/resumes/import/latex` route + gallery entry point + post-import review flow (Section 1) — largest single piece, do last since it depends on the content schema from step 1 and benefits from the editor being solid first.

---

## Definition of Done

- A user can paste Overleaf LaTeX source for a Jake's-Resume-style document and land in the editor with their real content correctly extracted, with no manual retyping required.
- LaTeX that doesn't match the deterministic patterns still produces a usable, editable extraction via the AI fallback, clearly flagged for review, and never silently fails or blocks resume creation.
- Starting a "Blank" resume opens a genuinely empty page with only a centered, focused name heading pre-placed — no imposed section structure.
- Clicking anywhere on a blank resume creates an editable text block at that position immediately, no extra steps.
- "Insert Section" on a blank resume adds a pre-structured, editable starter block for the chosen section type (Experience, Education, etc.) rather than requiring the user to build it field-by-field.
- Insert → Image works on both blank and template resumes, with basic resize.
- Every text field across all 5 named templates plus Blank is reliably click-to-edit, including whitespace/gap clicks and column-boundary edge cases in sidebar layouts.
- Exported PDFs are named after the person (from `personalInfo.name` or the blank template's heading block), never the template's own name, with sane fallbacks when no name is present.
- LaTeX import does not consume any of a user's metered `UserAiUsage` allowance from v5, but is still rate-limited and logged to `AiUsageLog`.
- No regressions to v1–v5 functionality: existing template resumes, autosave, PDF export, billing/metering, and AI panels all continue to work unchanged.
