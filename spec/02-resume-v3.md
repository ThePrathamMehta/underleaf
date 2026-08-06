# CLAUDE.md — Underleaf v3: Profession-Based Templates + PDF Upload & Edit

This is a follow-up spec to the v1 (initial build) and v2 (bug fixes, editor overhaul, OAuth) docs. It assumes v1 + v2 are in place: Turborepo (`apps/web` Next.js App Router, `apps/api` Express), Postgres via Prisma (`packages/db`), Zod schemas in `packages/types`, shared resume-rendering components in `packages/ui`, JWT-in-httpOnly-cookie auth (+ OAuth), block-based editor, Puppeteer PDF export, dark mode, multi-page resumes.

v3 adds two independent features:

- **Feature A — Profession-based template discovery** (extends the existing template gallery)
- **Feature B — Upload & edit an existing PDF** (a new, structurally different editing surface)

These ship separately. Feature A is a moderate extension of existing systems. Feature B is a genuinely hard problem — read that section's constraints carefully before scoping it into a sprint.

**Do not change fonts in the existing resume templates or app chrome.** This rule from v2 still holds everywhere except inside the new PDF editor, where font *preservation* (not font change) is the entire point of the feature.

---

## Feature A — Browse Templates by Profession

### A.1 — Concept
Right now the gallery has 5 templates filterable by loose category tags. We want a first-class "what's your profession?" entry point — CA (Chartered Accountant), Software Engineer, Lawyer, Doctor, and others — where each profession surfaces a curated set of **5–7 best-fit templates**, and the user can still browse the full template library and pick anything regardless of profession.

### A.2 — Open question to resolve before building (important)
Read literally, "each profession has 5–7 best templates" implies **30–50+ unique template designs** across ~7 professions, when only 5 exist today. Building that many genuinely distinct layouts is a large design effort on its own, separate from the plumbing.

