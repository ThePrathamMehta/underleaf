# CLAUDE.md — Underleaf v4: AI Resume Assistant, ATS Scoring, JD Matching, Cover Letters

This is a follow-up spec to the v1 (initial build), v2 (bug fixes, editor overhaul, OAuth), and v3 (profession-based templates, PDF upload & edit) docs. It assumes v1–v3 are in place: Turborepo (`apps/web` Next.js App Router, `apps/api` Express), Postgres via Prisma (`packages/db`), Zod schemas in `packages/types`, shared resume-rendering components in `packages/ui`, JWT-in-httpOnly-cookie auth (+ OAuth), block-based editor with real undo/redo, Puppeteer PDF export, dark mode, multi-page resumes, profession-filtered template gallery, and the standalone PDF upload/edit surface.

v4 adds AI to the product for the first time. Three features are specified by the user (chat-based resume editing, ATS scoring, JD matching); a fourth is left open ("add something that makes the platform more useful") — Section 4 below proposes a specific feature and explains why, but **this is a recommendation, not a decision** — confirm it (or pick an alternative from the short list at the end of Section 4) before building it.

**Do not change fonts or the app's visual design language.** All four features are new surfaces, not a redesign — they should look like they were designed by the same team that built v1–v3 (v1 Section 6), not bolted on.

---

## 0. Foundational work that all four features depend on

Every feature in this doc calls out to an LLM. Building four independent OpenAI/Anthropic integrations would scatter provider logic, API keys, and error handling across the codebase and make the "admin picks the model" requirement (Feature 1) impossible to satisfy cleanly. Build **one shared AI provider layer first**, then build the four features on top of it.

### 0.1 New package: `packages/ai`
- Exposes a provider-agnostic interface: `getCompletion(params)`, `streamCompletion(params)`, and a `callWithTools(params, tools)` variant for structured tool-calling (used heavily by Feature 1).
- One adapter per provider behind that interface: `OpenAIAdapter`, `AnthropicAdapter`, and a generic `OpenAICompatibleAdapter` for any other provider that speaks the OpenAI-style chat completions format (covers most self-hosted/open-source model gateways) — this is what makes "or any other model" from the requirement practical without writing a bespoke adapter per vendor.
- Each adapter normalizes streaming, tool-calling, and error shapes to a common internal format so nothing downstream (chat, ATS, JD match, cover letters) needs to know which provider is active.

### 0.2 Admin-configurable model selection
- Add `role` to `User` (`'user' | 'admin'`, default `'user'`) — v1–v3 had no role concept; this is new.
- New model `AiProviderConfig`: `id`, `provider` (`'openai' | 'anthropic' | 'other'`), `modelName`, `apiKeySecretRef` (a reference into env vars / a secrets manager — **never store raw API keys in the database**), `purpose` (`'chat' | 'ats' | 'jdMatch' | 'coverLetter' | 'all'`), `isActive`, `updatedAt`. Scoping by `purpose` lets the admin run a stronger/pricier model for the chat assistant and a cheaper one for ATS scoring, without forcing one model for everything.
- New admin-only route `/admin/ai-settings` in `apps/web`, gated by `role === 'admin'` middleware in `apps/api`.
- API: `GET /admin/ai-config`, `PATCH /admin/ai-config` (admin-protected, validated with a new Zod schema in `packages/types`).
- API keys are supplied via environment variables at deploy time and referenced by name in `apiKeySecretRef` — the admin UI lets you pick *which* configured key/provider/model to use, it never displays or accepts raw key values through the browser.

### 0.3 Cost and reliability guardrails
- Every AI-backed request in this doc goes through `packages/ai`, which should enforce a request timeout, a token/length cap appropriate to the task, and a single automatic retry on transient provider errors before surfacing a real error to the user.
- Log provider, model, and token usage per call (not the content) to a simple `AiUsageLog` table — useful later for cost tracking, out of scope to build a dashboard for in this pass.

---

