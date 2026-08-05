/**
 * End-to-end API check. Exercises the full resume lifecycle plus the
 * cross-user authorization boundary, which is the API's main security surface.
 *
 * Requires the api to be running. Run: bun run smoke
 */
const BASE = process.env.API_URL ?? "http://localhost:4000";

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  checks++;
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

/** Captures the auth cookie so each simulated user keeps its own session. */
function cookieFrom(response: Response): string {
  const raw = response.headers.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(";")[0]).join("; ");
}

/**
 * Whatever the endpoint returned. Deliberately loose: this script pokes at
 * response shapes it's asserting *aren't* yet guaranteed, so `unknown` would
 * mean a cast at every single access and assert nothing extra.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

async function call(
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string } = {},
): Promise<{ status: number; json: Json; response: Response }> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const contentType = response.headers.get("content-type") ?? "";
  const json = contentType.includes("application/json") ? await response.json() : {};
  return { status: response.status, json, response };
}

async function main() {
  const stamp = Date.now();
  const userA = { email: `smoke-a-${stamp}@example.com`, password: "correct horse battery", name: "Smoke A" };
  const userB = { email: `smoke-b-${stamp}@example.com`, password: "correct horse battery", name: "Smoke B" };

  console.log(`\nSmoke testing ${BASE}\n`);

  const health = await call("GET", "/health");
  check("GET /health returns ok", health.status === 200 && health.json.ok === true, health.json);

  // --- Auth ---

  const signupA = await call("POST", "/auth/signup", { body: userA });
  check("POST /auth/signup creates user A", signupA.status === 201, signupA.json);
  const cookieA = cookieFrom(signupA.response);
  check("signup sets an auth cookie", cookieA.length > 0);

  const signupB = await call("POST", "/auth/signup", { body: userB });
  const cookieB = cookieFrom(signupB.response);
  check("POST /auth/signup creates user B", signupB.status === 201, signupB.json);

  const duplicate = await call("POST", "/auth/signup", { body: userA });
  check("duplicate signup is rejected with 409", duplicate.status === 409, duplicate.json);

  const badLogin = await call("POST", "/auth/login", {
    body: { email: userA.email, password: "wrong password" },
  });
  check("login with wrong password returns 401", badLogin.status === 401, badLogin.json);

  const shortPassword = await call("POST", "/auth/signup", {
    body: { email: `x-${stamp}@example.com`, password: "short", name: "X" },
  });
  check("signup validation rejects a short password", shortPassword.status === 400, shortPassword.json);

  const login = await call("POST", "/auth/login", {
    body: { email: userA.email, password: userA.password },
  });
  check("POST /auth/login succeeds", login.status === 200, login.json);

  const me = await call("GET", "/auth/me", { cookie: cookieA });
  check("GET /auth/me returns the signed-in user", me.json.user?.email === userA.email, me.json);

  const meAnon = await call("GET", "/auth/me");
  check("GET /auth/me without a cookie returns 401", meAnon.status === 401);

  // --- Templates ---

  const templates = await call("GET", "/templates");
  const templateList = templates.json.templates ?? [];
  check("GET /templates lists all 5 seeded templates", templateList.length === 5, templateList.length);

  const jakes = templateList.find((t: Json) => t.slug === "jakes");
  check("the Jake's template is seeded", Boolean(jakes), templateList.map((t: Json) => t.slug));

  const filtered = await call("GET", "/templates?category=Creative");
  check(
    "GET /templates?category filters",
    (filtered.json.templates ?? []).every((t: Json) => t.category === "Creative"),
    filtered.json.templates,
  );

  const badCategory = await call("GET", "/templates?category=Nonsense");
  check("an unknown category is rejected with 400", badCategory.status === 400, badCategory.json);

  const bySlug = await call("GET", "/templates/jakes");
  check("GET /templates/:slug resolves by slug", bySlug.json.template?.slug === "jakes", bySlug.json);

  // --- Resumes ---

  const anonCreate = await call("POST", "/resumes", { body: { templateId: "jakes" } });
  check("POST /resumes without auth returns 401", anonCreate.status === 401, anonCreate.json);

  const created = await call("POST", "/resumes", {
    body: { templateId: "jakes", title: "Smoke Resume" },
    cookie: cookieA,
  });
  check("POST /resumes creates from a template", created.status === 201, created.json);

  const resumeId = created.json.resume?.id;
  check("the new resume has an id", Boolean(resumeId));
  check(
    "the new resume is seeded with the template's sample content",
    (created.json.resume?.content?.sections ?? []).length > 0,
  );
  check(
    "the new resume inherits the template's theme",
    created.json.resume?.theme?.fontFamily === jakes?.defaultTheme?.fontFamily,
    created.json.resume?.theme,
  );

  const list = await call("GET", "/resumes", { cookie: cookieA });
  check("GET /resumes lists the user's resumes", (list.json.resumes ?? []).length === 1, list.json.resumes?.length);

  // Autosave path.
  const patched = await call("PATCH", `/resumes/${resumeId}`, {
    body: { title: "Renamed By Autosave" },
    cookie: cookieA,
  });
  check("PATCH /resumes/:id updates the title", patched.json.resume?.title === "Renamed By Autosave", patched.json);

  const content = created.json.resume.content;
  content.personalInfo.name = "Edited Name";
  const patchedContent = await call("PATCH", `/resumes/${resumeId}`, {
    body: { content },
    cookie: cookieA,
  });
  check(
    "PATCH /resumes/:id persists edited content",
    patchedContent.json.resume?.content?.personalInfo?.name === "Edited Name",
    patchedContent.json.error,
  );

  const emptyPatch = await call("PATCH", `/resumes/${resumeId}`, { body: {}, cookie: cookieA });
  check("an empty PATCH body is rejected with 400", emptyPatch.status === 400, emptyPatch.json);

  const badTheme = await call("PATCH", `/resumes/${resumeId}`, {
    body: { theme: { ...created.json.resume.theme, fontFamily: "comic-sans" } },
    cookie: cookieA,
  });
  check("an unknown font family is rejected with 400", badTheme.status === 400, badTheme.json);

  const duplicated = await call("POST", `/resumes/${resumeId}/duplicate`, { cookie: cookieA });
  check("POST /resumes/:id/duplicate creates a copy", duplicated.status === 201, duplicated.json);
  check(
    "the copy is titled distinctly",
    duplicated.json.resume?.title?.includes("(copy)"),
    duplicated.json.resume?.title,
  );

  // --- Authorization boundary: user B must not touch user A's resume ---

  const bRead = await call("GET", `/resumes/${resumeId}`, { cookie: cookieB });
  check("user B cannot READ user A's resume", bRead.status === 404, bRead.status);

  const bPatch = await call("PATCH", `/resumes/${resumeId}`, {
    body: { title: "Hijacked" },
    cookie: cookieB,
  });
  check("user B cannot PATCH user A's resume", bPatch.status === 404, bPatch.status);

  const bDelete = await call("DELETE", `/resumes/${resumeId}`, { cookie: cookieB });
  check("user B cannot DELETE user A's resume", bDelete.status === 404, bDelete.status);

  const bExport = await call("GET", `/resumes/${resumeId}/export.pdf`, { cookie: cookieB });
  check("user B cannot EXPORT user A's resume", bExport.status === 404, bExport.status);

  const bList = await call("GET", "/resumes", { cookie: cookieB });
  check("user B's list does not include user A's resumes", (bList.json.resumes ?? []).length === 0);

  // Confirm A's resume survived B's attempts.
  const stillThere = await call("GET", `/resumes/${resumeId}`, { cookie: cookieA });
  check("user A's resume is intact after those attempts", stillThere.json.resume?.title === "Renamed By Autosave");

  // --- PDF export ---

  console.log("\n  (exporting PDF, first run launches Chromium and may take a moment)");

  const pdf = await call("GET", `/resumes/${resumeId}/export.pdf`, { cookie: cookieA });
  check("GET /resumes/:id/export.pdf returns 200", pdf.status === 200, pdf.json);
  check(
    "the response is a PDF attachment",
    pdf.response.headers.get("content-type") === "application/pdf",
    pdf.response.headers.get("content-type"),
  );

  if (pdf.status === 200) {
    const bytes = new Uint8Array(await pdf.response.arrayBuffer());
    const magic = new TextDecoder().decode(bytes.slice(0, 5));
    check("the payload starts with the %PDF magic bytes", magic === "%PDF-", magic);
    // A blank page is ~5KB; a rendered resume with embedded fonts is far larger.
    check(`the PDF is a non-trivial size (${(bytes.length / 1024).toFixed(0)}KB)`, bytes.length > 20_000, bytes.length);
  }

  const letter = await call("GET", `/resumes/${resumeId}/export.pdf?pageSize=letter`, { cookie: cookieA });
  check("export honours the pageSize override", letter.status === 200, letter.json);

  // --- Cleanup ---

  const deleted = await call("DELETE", `/resumes/${resumeId}`, { cookie: cookieA });
  check("DELETE /resumes/:id removes the resume", deleted.status === 204, deleted.status);

  const afterDelete = await call("GET", `/resumes/${resumeId}`, { cookie: cookieA });
  check("the deleted resume is gone", afterDelete.status === 404, afterDelete.status);

  await call("DELETE", `/resumes/${duplicated.json.resume?.id}`, { cookie: cookieA });

  const logout = await call("POST", "/auth/logout", { cookie: cookieA });
  check("POST /auth/logout succeeds", logout.status === 204, logout.status);

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED.\n`);
    process.exit(1);
  }
  console.log("All good.\n");
}

main().catch((error) => {
  console.error("\nSmoke run crashed:", error instanceof Error ? error.message : error);
  console.error("Is the api running? Try: bun run dev\n");
  process.exit(1);
});
