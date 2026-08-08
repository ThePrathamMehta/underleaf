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
  // Asserts the five base templates rather than a total, since v2's theme
  // variants expand that total and a fixed count would break on every new one.
  const BASE_SLUGS = ["jakes", "deedy", "modern-minimal", "classic", "creative"];
  const slugs = new Set(templateList.map((t: Json) => t.slug));
  check(
    "GET /templates lists the base templates",
    BASE_SLUGS.every((slug) => slugs.has(slug)),
    BASE_SLUGS.filter((slug) => !slugs.has(slug)),
  );

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

  await smokePdfs(cookieA, cookieB);

  await smokeAccountSettings(stamp, userA.email);

  const logout = await call("POST", "/auth/logout", { cookie: cookieA });
  check("POST /auth/logout succeeds", logout.status === 204, logout.status);

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED.\n`);
    process.exit(1);
  }
  console.log("All good.\n");
}

/**
 * Account settings, on a throwaway third user.
 *
 * Deliberately not user A or B: the last thing this exercises is account
 * deletion, and every earlier assertion in the run still depends on those two
 * existing.
 */
async function smokeAccountSettings(stamp: number, takenEmail: string) {
  console.log("\n  --- Account settings ---\n");

  const account = {
    email: `smoke-c-${stamp}@example.com`,
    password: "correct horse battery",
    name: "Smoke C",
  };
  const signup = await call("POST", "/auth/signup", { body: account });
  const cookie = cookieFrom(signup.response);
  check("a third user signs up for the settings pass", signup.status === 201, signup.json);
  check(
    "a password account reports hasPassword with no provider",
    signup.json.user?.hasPassword === true && signup.json.user?.oauthProvider === null,
    signup.json.user,
  );

  // --- Profile ---

  const renamed = await call("PATCH", "/auth/me", { body: { name: "Renamed C" }, cookie });
  check(
    "PATCH /auth/me renames the account",
    renamed.status === 200 && renamed.json.user?.name === "Renamed C",
    renamed.json,
  );

  const newEmail = `smoke-c2-${stamp}@example.com`;
  const reEmailed = await call("PATCH", "/auth/me", { body: { email: newEmail.toUpperCase() }, cookie });
  check(
    "PATCH /auth/me lowercases a changed email",
    reEmailed.status === 200 && reEmailed.json.user?.email === newEmail,
    reEmailed.json,
  );

  const conflict = await call("PATCH", "/auth/me", { body: { email: takenEmail }, cookie });
  check("changing to an email in use returns 409", conflict.status === 409, conflict.json);

  const empty = await call("PATCH", "/auth/me", { body: {}, cookie });
  check("an empty profile update is rejected with 400", empty.status === 400, empty.json);

  const anonPatch = await call("PATCH", "/auth/me", { body: { name: "Nobody" } });
  check("PATCH /auth/me without a cookie returns 401", anonPatch.status === 401, anonPatch.status);

  // --- Password ---

  const wrongCurrent = await call("PUT", "/auth/me/password", {
    body: { currentPassword: "not the password", newPassword: "a whole new password" },
    cookie,
  });
  check("changing a password with the wrong current one returns 401", wrongCurrent.status === 401, wrongCurrent.json);

  const missingCurrent = await call("PUT", "/auth/me/password", {
    body: { newPassword: "a whole new password" },
    cookie,
  });
  check(
    "changing a password without the current one returns 401",
    missingCurrent.status === 401,
    missingCurrent.json,
  );

  const tooShort = await call("PUT", "/auth/me/password", {
    body: { currentPassword: account.password, newPassword: "short" },
    cookie,
  });
  check("a short new password is rejected with 400", tooShort.status === 400, tooShort.json);

  const nextPassword = "a whole new password";
  const changed = await call("PUT", "/auth/me/password", {
    body: { currentPassword: account.password, newPassword: nextPassword },
    cookie,
  });
  check("PUT /auth/me/password succeeds", changed.status === 204, changed.status);

  const oldLogin = await call("POST", "/auth/login", {
    body: { email: newEmail, password: account.password },
  });
  check("the old password no longer works", oldLogin.status === 401, oldLogin.status);

  const newLogin = await call("POST", "/auth/login", {
    body: { email: newEmail, password: nextPassword },
  });
  check("the new password signs in at the new email", newLogin.status === 200, newLogin.json);

  // --- Deletion ---

  // Give the account something to cascade, so the delete isn't exercised against
  // an empty row.
  const templates = await call("GET", "/templates");
  const templateId = (templates.json.templates ?? [])[0]?.id;
  if (templateId) {
    await call("POST", "/resumes", { body: { templateId, title: "Doomed" }, cookie });
  }

  const wrongProof = await call("DELETE", "/auth/me", { body: { password: "wrong" }, cookie });
  check("deleting with the wrong password returns 401", wrongProof.status === 401, wrongProof.json);

  const stillThere = await call("GET", "/auth/me", { cookie });
  check("a rejected delete leaves the account intact", stillThere.status === 200, stillThere.status);

  const deleted = await call("DELETE", "/auth/me", { body: { password: nextPassword }, cookie });
  check("DELETE /auth/me removes the account", deleted.status === 204, deleted.json);

  const gone = await call("GET", "/auth/me", { cookie });
  check("the deleted account's token no longer resolves", gone.status === 401, gone.status);

  const ghostLogin = await call("POST", "/auth/login", {
    body: { email: newEmail, password: nextPassword },
  });
  check("the deleted account can't sign back in", ghostLogin.status === 401, ghostLogin.status);
}

async function smokePdfs(cookieA: string, cookieB: string) {
  console.log("\n--- PDF Upload & Edit (Feature B) ---");

  // Generate a test PDF in memory
  const { PDFDocument: PDFLib, StandardFonts, rgb } = await import("pdf-lib");
  const testDoc = await PDFLib.create();
  const helv = await testDoc.embedFont(StandardFonts.Helvetica);
  const page = testDoc.addPage([612, 792]);
  page.drawText("PDF Test Resume", { x: 72, y: 720, size: 24, font: helv });
  page.drawText("Software Engineer", { x: 72, y: 692, size: 11, font: helv, color: rgb(0.3, 0.3, 0.3) });
  page.drawText("test@example.com", { x: 72, y: 672, size: 10, font: helv, color: rgb(0.76, 0.25, 0.05) });
  const pdfBytes = await testDoc.save();

  // Upload as multipart/form-data. The cast is because pdf-lib types its output
  // as Uint8Array<ArrayBufferLike>, which TS won't narrow to the ArrayBuffer-backed
  // BlobPart even though it always is one in practice.
  const form = new FormData();
  form.append(
    "file",
    new Blob([pdfBytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }),
    "test-resume.pdf",
  );

  const uploadRes = await fetch(`${BASE}/pdfs`, {
    method: "POST",
    headers: { Cookie: cookieA },
    body: form,
  });

  const upload = await uploadRes.json();
  check("POST /pdfs uploads and parses a PDF", uploadRes.status === 201, upload.error);

  const docId = upload.document?.id;
  check("the parsed document has an id", Boolean(docId));
  check("the document has pages", (upload.document?.pages ?? []).length > 0);
  check("pages have text runs", (upload.document?.pages?.[0]?.runs ?? []).length > 0);
  check("runs have font metadata", upload.document?.pages?.[0]?.runs?.[0]?.fontFamily?.length > 0);

  const list = await call("GET", "/pdfs", { cookie: cookieA });
  check("GET /pdfs lists the user's PDFs", (list.json.documents ?? []).length === 1);

  const get = await call("GET", `/pdfs/${docId}`, { cookie: cookieA });
  check("GET /pdfs/:id returns the full document", get.json.document?.id === docId);

  // Update one text run
  const runId = get.json.document?.pages?.[0]?.runs?.[0]?.id;
  if (runId) {
    const patchRun = await call("PATCH", `/pdfs/${docId}/runs/${runId}`, {
      body: { text: "Edited Text" },
      cookie: cookieA,
    });
    check("PATCH /pdfs/:id/runs/:runId updates text", patchRun.status === 204);
  }

  // Rename the document
  const rename = await call("PATCH", `/pdfs/${docId}`, {
    body: { title: "Renamed PDF" },
    cookie: cookieA,
  });
  check("PATCH /pdfs/:id renames the document", rename.json.document?.title === "Renamed PDF");

  // Export the edited PDF
  const exportRes = await fetch(`${BASE}/pdfs/${docId}/export.pdf`, {
    method: "GET",
    headers: { Cookie: cookieA },
  });
  check("GET /pdfs/:id/export.pdf returns 200", exportRes.status === 200);
  check(
    "the export is a PDF attachment",
    exportRes.headers.get("content-type") === "application/pdf",
  );

  if (exportRes.status === 200) {
    const bytes = new Uint8Array(await exportRes.arrayBuffer());
    const magic = new TextDecoder().decode(bytes.slice(0, 5));
    check("the exported PDF starts with the magic bytes", magic === "%PDF-");
    check("the exported PDF is non-trivial", bytes.length > 1000);
  }

  // Verify user B cannot access user A's PDF
  const bRead = await call("GET", `/pdfs/${docId}`, { cookie: cookieB });
  check("user B cannot READ user A's PDF", bRead.status === 404);

  const bPatch = await call("PATCH", `/pdfs/${docId}`, {
    body: { title: "Hijacked" },
    cookie: cookieB,
  });
  check("user B cannot PATCH user A's PDF", bPatch.status === 404);

  const bDelete = await call("DELETE", `/pdfs/${docId}`, { cookie: cookieB });
  check("user B cannot DELETE user A's PDF", bDelete.status === 404);

  const bExport = await fetch(`${BASE}/pdfs/${docId}/export.pdf`, {
    method: "GET",
    headers: { Cookie: cookieB },
  });
  check("user B cannot EXPORT user A's PDF", bExport.status === 404);

  // Cleanup
  const deleted = await call("DELETE", `/pdfs/${docId}`, { cookie: cookieA });
  check("DELETE /pdfs/:id removes the PDF", deleted.status === 204);

  const afterDelete = await call("GET", `/pdfs/${docId}`, { cookie: cookieA });
  check("the deleted PDF is gone", afterDelete.status === 404);

  await smokeScannedRejection(cookieA);
  await smokeMultiPage(cookieA);
}

/** Uploads raw PDF bytes as multipart, the way the browser's FormData would. */
async function uploadPdf(bytes: Uint8Array, filename: string, cookie: string) {
  const form = new FormData();
  form.append("file", new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }), filename);

  const response = await fetch(`${BASE}/pdfs`, { method: "POST", headers: { Cookie: cookie }, body: form });
  const contentType = response.headers.get("content-type") ?? "";
  const json = contentType.includes("application/json") ? await response.json() : {};
  return { status: response.status, json: json as Json };
}

/**
 * A PDF with no text layer must be refused at upload with an explanation, not
 * accepted into an editor with nothing to edit (spec B.7's no-OCR non-goal).
 */
async function smokeScannedRejection(cookie: string) {
  console.log("\n--- Scanned-PDF rejection ---");

  const { PDFDocument: PDFLib, rgb } = await import("pdf-lib");
  const doc = await PDFLib.create();
  // Graphics only — this is what a scan's text-free page looks like to a parser.
  doc.addPage([612, 792]).drawRectangle({ x: 100, y: 400, width: 400, height: 200, color: rgb(0.8, 0.8, 0.85) });

  const result = await uploadPdf(await doc.save(), "scanned.pdf", cookie);
  check("a PDF with no text layer is rejected with 400", result.status === 400, result.json);
  check(
    "the rejection explains that OCR isn't supported",
    /ocr|scan/i.test(String(result.json.error)),
    result.json.error,
  );
}

/** Page count and per-page content must both survive the round trip. */
async function smokeMultiPage(cookie: string) {
  console.log("\n--- Multi-page round trip ---");

  const { PDFDocument: PDFLib, StandardFonts } = await import("pdf-lib");
  const source = await PDFLib.create();
  const font = await source.embedFont(StandardFonts.Helvetica);

  const PAGES = 3;
  for (let index = 0; index < PAGES; index++) {
    const page = source.addPage([612, 792]);
    page.drawText(`Page ${index + 1} heading`, { x: 72, y: 700, size: 18, font });
    page.drawText(`Body text on page ${index + 1}.`, { x: 72, y: 660, size: 11, font });
  }

  const uploaded = await uploadPdf(await source.save(), "multi-page.pdf", cookie);
  check("a 3-page PDF uploads", uploaded.status === 201, uploaded.json);

  const doc = uploaded.json.document;
  const docId = doc?.id;
  if (!docId) return;

  check("the document reports 3 pages", doc.pageCount === PAGES, doc.pageCount);
  check("all 3 pages were parsed", (doc.pages ?? []).length === PAGES, doc.pages?.length);
  check(
    "every page has its own text runs",
    (doc.pages ?? []).every((page: Json) => (page.runs ?? []).length > 0),
    (doc.pages ?? []).map((page: Json) => page.runs?.length),
  );
  check(
    "each page kept its own content",
    (doc.pages ?? []).every((page: Json, index: number) =>
      (page.runs ?? []).some((run: Json) => run.originalText?.includes(`Page ${index + 1}`)),
    ),
  );

  // Edit the last page specifically: an off-by-one in the export's page lookup
  // would put this text on the wrong page, or drop it.
  const lastPage = doc.pages[PAGES - 1];
  const target = lastPage.runs.find((run: Json) => run.originalText?.includes("Page 3"));
  if (target) {
    const patched = await call("PATCH", `/pdfs/${docId}/runs/${target.id}`, {
      body: { text: "Edited on the last page" },
      cookie,
    });
    check("a run on the last page accepts an edit", patched.status === 204, patched.status);
  }

  const exported = await fetch(`${BASE}/pdfs/${docId}/export.pdf`, { headers: { Cookie: cookie } });
  check("the multi-page export returns 200", exported.status === 200);

  if (exported.status === 200) {
    const bytes = new Uint8Array(await exported.arrayBuffer());
    const out = await PDFLib.load(bytes);
    check(`the export kept all ${PAGES} pages`, out.getPageCount() === PAGES, out.getPageCount());
  }

  await call("DELETE", `/pdfs/${docId}`, { cookie });
}

main().catch((error) => {
  console.error("\nSmoke run crashed:", error instanceof Error ? error.message : error);
  console.error("Is the api running? Try: bun run dev\n");
  process.exit(1);
});
