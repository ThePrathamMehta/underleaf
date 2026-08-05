# CLAUDE.md — Underleaf v2: Bug Fixes, Editor Overhaul, OAuth

This is a follow-up spec to the v1 build doc. It assumes the v1 architecture is in place: Turborepo (`apps/web` Next.js App Router, `apps/api` Express), Postgres via Prisma (`packages/db`), Zod schemas in `packages/types`, shared resume-rendering components in `packages/ui`, JWT-in-httpOnly-cookie auth, `contentEditable`-based block editor, Puppeteer PDF export, Framer Motion for animation.

**Do not change fonts.** All visual work here is layout/color/spacing/motion only, in both the app chrome and the resume templates, unless a section says otherwise.

Work in the priority order below — P0 blocks real testing of everything else.

---

## Priority 0 — Critical Bugs

### P0.1 — Editor: cursor resets to position 0 while typing

**Where:** `apps/web`, the editor canvas at `/editor/[resumeId]`, in whatever component renders each `contentEditable` block (personal info fields, section item fields, bullets).

**Root cause (near-certain, given the v1 architecture):** the block editor holds resume data as the `content` JSON blob (per `packages/types`), and the canvas renders each block as a `contentEditable` element. Somewhere the DOM is being overwritten from that JSON state on every keystroke — most likely one of:

1. The `contentEditable` element's rendered text/innerHTML is derived directly from `content` state in JSX (e.g. `<div contentEditable dangerouslySetInnerHTML={{ __html: block.text }} />` or setting `.innerText`/`.innerHTML` in a `useEffect` keyed on `block.text`). Every `onInput` → `setState` → re-render loop then re-writes the DOM node's content from scratch, which always collapses the caret to the start.
2. The debounced autosave hook is also driving a local state update on the *same* tick as the keystroke (not just firing a network call), causing a redundant re-render/re-sync of the DOM from state.
3. A `key` prop on the block/editor component is derived from something that changes per keystroke (e.g. a content hash or `Date.now()`), forcing React to unmount/remount the node.

**Required fix pattern:**
- Treat each `contentEditable` block as an **uncontrolled** element for the purpose of local typing. On `onInput`, read `e.currentTarget.textContent`/`innerHTML` and update the `content` JSON in state/store — but do **not** write that value back into the DOM in response to your own local update.
- Only imperatively set the DOM content (`el.innerText = ...` etc.) when the change originates from *outside* this element's own typing — e.g. on initial mount, when switching templates, on undo/redo, or when another client/session updates the same resume. Guard this with a ref that tracks "did this update come from me" (a common pattern: compare against a `lastKnownValueRef` and skip the DOM write if it matches what this element already produced).
- If a rich-text/block-editor library is not already in use and this hand-rolled `contentEditable` approach keeps causing caret bugs, consider migrating individual block editing to **Tiptap** (ProseMirror-based, handles cursor/selection internally, integrates cleanly with React and with a JSON-serializable doc model close to what `packages/types` already expects). This is a valid fix, not just a workaround — flag it as an option if the hand-rolled fix proves fragile across bullet lists / multi-line fields.
- **Test explicitly:** type 40+ continuous characters in a personal-info field, a paragraph-style field (summary), and a bullet inside an Experience item. Confirm caret never jumps, backspace/delete work correctly at any cursor position, and autosave still fires without disrupting typing.

### P0.2 — Editor header: clicks do nothing

**Where:** the editor toolbar component in `apps/web` (font family/size, bold/italic/underline, Undo/Redo, Add Section, template switcher, Save indicator, Export PDF).