## Feature 1 — AI Chat Assistant for Resume Creation & Editing

### 1.1 Concept
A chat panel in the editor, Cursor-agent-style: the user types an instruction in natural language — anything from "create a resume for a mid-level backend engineer with 4 years of experience in Node and Postgres" to "make the bullets under my last role more results-driven" — and the assistant edits the resume accordingly, in the same document the user is looking at.

### 1.2 Critical architecture decision: tool-calling, not freeform JSON generation
The assistant must **never** be asked to emit the full `content` JSON blob as free text and have that trusted directly — a single malformed field would corrupt the resume or crash the renderer. Instead, define a small, fixed set of tools that map onto the Zod schema already in `packages/types`, and have the model call them via the provider's native tool-calling support (both OpenAI and Anthropic support this consistently, which is exactly what `packages/ai`'s `callWithTools` should normalize):

- `setPersonalInfo`, `addSection`, `updateSection`, `reorderSections`, `addSectionItem`, `updateSectionItem`, `rewriteBullets`, `setTheme`.

Every tool call is validated against the existing Zod schemas before being applied to `content`/`theme` — the same validation path the REST API already uses for `PATCH /resumes/:id`. This keeps the assistant incapable of producing an invalid document, and means "create a whole resume from one instruction" and "tweak one bullet" are the same mechanism at different scale, not two different code paths.

### 1.3 Applying changes: auto-apply + existing undo/redo
Rather than building a separate accept/reject diff UI, route every tool call through the **undo/redo history stack already built in v2 (Priority 1)**. Changes apply immediately and are visible on the canvas as they happen (this is what makes it feel like Cursor, not a form you submit and wait on); a standard Cmd/Ctrl+Z reverts an AI edit exactly like it would revert a manual one. Each assistant turn that changed the document shows a compact one-line summary in the chat ("Rewrote 3 bullets under Senior Engineer at Acme") with a link that scrolls the canvas to what changed.

### 1.4 Data model
- `ChatSession` — `id`, `resumeId`, `userId`, `createdAt`.
- `ChatMessage` — `id`, `sessionId`, `role` (`'user' | 'assistant' | 'system'`), `content`, `toolCalls` (JSON, nullable), `createdAt`.

### 1.5 API
- `POST /resumes/:id/chat` — accepts the user's message, streams the response via Server-Sent Events (text token deltas interleaved with tool-call events as they resolve).
- `GET /resumes/:id/chat` — message history for the session, so reopening the editor restores the conversation.
- Auth-protected and scoped by `userId`, same pattern as every other `/resumes*` route.

### 1.6 Frontend
- A slide-over or docked side panel in the editor, styled in the app's existing editorial design language (v1 Section 6) — not a generic floating chat-widget bubble.
- Streaming message bubbles with a real typing/thinking indicator, a multiline input, and clear states for "thinking," "editing your resume," "done," and "the model failed to respond — retry" (network/provider errors from `packages/ai` should surface as a real, specific message, not a silent failure).
- Works from an empty "Start from Blank" resume (v2 Section 3.1) as a bootstrapping flow — a user can create a resume from zero via chat instead of filling in fields — and continues to work identically for iterative edits afterward.

---

## Feature 2 — ATS Score & Improvement Guide

### 2.1 Concept
A score (0–100) plus a category breakdown showing specifically where the resume is weak for automated applicant-tracking systems, and concrete guidance for fixing each issue — not just a number.

### 2.2 Scoring approach: hybrid rule-based + AI
Not every check needs a model call — cheaper and more consistent to split:

- **Rule-based (deterministic, no AI cost), checks:** contact info present and machine-parseable, standard section headers detected, date-format consistency, presence of quantified results (numbers/%/currency in bullets via simple pattern matching), bullet length/count sanity, action-verb usage against a small local verb list. Also flag layout risk directly and honestly: multi-column/sidebar templates (e.g. the Deedy-style layout from v1 Section 4) are genuinely harder for some ATS parsers to read correctly — say so in the guidance rather than pretending every template scores the same.
- **AI-assisted (via `packages/ai`, `purpose: 'ats'`), checks:** bullet clarity and impact, overall narrative coherence, whether experience is framed around outcomes vs. duties. Run this on-demand (a "Check my score" button or after autosave settles), not on every keystroke — it's the part of the score with a real cost per call.

