# Prompt for Claude Code — "Underleaf" (Overleaf-style Resume Builder, No-Code Editor)

Copy everything below into Claude Code (in your existing Turborepo).

---

## Context

I have an existing Turborepo monorepo. I want to build **v1 of a resume-builder web app** called `Underleaf`. Think "Overleaf/Canva for resumes" — the user never sees or touches LaTeX/code. They pick a professionally designed template, then edit everything visually on a canvas (text, fonts, spacing, colors, section order) the way they would in Microsoft Word / Canva, and export a polished PDF.

This is v1. Scope is: **great frontend + working canvas editor + template gallery + basic auth + Postgres/Prisma/Express backend to persist resumes.** Do not build billing, sharing/collaboration, AI content suggestions, or a mobile app in this pass — stub or skip them.

---

## 1. Tech stack (use exactly this)

- **Monorepo:** existing Turborepo (pnpm workspaces)
- **Frontend app:** `apps/web` — Next.js 14+ (App Router), TypeScript, Tailwind CSS, Framer Motion for animation
- **Backend app:** `apps/api` — Node.js + Express, TypeScript
- **Database:** PostgreSQL
- **ORM:** Prisma (schema lives in `packages/db`, shared client exported to both apps)
- **Shared packages:** `packages/ui` (shared React components/design tokens), `packages/types` (shared TS types/zod schemas for resume data model), `packages/config` (eslint/tsconfig)
- **Canvas/editor rendering:** render the resume as real HTML/CSS in the browser (not an actual `<canvas>` element) so it stays editable, accessible, and easy to convert to PDF. Use `contentEditable` regions / a structured block-based editor (similar approach to Notion-style editors) rather than free-form canvas dragging for v1 — this is far more reliable than pixel-perfect drag-and-drop and still feels like "editing a document directly."
- **PDF export:** Puppeteer (headless Chromium) on the backend — render the resume's HTML/CSS route server-side and print to PDF. This guarantees the exported PDF matches the on-screen design exactly.
- **Auth:** simple email/password with JWT (httpOnly cookie) for v1. Keep it minimal — a `User` table, bcrypt password hashing, login/signup/logout endpoints.

---

## 2. Monorepo structure to set up

```
apps/
  web/                # Next.js frontend
  api/                # Express backend
packages/
  db/                 # Prisma schema + generated client, exported as @repo/db
  types/              # Zod schemas + TS types for Resume/Section/Block, exported as @repo/types
  ui/                 # Shared design-system components, exported as @repo/ui
  config-eslint/
  config-typescript/
```

Wire up `turbo.json` pipelines for `dev`, `build`, `lint`, `db:generate`, `db:migrate` so `turbo dev` runs both `web` and `api` concurrently.

---

## 3. Core data model (Prisma schema, `packages/db/schema.prisma`)

Design a schema roughly like this (adjust naming as needed, but keep the concepts):

