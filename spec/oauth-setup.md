# OAuth (P5) — activation checklist

The code is written and **inert**: with no credentials set, `apps/api` boots
exactly as before (the OAuth router is loaded only when a provider is configured,
via a guarded dynamic import in `apps/api/src/index.ts`). To turn it on:

## 1. Install dependencies
Added to `apps/api/package.json` but not yet installed (Bash was unavailable):
```
bun install
```
Pulls `passport`, `passport-google-oauth20`, `passport-github2` and their
`@types/*`.

## 2. Apply the database migration
`packages/db/prisma/schema.prisma` now has: `passwordHash` nullable, plus
`oauthProvider` / `oauthId` and a `@@unique([oauthProvider, oauthId])`.
```
bun run db:up            # ensure Postgres is running
bun run db:migrate       # create + apply the migration
bun run db:generate      # regenerate the Prisma client
```

## 3. Register OAuth apps and set env vars
In `apps/api/.env` (see `.env.example`):

**Google** — Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web):
- Authorized redirect URI: `http://localhost:4000/auth/google/callback`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

**GitHub** — Developer settings → OAuth Apps → New:
- Authorization callback URL: `http://localhost:4000/auth/github/callback`
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`

Set `API_ORIGIN` if the API isn't at `http://localhost:4000` (the callback URLs
are derived from it).

## 4. Verify
- Restart the API; it logs normally and now serves `/auth/google` and `/auth/github`.
- New-user path: sign in with a provider account that has no existing resume account → lands on `/dashboard`, a `User` row is created with `oauthProvider`/`oauthId` and null `passwordHash`.
- Linking path: with a provider email that matches an existing password account **and is verified**, the identity links to that row. If unverified → redirect to `/login?error=link_conflict` with the "sign in with your password first" message.
- Denied consent / provider error → `/login?error=oauth_failed` with a friendly message.

## Design notes
- Both providers terminate in the **same JWT httpOnly cookie** as password login (`setAuthCookie` + `signToken` from `apps/api/src/middleware/auth.ts`), so `/auth/me`, route protection, and logout are unchanged.
- Account-linking rule enforced in `resolveUser()` (`apps/api/src/routes/oauth.ts`): auto-link by email only when the provider reports it verified; otherwise refuse.
- Frontend buttons live in `apps/web/components/auth-form.tsx` (`OAuthButton`), redirecting to `api.oauthUrl(provider)`.
