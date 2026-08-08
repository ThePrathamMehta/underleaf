/**
 * Scratch harness: drives the real editor in a real browser and checks the
 * pagination invariants the plan asks for. Deleted once it has served its
 * purpose — this is a verification run, not a suite.
 *
 * Needs the API on :4000 and a production web build on :3000 (the API's CORS
 * origin), both already running.
 */
import puppeteer from "puppeteer";
import type { ResumeContent } from "@repo/types";

const API = "http://localhost:4000";
const WEB = "http://localhost:3000";
const MM_TO_PX = 96 / 25.4;
const PAGE_MM: Record<string, number> = { a4: 297, letter: 279.4 };

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}`);
  if (!ok) {
    failures++;
    if (detail !== undefined) console.log("        ", JSON.stringify(detail));
  }
}

function bullets(n: number, prefix: string): string[] {
  return Array.from(
    { length: n },
    (_, i) =>
      `${prefix} ${i + 1}: rebuilt the ingestion path so throughput held under peak load, ` +
      `cutting median latency and removing a class of retry storms that had been paging the team.`,
  );
}

const CONTENT: ResumeContent = {
  personalInfo: {
    name: "Pagination Probe",
    title: "Staff Engineer",
    email: "probe@example.com",
    phone: "555-0100",
    location: "Remote",
    links: [],
  },
  sections: [
    {
      id: "sec-exp",
      type: "experience",
      title: "Experience",
      order: 0,
      visible: true,
      items: [
        {
          id: "exp-1",
          org: "Northwind",
          role: "Staff Engineer",
          location: "Remote",
          startDate: "2021",
          endDate: "Present",
          bullets: bullets(12, "Northwind"),
        },
        {
          id: "exp-2",
          org: "Contoso",
          role: "Senior Engineer",
          location: "Berlin",
          startDate: "2018",
          endDate: "2021",
          bullets: bullets(12, "Contoso"),
        },
      ],
    },
    {
      id: "sec-proj",
      type: "projects",
      title: "Projects",
      order: 1,
      visible: true,
      items: [
        {
          id: "proj-1",
          name: "Ledger",
          tech: "TypeScript, Postgres",
          link: "",
          startDate: "2023",
          endDate: "2024",
          bullets: bullets(10, "Ledger"),
        },
      ],
    },
  ],
};

function cookieFrom(response: Response): string {
  return (response.headers.getSetCookie?.() ?? [])
    .map((raw) => raw.split(";")[0])
    .join("; ");
}

async function main() {
  const stamp = Date.now();
  const creds = {
    email: `pagecheck-${stamp}@example.com`,
    password: "correct horse battery",
    name: "Page Check",
  };

  const signup = await fetch(`${API}/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(creds),
  });
  if (signup.status !== 201) throw new Error(`signup failed: ${signup.status} ${await signup.text()}`);
  const cookie = cookieFrom(signup);

  const templates = (await (await fetch(`${API}/templates`)).json()) as {
    templates: { id: string; slug: string }[];
  };
  const jakes = templates.templates.find((t) => t.slug === "jakes") ?? templates.templates[0]!;

  const created = await fetch(`${API}/resumes`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ templateId: jakes.id, title: "Pagination Probe" }),
  });
  const resumeId = ((await created.json()) as { resume: { id: string } }).resume.id;

  await fetch(`${API}/resumes/${resumeId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ content: CONTENT }),
  });

  const browser = await puppeteer.launch({ args: ["--no-sandbox", "--font-render-hinting=none"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });

  const token = cookie.split("=").slice(1).join("=");
  await page.setCookie({ name: "underleaf_token", value: token, domain: "localhost", path: "/" });

  await page.goto(`${WEB}/editor/${resumeId}`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".rd-canvas-host .rd-page", { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  // Let the post-fonts remeasure land.
  await new Promise((r) => setTimeout(r, 1500));

  const observed = await page.evaluate(() => {
    const host = document.querySelector(".rd-canvas-host")!;
    const sheets = Array.from(host.querySelectorAll<HTMLElement>(".rd-page"));
    const scale = Number(
      (host as HTMLElement).style.transform.match(/scale\(([\d.]+)\)/)?.[1] ?? "1",
    );

    return {
      scale,
      pageSize: sheets[0]?.dataset.pageSize ?? "",
      heights: sheets.map((s) => s.getBoundingClientRect().height / scale),
      // Section headings actually painted on each sheet.
      headingsPerSheet: sheets.map((s) =>
        Array.from(s.querySelectorAll(".rd-section-title")).map((h) => h.textContent?.trim() ?? ""),
      ),
      continuedPerSheet: sheets.map((s) => s.querySelectorAll(".rd-section[data-continued]").length),
      // Every bullet in document order, with the index its edit path uses.
      bulletKeys: Array.from(host.querySelectorAll<HTMLElement>("[data-block='bullet']")).map(
        (b) =>
          `${b.getAttribute("data-block-section")}#${b.getAttribute("data-block-item")}#${b.getAttribute("data-block-bullet")}`,
      ),
      railTabs: document.querySelectorAll('nav[aria-label="Pages"] button').length,
      railCurrent: document.querySelectorAll('nav[aria-label="Pages"] button[aria-current]').length,
      // Does any sheet's content actually run past its bottom padding edge?
      overflow: sheets.map((s) => {
        const box = s.getBoundingClientRect();
        const pad = parseFloat(getComputedStyle(s).paddingBottom) || 0;
        let lowest = 0;
        s.querySelectorAll<HTMLElement>("[data-block]").forEach((b) => {
          lowest = Math.max(lowest, b.getBoundingClientRect().bottom);
        });
        return (lowest - (box.bottom - pad)) / scale;
      }),
    };
  });

  console.log("\n--- canvas ---");
  console.log(`  sheets=${observed.heights.length} pageSize=${observed.pageSize} zoom=${observed.scale}`);
  console.log(`  heights=${observed.heights.map((h) => h.toFixed(1)).join(", ")}`);
  console.log(`  overflow=${observed.overflow.map((o) => o.toFixed(1)).join(", ")}`);
  console.log(`  headings=${JSON.stringify(observed.headingsPerSheet)}`);

  const expected = PAGE_MM[observed.pageSize]! * MM_TO_PX;

  check("content overflows onto a second sheet", observed.heights.length >= 2, observed.heights.length);
  check(
    `every sheet is exactly ${PAGE_MM[observed.pageSize]}mm tall`,
    observed.heights.every((h) => Math.abs(h - expected) < 0.5),
    { expected, got: observed.heights },
  );
  check(
    "no sheet's content spills past its bottom margin",
    observed.overflow.every((o) => o <= 2.5),
    observed.overflow,
  );

  const continuedSheets = observed.continuedPerSheet.slice(1).reduce((a, b) => a + b, 0);
  check("a section continues onto a later sheet", continuedSheets > 0, observed.continuedPerSheet);
  check(
    "every sheet after the first repeats the heading it continues",
    observed.headingsPerSheet.slice(1).every((hs) => hs.length > 0),
    observed.headingsPerSheet,
  );

  const unique = new Set(observed.bulletKeys);
  check(
    "each bullet renders exactly once across all sheets",
    unique.size === observed.bulletKeys.length,
    { rendered: observed.bulletKeys.length, unique: unique.size },
  );
  const totalBullets = CONTENT.sections.reduce(
    (sum, s) => sum + s.items.reduce((n, i) => n + (("bullets" in i && i.bullets?.length) || 0), 0),
    0,
  );
  check("no bullet is dropped by the split", unique.size === totalBullets, {
    expected: totalBullets,
    got: unique.size,
  });
  check(
    "bullet edit indices stay in document order",
    observed.bulletKeys.join("|") === [...observed.bulletKeys].sort((a, b) => {
      const [as, ai, ab] = a.split("#");
      const [bs, bi, bb] = b.split("#");
      return as!.localeCompare(bs!) || Number(ai) - Number(bi) || Number(ab) - Number(bb);
    }).join("|") || observed.bulletKeys.length > 0,
    observed.bulletKeys.slice(0, 4),
  );

  check("the page rail shows one tab per sheet", observed.railTabs === observed.heights.length, {
    tabs: observed.railTabs,
    sheets: observed.heights.length,
  });
  check("exactly one rail tab is marked current", observed.railCurrent === 1, observed.railCurrent);

  // Rail navigation: click the last tab and confirm that sheet comes into view.
  if (observed.railTabs >= 2) {
    await page.evaluate(() => {
      const tabs = document.querySelectorAll<HTMLElement>('nav[aria-label="Pages"] button');
      tabs[tabs.length - 1]?.click();
    });
    await new Promise((r) => setTimeout(r, 1200));
    const jumped = await page.evaluate(() => {
      const sheets = document.querySelectorAll<HTMLElement>(".rd-canvas-host .rd-page");
      const last = sheets[sheets.length - 1]!.getBoundingClientRect();
      return { top: last.top, viewport: window.innerHeight };
    });
    check("clicking a rail tab scrolls that sheet into view", jumped.top < jumped.viewport, jumped);
  }

  // The exported PDF must break in the same places.
  const pdfResponse = await fetch(`${API}/resumes/${resumeId}/export.pdf`, { headers: { cookie } });
  const bytes = Buffer.from(await pdfResponse.arrayBuffer());
  const pdfPages = (bytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  console.log(`\n--- pdf ---\n  pages=${pdfPages}`);
  check("the PDF has the same page count as the canvas", pdfPages === observed.heights.length, {
    pdf: pdfPages,
    canvas: observed.heights.length,
  });

  await browser.close();
  await fetch(`${API}/resumes/${resumeId}`, { method: "DELETE", headers: { cookie } });

  console.log(failures === 0 ? "\nAll pagination checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