**Investigation checklist:**
- Confirm every toolbar control actually has an `onClick`/`onSelect` handler wired to a real function — not just Tailwind button styling with no handler, which is easy to end up with if the toolbar was scaffolded before the editor state/store existed.
- Check for a stale/incorrect disabled condition — e.g. an `isEditorReady` or `isLoading` flag from the resume-fetch hook that never flips to `true`/`false` correctly, silently disabling the whole toolbar.
- Check for a transparent overlay or the canvas's own drag-and-drop layer (`@dnd-kit`) sitting on top of the toolbar in the DOM stacking order, intercepting clicks meant for toolbar buttons.
- Check that toolbar actions which need a "current selection" (bold/italic/color on selected text) aren't silently no-oping because `document.getSelection()`/the editor's selection state is empty or stale when the button is clicked (common when the button click itself steals focus from the `contentEditable` element before the handler reads the selection — fix by using `onMouseDown` + `preventDefault()` on toolbar buttons so focus/selection isn't lost before the click handler runs).

**Fix requirement:** every control in the table below (Priority 1) must produce a real, correct, visible effect.

---

## Priority 1 — Editor Header/Toolbar: Full Feature Set

Build out the toolbar to actually match what v1 spec'd (Section 5.3) plus the additions below:

| Feature | Behavior |
|---|---|
| Font family / size / bold / italic / underline / text color | Apply to current selection within the active block; update `theme`/block-level overrides in `content` JSON |
| Accent color picker | Updates `theme.accentColor`, live-reflected in canvas |
| Spacing / margin controls | Updates `theme.lineSpacing`, `theme.marginSize` |
| Undo / Redo | Real history stack over `content`/`theme` state (not just browser-native contentEditable undo, which won't survive structural changes like reordering); Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z |
| Add Section | Inserts a new `Section` into `content.sections` (Certifications, Languages, Volunteer, Publications, or custom-named) |
| **Add Page** | See Priority 3.2 below |
| Template switcher | Swaps `templateId`, re-renders `content` through the new template's component from `packages/ui` without losing data (per v1 Section 5.3 — confirm this actually works, since it's foundational to "Start from Blank" too) |
| Save indicator | Reflects actual debounced-autosave network state: "Saving…" / "All changes saved" / "Save failed — retry" (not just a static label) |
| Export as PDF | Calls `GET /resumes/:id/export.pdf`; handle loading state on the button and surface a real error if Puppeteer render fails |
| Page size toggle (A4/Letter) | Per v1 Section 5.3 |
| Dark mode toggle | See Priority 4 |
| User menu | Avatar/initials → account settings, logout (clears JWT cookie via `/auth/logout`) |
| Back to dashboard | Warn on unsaved changes before navigating away (check autosave status, not just a dirty flag that might be stale) |

---

## Priority 2 — Visual Polish

### 2.1 Landing page hero
Per v1 Section 6's design direction (editorial, opinionated, not generic-SaaS): add a Framer Motion animation to the hero's visual side — e.g. a mock resume card that gently parallaxes on mouse move, or sections of a sample resume staggering into place on load ("watch your resume assemble itself" — fitting for the product). GPU-friendly transforms/opacity only. Respect `prefers-reduced-motion`.

### 2.2 Template gallery (`/templates`)
- Hover state on template cards: scale + shadow lift (Framer Motion `whileHover`).
- Live preview on click/hover before committing (modal or slide-over), not just the static thumbnail.
- Category filter chips, per v1 Section 5.2.
- Skeleton loading states instead of blank flash while `GET /templates` resolves.
- Add a **"Start from Blank"** card, pinned first in the grid — see Priority 3.1.

---

## Priority 3 — New Features

### 3.1 Start from a Blank Template
- No new template row or code path needed structurally — this is a `Resume` created against the existing default template (**Jake's Resume**, per v1 Section 4, item 1) but with a minimal empty `content` payload: empty `personalInfo`, and an empty or minimally-scaffolded `sections` array (e.g. Experience/Education/Skills present but with zero items) so the user isn't staring at a truly blank canvas with no structure to work from.
- Reuses the existing `POST /resumes` endpoint — just pass a flag or an explicit empty-content payload instead of a template's default seed content. Confirm with backend whether `POST /resumes` currently forces the template's default `content` on creation; if so, add an option to override it.
- User can apply a different template's visual styling later via the template switcher without losing entered content, same as any other resume.

### 3.2 Multi-page resumes
- Header gets an "Add Page" control (Priority 1 table).
- Data model: extend the `content` schema in `packages/types` so `Section`s (or a new top-level grouping) can be assigned to a `pageIndex`, or introduce an explicit `pages: Page[]` array where each `Page` holds an ordered list of section IDs. Decide this before implementing — it's a schema change, coordinate with `packages/db`/`packages/types` together so the editor, canvas renderer, and PDF export all agree on the shape.
- Editor UI: page thumbnails or tabs in a side rail for navigating between pages; drag-and-drop reordering of pages.
- Delete page requires confirmation if it has content.
- **PDF export (Puppeteer):** since export renders the same shared `packages/ui` component tree used by the canvas, ensure each `Page` renders as a distinct element with a CSS `page-break-after: always` (or use Puppeteer's `pdf({ format, ... })` page boundaries correctly) so pages don't get arbitrarily split mid-section. Test with a 3+ page resume that Puppeteer output has exactly the right page count and no orphaned content.

### 3.3 Recommended additional features (pick per sprint, not all required immediately)
- Section reordering via `@dnd-kit` drag handles (already planned per v1 Section 5.3 — confirm implemented).
- Custom section types beyond the fixed enum in `packages/types` (`type: 'custom'` with a user-provided title — already in the v1 schema, confirm the UI exposes it).
- Resume duplication — `POST /resumes/:id/duplicate` already spec'd in v1 Section 7, confirm wired to a dashboard action.
- Version history (restore earlier autosaved state) — would need either periodic snapshotting of `content`/`theme` to a new `ResumeVersion` table, or reuse of the Undo/Redo stack persisted server-side.
- ATS keyword match checker (paste job description, get match score) — separate scope, likely its own `apps/api` route; explicitly out of scope for this pass unless prioritized.

---

## Priority 4 — Dark Mode

- Toggle lives in the editor header and in a global settings/user menu, available on all pages (landing, gallery, dashboard, editor chrome).
- Default to `prefers-color-scheme`, let the user override, persist the choice (localStorage is fine for v1 since there's no user-settings table yet; note as a follow-up to persist server-side once one exists).
- **The resume canvas/preview and PDF export stay light/print-appropriate** regardless of app dark mode — do not let dark mode bleed into the actual resume templates' rendered output, since these are meant to be printed/read on white. Dark mode is app-chrome-only (nav, toolbar, gallery, dashboard, landing page).
- Implement via Tailwind's `dark:` variant + a `class`-based dark mode strategy (add/remove a `dark` class on `<html>`), not the `media` strategy, so the manual override works.
- Verify WCAG AA contrast in dark mode for all text/icon/button states, including the toolbar's active/disabled states.

---

## Priority 5 — OAuth Login (Google + GitHub)

**Current state:** email/password with JWT in an httpOnly cookie, bcrypt-hashed passwords, all in `apps/api` (per v1 Section 1 and Section 7).

**Approach:** since this is a custom Express/JWT setup (not NextAuth/Clerk), add OAuth via **Passport.js** in `apps/api`, using `passport-google-oauth20` and `passport-github2` strategies, and have both strategies terminate in the **same JWT-issuance code path** the email/password login already uses — so downstream session handling (the httpOnly cookie, `GET /auth/me`, route protection middleware) doesn't need to know or care how the user authenticated.

**Data model change (`packages/db`):**
- Add to `User`: `oauthProvider` (nullable enum: `google` | `github`), `oauthId` (nullable string, the provider's user ID), and make `passwordHash` nullable (OAuth-only users won't have one).
- Add a unique constraint on `(oauthProvider, oauthId)`.
- **Account linking rule:** if a user signs in via Google/GitHub with an email that already exists on a password-based account, link the OAuth identity to the existing `User` row **only if the OAuth provider reports the email as verified** — do not silently merge on unverified emails. If ambiguous, prompt the user to confirm ("An account with this email already exists — sign in with your password to link Google") rather than auto-merging.

**Routes to add (`apps/api`):**
- `GET /auth/google` → redirect to Google's OAuth consent screen (Passport handles this)
- `GET /auth/google/callback` → Passport verifies, finds-or-creates/links `User`, issues the same JWT httpOnly cookie as `/auth/login`, redirects to `/dashboard`
- `GET /auth/github` and `GET /auth/github/callback` — same pattern

**Env vars:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, plus callback URLs registered in Google Cloud Console and GitHub Developer Settings pointing at `apps/api`'s deployed/dev origin (e.g. `http://localhost:PORT/auth/google/callback` in dev).

**Frontend (`apps/web`):** add "Continue with Google" / "Continue with GitHub" buttons to `/login` and `/signup`, styled to match the existing design direction from v1 Section 6 (no generic provider-badge default styling that clashes with the editorial aesthetic — treat them as first-class buttons in the same visual language). They simply link/redirect to `/auth/google` and `/auth/github` on the API; no client-side OAuth SDK needed since Passport handles the full redirect flow server-side.

**Error handling:** if the OAuth flow fails (user denies consent, provider outage, email-linking conflict per above), redirect back to `/login` with an error query param and show a real user-facing message — not a raw callback error page.

---

## Suggested Execution Order

1. P0.1 — cursor bug (blocks real dogfooding of the editor).
2. P0.2 — dead toolbar.
3. Priority 1 — full toolbar rebuild (can ship dark-mode toggle and Add Page as functional-but-basic first, polish later).
4. Priority 3.2 — multi-page schema/rendering (data model change, do before 3.1 since 3.1 depends on template switching being solid).
5. Priority 3.1 — Start from Blank (depends on template switcher + multi-page schema being stable).
6. Priority 5 — OAuth.
7. Priority 2 — landing page + gallery visual polish.
8. Priority 4 — dark mode rollout across all pages.
9. Priority 3.3 — pick 1–2 recommended features per sprint.

---

## Definition of Done
- No font changes anywhere, app chrome or resume templates.
- Every fix/feature verified in light and dark mode (once Priority 4 ships).
- No dead UI — every visible control does something correct.
- Multi-page resumes verified end-to-end through actual Puppeteer PDF export, not just on-screen.
- OAuth verified for both new-user signup and existing-email account-linking paths.
- Responsive check at tablet width for any touched page (mobile editing remains out of scope per v1 Section 9).
- No new console errors/warnings.