- `User` — id, email, passwordHash, name, createdAt
- `Template` — id, name, slug, description, previewImageUrl, category (e.g. "Software Engineer", "Academic", "Creative", "Minimal"), isPremium (bool, default false, unused in v1 but reserve the field), defaultTheme (JSON: font family, font size scale, color palette, spacing, layout type e.g. single-column/two-column/sidebar)
- `Resume` — id, userId (FK), templateId (FK), title, content (JSON — the structured resume data: personal info, sections, blocks, and order), theme (JSON — the user's overrides of the template's default theme: fonts/colors/spacing/margins), createdAt, updatedAt
- Keep `content` as a well-typed JSON blob validated against a Zod schema in `packages/types` (don't over-normalize into dozens of relational tables for v1 — a structured JSON document is the right call for a document editor, similar to how Notion/Google Docs store content).

Define the Zod schema for `content` explicitly, something like:
```
Resume
 ├─ personalInfo: { name, title, email, phone, location, links[] }
 └─ sections: Section[]
     Section: { id, type: 'summary'|'experience'|'education'|'skills'|'projects'|'certifications'|'custom', title, order, visible, items: SectionItem[] }
     SectionItem (varies by type, e.g. Experience): { id, org, role, location, startDate, endDate, bullets: string[] }
```

And the `theme` JSON:
```
{ fontFamily, headingFontFamily, fontSizeScale, accentColor, textColor, lineSpacing, marginSize, layout: 'single-column' | 'sidebar-left' | 'sidebar-right' | 'two-column' }
```

---

## 4. Template gallery — seed with real, well-known templates

Recreate (as original HTML/CSS layouts inspired by, not copied pixel-for-pixel from, the LaTeX source — since the LaTeX itself is copyrighted/licensed) the **layout structure and visual language** of these widely recognized resume formats, and seed the database with them:

1. **"Jake's Resume"** — the extremely popular single-column, ATS-friendly software-engineer resume format (originally a LaTeX template by Sourabh Bajaj / adapted by Jake Gutierrez). Clean serif/sans headings, horizontal rule under each section title, right-aligned dates, tight bullet spacing. This should be your **default template**.
2. **"Deedy/Awesome-CV style"** — two-column sidebar layout (skills/contact/education in a narrow left sidebar, experience/projects in the wide right column), bold color accent bar.
3. **"Modern Minimal"** — generous white space, large name header, thin accent-colored section dividers, sans-serif throughout (Helvetica/Inter-style).
4. **"Classic Professional / ModernCV style"** — traditional serif, centered header, conservative — good for academic/corporate roles.
5. **"Creative/Colored Header"** — a colored header band with name + title in reversed (white-on-color) text, useful for design/marketing roles.

For each, build it as real, semantic HTML+CSS (a React component in `packages/ui` or `apps/web`) driven entirely by the `theme` and `content` JSON — not hardcoded text — so every template can render *any* resume's data. Store a rendered preview screenshot (`previewImageUrl`) for the gallery thumbnail (can be a static generated PNG for v1).

---

## 5. Pages / user flow

1. **Landing page** (`/`) — polished marketing page explaining the product, with a "Create your resume" CTA. Should NOT look like a generic AI-generated SaaS landing page — see design direction below.
2. **Template gallery** (`/templates`) — grid of template cards with live preview thumbnails, hover animation (subtle scale/shadow lift), category filter chips (Software, Academic, Creative, Minimal, etc.), "Use this template" button.
3. **Editor** (`/editor/[resumeId]`) — the core screen:
   - **Left/top toolbar** (Word/Canva-style): font family dropdown, font size, bold/italic/underline, text color, section color accent, spacing/margin controls, undo/redo, "Add Section" button, template switcher (swap template without losing content), Save (autosave + manual save indicator), Export as PDF button.
   - **Center canvas**: the live resume, rendered in a fixed page-size container (A4/Letter toggle), edited in place — click text to edit it directly, drag section handles to reorder sections (use a library like `@dnd-kit/core` for reordering), hover controls to add/remove bullet points or entries within a section.
   - **Right panel (optional but nice)**: section visibility toggles, quick "add section" (e.g. Certifications, Languages, Volunteer Work, Publications), theme presets (color palette swatches).
   - Autosave to backend every few seconds of inactivity (debounced), with a subtle "Saved" / "Saving…" indicator — no jarring save button dependency.
4. **Dashboard** (`/dashboard`) — logged-in user's list of saved resumes as cards (thumbnail, title, last edited), "New Resume" CTA, duplicate/delete actions.
5. **Auth pages** (`/login`, `/signup`) — clean, minimal forms.

---

## 6. Design direction — critical, read carefully

The single biggest risk in this project is that the UI ends up looking like a generic, templated "AI-generated SaaS app" (centered hero, purple-to-blue gradient, generic rounded cards, Inter font everywhere, no personality). **Actively avoid that.** Specifically:

- Pick **one distinctive, opinionated visual direction** for the app's own UI (not the resume templates — the app chrome itself) and commit to it. E.g.: a warm, editorial, "paper and ink" aesthetic (cream background, deep charcoal text, a single confident accent color like burnt orange or deep green, serif display headings paired with a clean sans body) — something that feels like a considered product, not a Bootstrap/shadcn default.
- Use **real type hierarchy**: a distinctive display/heading font (self-hosted, e.g. via `next/font`) paired deliberately with a body font — not the same font at different weights everywhere.
- Use **purposeful micro-animations** with Framer Motion: page transitions, staggered card entrances on the template gallery, a satisfying spring animation when a section is reordered, a subtle pulse on the "Saved" indicator, hover states with real personality (not just `opacity: 0.9`).
- Avoid: default shadcn/ui look-and-feel with zero customization, purple/indigo gradients, generic stock "3 feature cards with icons" sections, centered-everything layouts, emoji as icons.
- Reference points for quality bar: Linear, Arc browser marketing site, Notion, Cron (before Notion Calendar rebrand), Raycast — products that feel crafted, not scaffolded.
- The **resume templates themselves**, by contrast, should look conservative, professional, and print-appropriate (that's what makes them good resumes) — the personality/flair belongs to the *app UI*, not the resumes.

---

## 7. Backend API (Express, `apps/api`)

Build a REST API with routes roughly like:

- `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- `GET /templates` — list all templates (with category filter query param)
- `GET /templates/:id`
- `GET /resumes` — list current user's resumes
- `POST /resumes` — create new resume from a template (body: `templateId`, optional `title`)
- `GET /resumes/:id`
- `PATCH /resumes/:id` — update `content`/`theme`/`title` (this is what autosave calls)
- `DELETE /resumes/:id`
- `POST /resumes/:id/duplicate`
- `GET /resumes/:id/export.pdf` — server-side render via Puppeteer and stream back a PDF

Validate all request bodies with the shared Zod schemas from `packages/types`. Protect all `/resumes*` routes with JWT auth middleware, and always scope queries by the authenticated `userId`.

---

## 8. What to actually build, in order

1. Scaffold the Turborepo structure (`packages/db`, `packages/types`, `packages/ui`, `apps/web`, `apps/api`) with working `turbo dev`.
2. Prisma schema + migration + seed script that inserts the 5 templates described above with sensible default `theme` JSON and a sample `content` payload each, so the gallery isn't empty.
3. Express API with auth + resumes + templates routes, tested via curl/Postman collection or a simple script.
4. Shared resume-rendering component(s) in `packages/ui` that take `(template, content, theme)` and render the resume — this is the component both the editor canvas AND the Puppeteer PDF export route will use, so they stay pixel-identical.
5. Frontend: landing page → auth → template gallery → editor → dashboard, in that order, wiring up the API as you go.
6. Autosave + PDF export wired end-to-end.
7. Polish pass: animations, empty states, loading states, error states, responsive behavior down to tablet width (mobile editing can be out of scope for v1, but the marketing/gallery/dashboard pages should be responsive).

---

## 9. Explicit non-goals for v1

- No LaTeX exposure anywhere in the UI.
- No AI-generated resume content/bullet suggestions.
- No payments/subscriptions.
- No real-time collaboration or sharing links.
- No pixel-level free-drag canvas positioning — use the structured block editor described above.
- No mobile app.

---

## 10. Deliverable

At the end, I should be able to run `turbo dev`, sign up, land on a genuinely good-looking landing page, browse a gallery of 5 real resume templates, pick one, edit it live in the browser (text, fonts, colors, section order, spacing) with no code visible anywhere, have it autosave to Postgres via the Express API, and export a matching PDF.

Ask me clarifying questions before starting if anything about the data model, auth approach, or design direction is ambiguous — otherwise proceed and build it.