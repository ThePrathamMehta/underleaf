/**
 * Browser entry for `check-fit-page.ts`: puts the fit search on `window`.
 *
 * Needed because `searchFit` is not self-contained the way `measureFlow` is — it
 * calls into `packBlocks` and `themeToCssVars` — so it can't be handed to
 * `page.evaluate`, which only ships a function's own source. Bundling this file
 * and injecting the result is what gets the real module into the page, rather
 * than a copy of it that could drift.
 */
import { searchFit } from "@repo/ui/resume/fit-page";

(globalThis as unknown as { __searchFit: typeof searchFit }).__searchFit = searchFit;