### 2.3 Data model
- `AtsScoreResult` — `id`, `resumeId`, `overallScore`, `categoryScores` (JSON: e.g. `keywords`, `formatting`, `impact`, `completeness`), `issues` (JSON array of `{ severity, message, sectionRef }`), `createdAt`. Persisting history (not just the latest) lets the user see the score improve as they edit.

### 2.4 API
- `POST /resumes/:id/ats-score` — computes and persists a fresh result.
- `GET /resumes/:id/ats-score/latest`
- `GET /resumes/:id/ats-score/history`

### 2.5 Frontend
- New panel/route (`/editor/[resumeId]/ats` or an in-editor tab) with a prominent score (numeral + ring/gauge), a category breakdown, and an expandable, prioritized issue list — each issue paired with a specific fix, not a generic tip. "Re-check" triggers a fresh score after edits. Loading/empty/error states match the rest of the app.

---

## Feature 3 — Job Description Match / Compare

### 3.1 Concept
The user pastes a job description; the app compares it against the resume and returns a match score, which keywords/requirements are covered vs. missing, and specific suggestions to close the gap.

### 3.2 Data model
- `JdComparison` — `id`, `resumeId`, `jobDescriptionText`, `matchScore`, `matchedKeywords` (JSON array), `missingKeywords` (JSON array), `suggestions` (JSON array of `{ message, sectionRef }`), `createdAt`.

### 3.3 Approach
Shares the same keyword/requirement-extraction utility as Feature 2 rather than duplicating logic — extend `packages/ai` (or a small shared `packages/scoring` if the extraction logic grows enough to warrant its own package) with a JD-parsing function that pulls out required skills, tools, seniority signals, and core responsibilities, then diffs that against the resume's `content`. Every gap becomes a specific, resume-anchored suggestion (e.g. "Kubernetes appears 3× in the JD and isn't in your Skills section") rather than a generic "tailor your resume" note.

### 3.4 API
- `POST /resumes/:id/jd-compare` (body: `jobDescriptionText`)
- `GET /resumes/:id/jd-compare/:comparisonId`
- `GET /resumes/:id/jd-compare` (history list)

### 3.5 Frontend
- New panel/route (`/editor/[resumeId]/jd-match`): a paste box, a "Compare" action, and results laid out as a match score plus two keyword-chip columns (matched / missing) and a suggestion list.
- **Connects to Feature 1:** each suggestion gets an "Apply with AI" action that hands the suggestion straight to the chat assistant's tool-calling pipeline, which rewrites the relevant bullet or section in place. This is the one place v4's three required features should feel like a single system rather than three separate add-ons.

---

## Feature 4 (proposed) — AI Cover Letter Generator

The brief leaves this open ("add something that makes the platform more useful"). Below is a specific recommendation with reasoning, plus two lighter-weight alternatives — **confirm the direction before this gets built**, since it's the one piece of this doc not directly specified.

### 4.1 Why this one
It reuses everything built above — the same `packages/ai` provider layer, the same JD text a user has often already pasted in Feature 3, and the same resume `content` — so it adds real, distinct end-user value (most people who tailor a resume for a job also need a cover letter for that same job) without introducing new architecture, infra, or admin surface. It's the highest-value feature that costs the least to build given what v4 already requires.

### 4.2 Concept
Generate a tailored cover letter from the resume's `content` and, optionally, a job description (reusing a `JdComparison.jobDescriptionText` if one exists for that resume, or freshly pasted). Editable afterward in a lightweight rich-text field — this does not need the full block-editor infrastructure the resume itself uses — and exportable as a PDF via the same Puppeteer pattern already used for resumes.