Recommended pragmatic approach — confirm with the user before starting:
1. Make the Template↔Profession relationship **many-to-many**. A single well-designed template (e.g. Jake's Resume) can legitimately be one of the "best 5–7" for multiple professions (Software Engineer, Data/Analyst, general Corporate).
2. Reach 5–7 per profession in two phases:
   - **Phase 1 (this pass):** map existing templates across relevant professions, and fill remaining slots with **theme variants** of existing structural layouts (different color accent, font pairing within the template's own design system, single vs. two-column toggle where the layout supports it) — each variant saved as its own `Template` row with its own `previewImageUrl`, so it's a legitimately distinct, pickable gallery item, not a fake duplicate.
   - **Phase 2 (future pass):** commission/design true new structural layouts per profession over time (e.g. a Doctor/CV-style template with a publications-first layout, a Lawyer template with a case-experience section type).
3. Flag in the UI which professions currently rely more on variants vs. fully bespoke layouts is **not** necessary — the user should never perceive Phase 1 vs Phase 2, both must look equally intentional.

Do not silently reinterpret this — state the phased plan back to the user and get a thumbs up (or an explicit "no, build all-unique" instruction) before generating filler variants just to hit a count.

### A.3 — Data model changes (`packages/db`)
- New `Profession` model: `id`, `name`, `slug`, `description`, `iconKey` (a key into a small custom icon set in `packages/ui` — no emoji, per v1 Section 6 design direction), `sortOrder`.
- New join table `TemplateProfession`: `templateId`, `professionId`, `rank` (int, controls order within that profession's curated list — lets you feature the strongest template first).
- `Template` keeps its existing `category` field as-is (Software / Academic / Creative / Minimal etc.) — `category` is a style descriptor, `Profession` is a "who is this for" descriptor. They're orthogonal; don't collapse them into one field.

### A.4 — Seed data
Seed an initial profession list — suggested starting set (confirm with user, easy to extend later): Software Engineer, CA / Accountant, Lawyer, Doctor / Healthcare, Academic / Researcher, Designer / Creative, Marketing / Sales, Student / Entry-Level, General / Other.

For each, seed a `TemplateProfession` mapping with 5–7 ranked entries per the Phase 1 plan in A.2.

### A.5 — API (`apps/api`)
- `GET /professions` — list all, ordered by `sortOrder`.
- `GET /templates?profession=<slug>` — templates for a profession, ordered by `rank`; combine with existing `category` query param (AND filter).
- `GET /professions/:slug` — profession detail (used for a profession landing view if A.6 includes one).

### A.6 — Frontend
- **Entry point:** on `/templates`, add a profession selector as a horizontal chip/pill row above the existing category filter chips (v1 Section 5.2), e.g. "All · Software Engineer · CA · Lawyer · Doctor · …". Selecting one filters the grid to that profession's ranked templates; "All" shows the full library with the existing category filters.
- Also surface this choice earlier: when a user clicks "Create your resume" from the landing page or dashboard, insert one lightweight step — "What's your profession?" — before landing on the gallery, pre-filtered. Must be skippable (an obvious "Browse all templates instead" link/button), since forcing a choice contradicts "user can also view all the resume templates."
- Each profession's filtered grid should visually foreground its top-ranked template (per `rank`) — e.g. it's first in reading order — without needing a distinct "featured" UI treatment; the existing hover/scale card design from v2 Section 2.2 is unchanged.
- No new page is strictly required — this is additive filtering on `/templates` — but a dedicated `/professions` index (grid of profession cards, each linking to its filtered gallery) is a nice-to-have if time allows.

---

## Feature B — Upload & Edit an Existing PDF

### B.1 — Scope this correctly
This is **not** the same kind of editor as the rest of Underleaf. The existing editor works because *we* generated the resume from structured JSON (`content`/`theme` in `packages/types`) and render it as real HTML/CSS — editing HTML/CSS is easy and reflow is free.

A user-uploaded PDF has **no structured document model** — it's positioned glyphs, embedded/subset fonts, and drawing instructions. There is no general, reliable way to turn an arbitrary PDF back into an editable, reflowing document while perfectly preserving its original design. Every real-world "edit a PDF" product (Acrobat, PDFescape, etc.) works around this the same way, and so should we:

> **Treat each existing block of text on the page as an independent, fixed-position label you can retype in place — not a paragraph that reflows.** Moving/retyping one line does not push other content around. This is what "font should not change while editing" actually buys the user: edit text without having to re-pick font/size/color, because it's inherited from the text you clicked into.

State this constraint back to the user explicitly before building — "edit text in place, fixed position, original font preserved" is very achievable; "reflowing, Word-style PDF editing" is not, for arbitrary third-party PDFs.

### B.2 — Technical approach
1. **Upload:** user uploads a PDF (`POST /pdfs`), stored in blob storage (see B.3 — this introduces a new infra dependency not present in v1/v2, which only stored generated PDFs transiently).
2. **Parse:** on the backend, use `pdfjs-dist` to walk each page's text content and extract, per text run: string content, bounding box (x/y/width/height), font name, font size, color, and page index. Use `pdf-lib` (+ its `fontkit` integration) to inspect embedded fonts in the PDF's font dictionary.
3. **Font preservation strategy, in priority order:**
   - If the exact font is **embedded** in the PDF (common for resumes exported from Word/Canva/LaTeX), extract and reuse that embedded font file directly for the edited text — this gives a pixel-perfect font match.
   - If the font is a **standard PDF base font** (Helvetica, Times, Courier, Arial), map it to the equivalent system/web font — visually near-identical, safe fallback.
   - If neither applies (a non-embedded custom font referenced by name only), attempt a best-effort match against a small bundled font catalog by name; if no match, fall back to the closest generic serif/sans and **surface a visible, honest warning to the user** ("Exact font couldn't be preserved for this text — using a close match") rather than silently substituting. Do not overclaim fidelity here.
4. **Render for editing:** rasterize each page to a background image via `pdfjs-dist`'s canvas renderer (this becomes the non-text visual backdrop — logos, rules, other graphics). Overlay absolutely-positioned `contentEditable` boxes on top, one per extracted text run, positioned/sized/fonted to match B.2.3. Clicking a box edits that run in place; nothing else on the page moves.
5. **Persist edits:** store edits as a diff against the original run, not as a full re-parse — `originalText` vs current `text` per run, so we always know what changed and can fall back to the original if export fails.
6. **Export (`GET /pdfs/:id/export.pdf`):** Puppeteer is not the right tool here since this isn't our own HTML/CSS render — this needs to modify the *original* PDF bytes. Use `pdf-lib`:
   - For each edited run: draw a filled rectangle matching the local background color over the original text's bounding box (removing the old glyphs), then draw the new text on top using the matched/embedded font at the original position, size, and color.
   - Unedited runs and all non-text content are left byte-identical from the source PDF.
   - This "redact and redraw" approach is what makes font-and-position-accurate PDF editing tractable at all for arbitrary input files.

### B.3 — New infrastructure requirement
v1/v2 never persisted uploaded files — only DB rows and transient Puppeteer output. This feature needs actual blob storage for the original uploaded PDFs (and optionally the rasterized page backgrounds). Add an object storage layer (S3-compatible — S3, R2, or local-disk-backed equivalent for dev) and a `STORAGE_BUCKET`/credentials env var set. Flag this as a new dependency to confirm with the user, since it wasn't part of the original stack.

### B.4 — Data model (`packages/db`)
- `PdfDocument` — `id`, `userId`, `originalFileUrl`, `pageCount`, `title`, `createdAt`, `updatedAt`.
- `PdfPage` — `id`, `pdfDocumentId`, `pageIndex`, `width`, `height`, `backgroundImageUrl`.
- `PdfTextRun` — `id`, `pdfPageId`, `x`, `y`, `width`, `height`, `fontFamily`, `fontSizeSource` (`'embedded' | 'standard' | 'fallback'`), `embeddedFontUrl` (nullable), `fontSize`, `color`, `originalText`, `text` (current, editable), `updatedAt`.

Keep this as its own model family, separate from `Resume`/`content`/`theme` — a PDF-edit document is not a Underleaf-native resume and shouldn't be forced through the `Resume` schema.

### B.5 — API (`apps/api`)
- `POST /pdfs` — upload (multipart), triggers parse, returns `PdfDocument` with pages/runs.
- `GET /pdfs` — list current user's uploaded PDFs.
- `GET /pdfs/:id` — full document with pages + runs, for the editor to render.
- `PATCH /pdfs/:id/runs/:runId` — update a single run's `text` (this is what autosave calls, same debounce pattern as `PATCH /resumes/:id`).
- `DELETE /pdfs/:id`.
- `GET /pdfs/:id/export.pdf` — pdf-lib redact-and-redraw export per B.2.6, stream back the result.

Validate with new Zod schemas in `packages/types` (separate from the resume schemas). Auth-protect and scope by `userId`, same pattern as `/resumes*`.

### B.6 — Frontend
- New dashboard entry point: "Upload a PDF to edit" alongside "New Resume."
- New route `/pdf-editor/[pdfId]`:
  - Page canvas rendering the rasterized background + overlaid editable text boxes, page navigation (prev/next, or thumbnail rail for multi-page), zoom controls.
  - Click a text run → it becomes an editable box in place; click away or blur → commit, debounced autosave (same "Saving…/Saved" indicator pattern as the resume editor, v2 Priority 1).
  - If a run's font couldn't be preserved with confidence (B.2.3 fallback case), show a small, non-blocking inline indicator on that run (not a disruptive modal) — user should be able to tell at a glance which text is a best-effort match vs. exact.
  - Export as PDF button, same loading/error pattern as the resume editor.
- Reuses the app's existing design language (v1 Section 6) for all chrome around the canvas — toolbar, page rail, save indicator — only the canvas rendering mechanism is new.

### B.7 — Explicit non-goals for v3's PDF editor
- No reflow — editing a run never shifts other content on the page.
- No adding brand-new text boxes anywhere on the page (editing existing detected text only). Flag as a natural Phase 2 addition.
- No editing of non-text graphics/images inside the PDF.
- No OCR — scanned/image-only PDFs (no extractable text layer) are unsupported; detect this at upload time and show a clear message rather than a broken blank editor. OCR-based support is future work, out of scope here.
- No real-time collaboration on a shared PDF document.
- No merging this into the resume `content`/`theme` model — a PDF edit session never becomes a native, template-swappable Underleaf resume in this pass.

---

## Suggested Execution Order
1. Confirm the Feature A phasing plan (A.2) and the Feature B scope constraints (B.1) with the user before writing code — both have a real risk of the user expecting more than described here.
2. Feature A: schema (`Profession`, `TemplateProfession`) → seed data → API → gallery filter UI → optional profession-picker step.
3. Feature B, in order: blob storage setup → upload + parse (`pdfjs-dist`) → font-matching logic → read-only page renderer (background + positioned overlays, no editing yet) → make overlays editable + autosave → pdf-lib redact-and-redraw export → fallback-font UI indicator → non-text-layer detection/error state.

## Definition of Done
- Profession filter and category filter compose correctly (AND, not OR) and both are clearly independent controls to the user.
- Every profession in the seed set resolves to 5–7 templates, none of which look like an obvious filler duplicate.
- "Browse all templates" remains fully reachable without picking a profession first.
- PDF upload correctly rejects/flags scanned (non-text-layer) PDFs instead of rendering a broken editor.
- Editing a text run never changes its font/size/color unless the user explicitly changes it, and never shifts other content on the page.
- Exported PDF, opened in a standard viewer, shows edited text in the correct position with no visible artifact from the original text (redaction rectangle color-matches the background).
- Multi-page uploaded PDFs export with the correct page count and per-page content.
- No new console errors/warnings; responsive check at tablet width for the new dashboard entry point and gallery changes (per v1/v2's existing responsive scope — the PDF editor canvas itself can follow the same "desktop-first" allowance as the resume editor).