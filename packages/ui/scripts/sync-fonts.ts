/**
 * Copies WOFF2 files out of the installed @fontsource packages into
 * `src/resume/fonts/`, under the stable names the renderer expects.
 *
 * Vendoring rather than importing at runtime keeps the font bytes identical
 * across the browser and Puppeteer, and means the export path can read them
 * from disk without resolving a node_modules layout.
 *
 * Run: bun run sync-fonts
 */
import { mkdir, copyFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const OUT_DIR = fileURLToPath(new URL("../src/resume/fonts/", import.meta.url));

/**
 * The web app serves the same bytes over HTTP for the editor canvas, while the
 * API inlines them as base64. Both must be byte-identical or the PDF and the
 * screen would use different font files.
 */
const WEB_PUBLIC_DIR = fileURLToPath(new URL("../../../apps/web/public/fonts/", import.meta.url));

/** target filename -> [package, latin woff2 basename] */
const COPIES: Array<[string, string, string]> = [
  ["inter-400.woff2", "@fontsource/inter", "inter-latin-400-normal.woff2"],
  ["inter-700.woff2", "@fontsource/inter", "inter-latin-700-normal.woff2"],

  ["lato-400.woff2", "@fontsource/lato", "lato-latin-400-normal.woff2"],
  ["lato-700.woff2", "@fontsource/lato", "lato-latin-700-normal.woff2"],
  ["lato-400-italic.woff2", "@fontsource/lato", "lato-latin-400-italic.woff2"],

  ["roboto-400.woff2", "@fontsource/roboto", "roboto-latin-400-normal.woff2"],
  ["roboto-700.woff2", "@fontsource/roboto", "roboto-latin-700-normal.woff2"],
  ["roboto-400-italic.woff2", "@fontsource/roboto", "roboto-latin-400-italic.woff2"],

  ["source-serif-400.woff2", "@fontsource/source-serif-4", "source-serif-4-latin-400-normal.woff2"],
  ["source-serif-700.woff2", "@fontsource/source-serif-4", "source-serif-4-latin-700-normal.woff2"],
  ["source-serif-400-italic.woff2", "@fontsource/source-serif-4", "source-serif-4-latin-400-italic.woff2"],

  ["eb-garamond-400.woff2", "@fontsource/eb-garamond", "eb-garamond-latin-400-normal.woff2"],
  ["eb-garamond-700.woff2", "@fontsource/eb-garamond", "eb-garamond-latin-700-normal.woff2"],
  ["eb-garamond-400-italic.woff2", "@fontsource/eb-garamond", "eb-garamond-latin-400-italic.woff2"],

  ["merriweather-400.woff2", "@fontsource/merriweather", "merriweather-latin-400-normal.woff2"],
  ["merriweather-700.woff2", "@fontsource/merriweather", "merriweather-latin-700-normal.woff2"],
  ["merriweather-400-italic.woff2", "@fontsource/merriweather", "merriweather-latin-400-italic.woff2"],
];

function packageFilesDir(pkg: string): string {
  // Resolve via the package's own package.json so we don't guess at hoisting.
  const manifest = Bun.resolveSync(`${pkg}/package.json`, import.meta.dir);
  return path.join(path.dirname(manifest), "files");
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(WEB_PUBLIC_DIR, { recursive: true });

  const missing: string[] = [];
  let copied = 0;

  for (const [target, pkg, source] of COPIES) {
    let dir: string;
    try {
      dir = packageFilesDir(pkg);
    } catch {
      missing.push(`${target} (package ${pkg} not installed)`);
      continue;
    }

    const from = path.join(dir, source);
    if (!existsSync(from)) {
      // Fontsource occasionally renames files between majors; list what's there
      // so the fix is obvious instead of a bare ENOENT.
      const available = (await readdir(dir)).filter((f) => f.endsWith(".woff2")).slice(0, 6);
      missing.push(`${target} — ${source} not in ${pkg}/files (saw: ${available.join(", ")})`);
      continue;
    }

    await copyFile(from, path.join(OUT_DIR, target));
    await copyFile(from, path.join(WEB_PUBLIC_DIR, target));
    copied++;
  }

  console.log(`Copied ${copied}/${COPIES.length} font files to packages/ui and apps/web/public`);

  if (missing.length > 0) {
    console.error(`\n${missing.length} file(s) could not be copied:`);
    for (const m of missing) console.error(`  - ${m}`);
    process.exit(1);
  }
}

main();