### 4.3 Data model
- `CoverLetter` — `id`, `resumeId`, `userId`, `jobDescriptionText` (nullable), `content` (markdown/rich text), `tone` (`'formal' | 'friendly' | 'concise'`), `createdAt`, `updatedAt`.

### 4.4 API
- `POST /resumes/:id/cover-letter` — generate (body: optional `jobDescriptionText`, `tone`)
- `PATCH /cover-letters/:id` — manual edits, same debounced-autosave pattern as everything else
- `GET /cover-letters/:id/export.pdf`

### 4.5 Frontend
- Entry point from the editor toolbar and from the dashboard resume card ("Generate cover letter").
- Split view: generated letter (editable) alongside a tone selector and "Regenerate" — same loading/error/save-indicator patterns already established across the app.

### 4.6 If cover letters aren't the right call, two lighter alternatives
- **Resume version history** — periodic snapshots of `content`/`theme` (flagged as a "nice to have" back in v2 Section 3.3), now easier to justify since AI edits (Feature 1) make "revert to before the AI changed things" more valuable than plain manual undo/redo alone.
- **Job application tracker** — a simple `JobApplication` model (company, role, status, resumeId, jdComparisonId, appliedDate) linking a resume version and JD comparison to an actual application, turning Underleaf into something the user returns to after the resume is finished, not just before.

---

## Non-goals for v4

- No autonomous multi-step agent behavior beyond single-turn tool calls (no browsing the web, no auto-applying to jobs, no acting without a user-issued instruction each time).
- No fine-tuning or hosting of custom models — provider selection is limited to hosted APIs configured in `AiProviderConfig`.
- No per-user "bring your own API key" — model/provider selection is admin-controlled, org-wide, per the requirement. Per-user keys are a reasonable future extension, not this pass.
- No voice input for the chat assistant.
- No multi-user real-time collaboration on a chat session or resume (unchanged from v1 Section 9 / v3 B.7).
- Feature 4's exact shape (cover letters vs. an alternative) is explicitly not decided by this doc — see 4.6.

---

## Suggested Execution Order

1. **Section 0** — admin `role`, `AiProviderConfig`, and `packages/ai` with at least the OpenAI and Anthropic adapters working end-to-end for a trivial completion call. Nothing else can be tested without this.
2. **Feature 1** — chat assistant: tool-calling against the existing Zod schemas, streaming, undo/redo integration. This is the highest-complexity piece; get it solid before building the features that lean on the same AI layer.
3. **Feature 2** — ATS scoring (rule-based checks first, they're free and fast to verify; layer in the AI-assisted checks once Feature 1 has proven the provider layer works reliably under real use).
4. **Feature 3** — JD match, including the "Apply with AI" hand-off into Feature 1.
5. Confirm Feature 4's direction with the user, then build it.

---

## Definition of Done

- Admin can switch the active provider/model for chat, ATS, and JD-match independently from `/admin/ai-settings`, and the change takes effect without a redeploy.
- No raw API key ever reaches the browser or the database in plaintext.
- Every AI-driven edit to a resume is validated against the existing `packages/types` schemas before being applied — an invalid tool call is rejected and surfaced as an error, never partially applied.
- AI-made edits are fully undoable via the existing undo/redo stack, indistinguishable in mechanism from a manual edit.
- ATS score and JD match both produce specific, resume-anchored guidance — no generic advice with nothing to click or act on.
- The "Apply with AI" action from JD match correctly round-trips into the chat assistant's tool-calling pipeline and updates the visible canvas.
- Every new panel (chat, ATS, JD match, and Feature 4 once chosen) has real loading, empty, and error states, and matches the app's existing design language (v1 Section 6) — no default/unstyled chat-widget or dashboard-template look.
- Provider timeouts and failures surface a real, specific error to the user in every feature — never a silent hang or a generic "something went wrong."
- No new console errors/warnings; responsive check at tablet width for all new panels, consistent with the desktop-first allowance already established for the editor in v1/v2/v3.