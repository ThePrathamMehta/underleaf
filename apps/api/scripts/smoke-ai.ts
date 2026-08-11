/**
 * End-to-end check of the AI surface added in v4.
 *
 * It does not assume any particular provider is configured, because every
 * property here has to hold regardless of what the developer's environment
 * carries:
 *
 *   - the admin boundary (a signed-in non-admin is refused, not served)
 *   - the secret allowlist (a config can't be pointed at JWT_SECRET)
 *   - graceful degradation (ATS and JD still answer from rules alone when the
 *     config row for their purpose is absent or the provider call fails)
 *   - honest failure (chat and cover letters, which have no deterministic
 *     half, return a real status and a specific message rather than hanging)
 *
 * A valid key with a purpose row would let the happy paths be exercised too,
 * but it would also hide the degradation paths — which are the ones that break
 * silently in production.
 *
 * Requires the api to be running. Run: bun run smoke:ai
 */
import { prisma } from "@repo/db";

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

function cookieFrom(response: Response): string {
  const raw = response.headers.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(";")[0]).join("; ");
}

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

/** Reads an SSE stream to completion and returns the parsed events. */
async function readStream(
  path: string,
  body: unknown,
  cookie: string,
): Promise<{ status: number; events: Json[]; json: Json }> {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", Cookie: cookie },
    body: JSON.stringify(body),
  });

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    const json = contentType.includes("application/json") ? await response.json() : {};
    return { status: response.status, events: [], json };
  }

  const events: Json[] = [];
  const text = await response.text();
  for (const frame of text.split("\n\n")) {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data) {
      try {
        events.push(JSON.parse(data) as Json);
      } catch {
        // A frame that isn't JSON is itself a failure, caught by the assertions.
      }
    }
  }

  return { status: response.status, events, json: {} };
}

const JD_TEXT = `Senior Backend Engineer

We are looking for an engineer with strong experience in Kubernetes and Go.
Requirements:
- 5+ years building distributed systems
- Deep knowledge of Kubernetes, Docker and Terraform
- Experience with PostgreSQL and Redis
- Strong background in Go and gRPC`;

async function main() {
  const stamp = Date.now();
  const user = {
    email: `ai-smoke-${stamp}@example.com`,
    password: "correct horse battery",
    name: "AI Smoke",
  };
  const admin = {
    email: `ai-admin-${stamp}@example.com`,
    password: "correct horse battery",
    name: "AI Admin",
  };

  console.log(`\nAI surface check against ${BASE}\n`);

  // --- Setup ---
  console.log("--- Setup ---");

  const signup = await call("POST", "/auth/signup", { body: user });
  check("a user signs up", signup.status === 201 || signup.status === 200, signup.json);
  const cookie = cookieFrom(signup.response);
  check("the signup returns a session cookie", cookie.length > 0);

  const adminSignup = await call("POST", "/auth/signup", { body: admin });
  const adminCookie = cookieFrom(adminSignup.response);
  check("a second user signs up, to be promoted", adminCookie.length > 0);

  // Promoting through the database rather than ADMIN_EMAILS: this script must
  // not depend on the developer's .env, and `requireAdmin` reads the role from
  // the database on every request anyway — which is the property under test.
  await prisma.user.update({
    where: { email: admin.email.toLowerCase() },
    data: { role: "admin" },
  });
  check("the second user is promoted to admin in the database", true);

  const templates = await call("GET", "/templates");
  const templateId = templates.json.templates?.[0]?.id as string | undefined;
  check("templates are available", Boolean(templateId));
  if (!templateId) return;

  const created = await call("POST", "/resumes", {
    cookie,
    body: { templateId, title: "AI Smoke Resume" },
  });
  const resumeId = created.json.resume?.id as string | undefined;
  check("a resume is created to run the AI features against", Boolean(resumeId), created.json);
  if (!resumeId) return;

  // --- Admin boundary ---
  console.log("\n--- Admin boundary ---");

  const anon = await call("GET", "/admin/ai-config");
  check("GET /admin/ai-config without a cookie returns 401", anon.status === 401, anon.json);

  const asUser = await call("GET", "/admin/ai-config", { cookie });
  check("a signed-in non-admin gets 403", asUser.status === 403, {
    status: asUser.status,
    body: asUser.json,
  });
  check(
    "the 403 says why rather than pretending the route is missing",
    typeof asUser.json.error === "string" && /admin/i.test(asUser.json.error),
    asUser.json,
  );

  const asUserWrite = await call("PATCH", "/admin/ai-config", {
    cookie,
    body: {
      provider: "anthropic",
      modelName: "claude-opus-4-6",
      apiKeySecretRef: "ANTHROPIC_API_KEY",
      purpose: "chat",
      isActive: true,
    },
  });
  check("a non-admin cannot PATCH the config either", asUserWrite.status === 403, asUserWrite.json);

  const asAdmin = await call("GET", "/admin/ai-config", { cookie: adminCookie });
  check("the promoted admin gets 200", asAdmin.status === 200, asAdmin.json);
  check("the response lists configs", Array.isArray(asAdmin.json.configs), asAdmin.json);
  check(
    "the response lists selectable secret refs",
    Array.isArray(asAdmin.json.availableSecretRefs),
    asAdmin.json,
  );

  // --- The secret allowlist ---
  console.log("\n--- Secret allowlist ---");

  const refs = (asAdmin.json.availableSecretRefs ?? []) as Array<{
    name: string;
    configured: boolean;
  }>;

  check(
    "both first-party names are offered even when unset",
    refs.some((r) => r.name === "ANTHROPIC_API_KEY") &&
      refs.some((r) => r.name === "OPENAI_API_KEY"),
    refs.map((r) => r.name),
  );
  check(
    "no server secret is ever listed",
    !refs.some((r) => ["JWT_SECRET", "DATABASE_URL", "PATH"].includes(r.name)),
    refs.map((r) => r.name),
  );

  // The single most important assertion in this file. A ref carries a name and
  // a boolean; if a value ever appears in this payload the design has failed.
  const refsBlob = JSON.stringify(refs);
  check(
    "a secret ref carries only a name and a configured flag",
    refs.every((r) => Object.keys(r).sort().join(",") === "configured,name"),
    refs[0],
  );

  const jwtSecret = process.env.JWT_SECRET ?? "";
  const configBlob = JSON.stringify(asAdmin.json);
  check(
    "the config response contains no key-shaped value",
    !/sk-[a-zA-Z0-9]{8,}/.test(configBlob) && !refsBlob.includes("sk-"),
  );
  check(
    "the config response does not leak JWT_SECRET's value",
    jwtSecret.length === 0 || !configBlob.includes(jwtSecret),
  );

  const pointAtJwt = await call("PATCH", "/admin/ai-config", {
    cookie: adminCookie,
    body: {
      provider: "anthropic",
      modelName: "claude-opus-4-6",
      apiKeySecretRef: "JWT_SECRET",
      purpose: "chat",
      isActive: true,
    },
  });
  check(
    "an admin cannot point a config at JWT_SECRET",
    pointAtJwt.status === 400,
    pointAtJwt.json,
  );
  check(
    "the refusal explains which names are allowed",
    typeof pointAtJwt.json.error === "string" && /AI_KEY_/.test(pointAtJwt.json.error),
    pointAtJwt.json,
  );

  const pointAtDb = await call("PATCH", "/admin/ai-config", {
    cookie: adminCookie,
    body: {
      provider: "openai",
      modelName: "gpt-5",
      apiKeySecretRef: "DATABASE_URL",
      purpose: "ats",
      isActive: true,
    },
  });
  check("nor at DATABASE_URL", pointAtDb.status === 400, pointAtDb.json);

  const saved = await call("PATCH", "/admin/ai-config", {
    cookie: adminCookie,
    body: {
      provider: "anthropic",
      modelName: "claude-opus-4-6",
      apiKeySecretRef: "ANTHROPIC_API_KEY",
      purpose: "chat",
      isActive: true,
    },
  });
  // A create answers 201, an update to an existing row 200.
  check("an allowed ref saves", saved.status === 201 || saved.status === 200, saved.json);
  check(
    "the saved config echoes the ref name, not a value",
    saved.json.config?.apiKeySecretRef === "ANTHROPIC_API_KEY",
    saved.json.config,
  );
  // Whether this is true depends on the environment the api is running in, so
  // the assertion is that it *agrees* with that environment rather than that it
  // holds a particular value. What matters is that it's a boolean derived from
  // the allowlist, never the key itself.
  check(
    "apiKeyConfigured reflects whether the env var is actually populated",
    saved.json.config?.apiKeyConfigured === Boolean(process.env.ANTHROPIC_API_KEY),
    {
      reported: saved.json.config?.apiKeyConfigured,
      envPopulated: Boolean(process.env.ANTHROPIC_API_KEY),
    },
  );
  check(
    "apiKeyConfigured is a boolean, not a value",
    typeof saved.json.config?.apiKeyConfigured === "boolean",
    saved.json.config?.apiKeyConfigured,
  );

  // --- Degradation: ATS still scores without a provider ---
  console.log("\n--- ATS degradation (no config row for this purpose) ---");

  const started = Date.now();
  const ats = await call("POST", `/resumes/${resumeId}/ats-score`, { cookie });
  const atsMs = Date.now() - started;

  check("POST /ats-score succeeds with no provider", ats.status === 200, {
    status: ats.status,
    body: ats.json,
  });
  check(
    "it returns a real score from the rules alone",
    typeof ats.json.result?.overallScore === "number" &&
      ats.json.result.overallScore >= 0 &&
      ats.json.result.overallScore <= 100,
    ats.json.result?.overallScore,
  );
  check(
    "it reports the AI half as failed rather than pretending it ran",
    typeof ats.json.aiError === "string" && ats.json.aiError.length > 0,
    ats.json.aiError,
  );
  // `aiError` is a plain user-facing string by design — the code is what the
  // server branches on, the message is what the panel renders. This asserts the
  // Definition of Done's actual promise: it names a cause a person can act on.
  check(
    "the AI error names the cause specifically, not generically",
    typeof ats.json.aiError === "string" &&
      !/something went wrong|unknown error|failed to fetch/i.test(ats.json.aiError),
    ats.json.aiError,
  );
  check(
    "the AI error is a sentence, not a bare code",
    typeof ats.json.aiError === "string" && /\s/.test(ats.json.aiError.trim()),
    ats.json.aiError,
  );
  check(
    "the AI error leaks no key material",
    typeof ats.json.aiError === "string" && !/sk-[a-zA-Z0-9]{8,}/.test(ats.json.aiError),
    ats.json.aiError,
  );
  check(
    "aiAssisted is false when the AI half didn't run",
    ats.json.result?.aiAssisted === false,
    ats.json.result?.aiAssisted,
  );
  check(`it degrades fast rather than hanging (${(atsMs / 1000).toFixed(1)}s)`, atsMs < 15_000);
  check(
    "issues are anchored, not generic advice",
    Array.isArray(ats.json.result?.issues) && ats.json.result.issues.length > 0,
    ats.json.result?.issues?.length,
  );

  const latest = await call("GET", `/resumes/${resumeId}/ats-score/latest`, { cookie });
  check("the run persisted and reads back", latest.status === 200, latest.status);

  const history = await call("GET", `/resumes/${resumeId}/ats-score/history`, { cookie });
  check(
    "history accumulates",
    Array.isArray(history.json.history) && history.json.history.length >= 1,
    history.json.history?.length,
  );

  // --- Degradation: JD match still compares without a provider ---
  console.log("\n--- JD match degradation (no config row for this purpose) ---");

  const jd = await call("POST", `/resumes/${resumeId}/jd-compare`, {
    cookie,
    body: { jobDescriptionText: JD_TEXT },
  });

  check("POST /jd-compare succeeds with no provider", jd.status === 200, {
    status: jd.status,
    body: jd.json,
  });
  check(
    "it returns a match score from the deterministic diff",
    typeof jd.json.comparison?.matchScore === "number",
    jd.json.comparison?.matchScore,
  );
  check(
    "it splits matched from missing keywords",
    Array.isArray(jd.json.comparison?.matchedKeywords) &&
      Array.isArray(jd.json.comparison?.missingKeywords),
    {
      matched: jd.json.comparison?.matchedKeywords?.length,
      missing: jd.json.comparison?.missingKeywords?.length,
    },
  );

  // The sample resume isn't an infrastructure CV, so the JD's requirement terms
  // have to land on the missing side. Which specific ones depends on the seeded
  // sample, so this asserts that requirement-line terms were extracted and
  // reported missing rather than naming a term the sample might happen to have.
  const missing = (jd.json.comparison?.missingKeywords ?? []) as Array<{
    term?: string;
    weight?: number;
    evidence?: unknown;
  }>;
  check("requirement terms are extracted and reported missing", missing.length > 0, missing.length);
  check(
    "each missing keyword carries the weight that ranked it",
    missing.every((entry) => typeof entry.term === "string" && typeof entry.weight === "number"),
    missing[0],
  );
  // Requirement lines must outrank prose: the JD says "Kubernetes" in a bullet
  // and "strong" in a sentence, and the first has to be the more important gap.
  const weightOf = (term: string) =>
    missing.find((entry) => entry.term?.toLowerCase() === term)?.weight ?? 0;
  check(
    "a requirement-line term outweighs a boilerplate word",
    weightOf("distributed systems") > weightOf("strong") ||
      weightOf("docker") > weightOf("strong"),
    missing.map((entry) => `${entry.term}:${entry.weight}`),
  );
  check(
    "it too reports the AI half honestly and specifically",
    typeof jd.json.aiError === "string" &&
      jd.json.aiError.length > 0 &&
      !/something went wrong|unknown error/i.test(jd.json.aiError),
    jd.json.aiError,
  );

  const comparisonId = jd.json.comparison?.id as string | undefined;
  check("the comparison persisted", Boolean(comparisonId));

  // --- Honest failure: chat has no deterministic half ---
  console.log("\n--- Chat failure (no usable provider) ---");

  const chatStarted = Date.now();
  const chat = await readStream(
    `/resumes/${resumeId}/chat`,
    { message: "Add a skills section with Go and Kubernetes." },
    cookie,
  );
  const chatMs = Date.now() - chatStarted;

  const errorEvent = chat.events.find((event) => event.type === "error");
  const failedCleanly = chat.status >= 400 || errorEvent !== undefined;
  check("a chat turn fails rather than hanging", failedCleanly, {
    status: chat.status,
    events: chat.events.map((e) => e.type),
  });
  check(`the failure is fast (${(chatMs / 1000).toFixed(1)}s)`, chatMs < 15_000);

  const chatMessage = (errorEvent?.message ?? chat.json.error ?? "") as string;
  check(
    "the failure carries a specific message, not a generic one",
    chatMessage.length > 0 && !/something went wrong/i.test(chatMessage),
    chatMessage,
  );
  check(
    "no document event was emitted, so the resume is untouched",
    !chat.events.some((event) => event.type === "document"),
    chat.events.map((e) => e.type),
  );

  const afterChat = await call("GET", `/resumes/${resumeId}`, { cookie });
  check(
    "the resume still has its original title after the failed turn",
    afterChat.json.resume?.title === "AI Smoke Resume",
    afterChat.json.resume?.title,
  );

  // --- Honest failure: cover letters ---
  console.log("\n--- Cover letter failure (no usable provider) ---");

  const letterStarted = Date.now();
  const letter = await call("POST", `/resumes/${resumeId}/cover-letter`, {
    cookie,
    body: { tone: "formal" },
  });
  const letterMs = Date.now() - letterStarted;

  check(
    "generation returns a real error status, not a 200 carrying an apology",
    letter.status >= 400,
    { status: letter.status, body: letter.json },
  );
  check(
    "the error message is specific",
    typeof letter.json.error === "string" &&
      letter.json.error.length > 0 &&
      !/something went wrong/i.test(letter.json.error),
    letter.json,
  );
  check(`it fails fast (${(letterMs / 1000).toFixed(1)}s)`, letterMs < 15_000);

  const letterList = await call("GET", `/resumes/${resumeId}/cover-letter`, { cookie });
  check("the failed generation wrote no letter", letterList.json.latest === null, letterList.json);
  check(
    "the letter list is empty rather than absent",
    Array.isArray(letterList.json.letters) && letterList.json.letters.length === 0,
    letterList.json.letters,
  );

  // --- Ownership, on every new resource ---
  console.log("\n--- Ownership boundary on the AI routes ---");

  const other = {
    email: `ai-other-${stamp}@example.com`,
    password: "correct horse battery",
    name: "AI Other",
  };
  const otherSignup = await call("POST", "/auth/signup", { body: other });
  const otherCookie = cookieFrom(otherSignup.response);

  const steal = await call("POST", `/resumes/${resumeId}/ats-score`, { cookie: otherCookie });
  check("another user cannot score someone else's resume", steal.status === 404 || steal.status === 403, steal.status);

  const stealHistory = await call("GET", `/resumes/${resumeId}/ats-score/history`, {
    cookie: otherCookie,
  });
  check(
    "nor read its ATS history",
    stealHistory.status === 404 || stealHistory.status === 403,
    stealHistory.status,
  );

  const stealJd = await call("GET", `/resumes/${resumeId}/jd-compare`, { cookie: otherCookie });
  check(
    "nor list its JD comparisons",
    stealJd.status === 404 || stealJd.status === 403 || (stealJd.json.comparisons ?? []).length === 0,
    stealJd.status,
  );

  const stealChat = await call("GET", `/resumes/${resumeId}/chat`, { cookie: otherCookie });
  check("nor read its chat history", stealChat.status === 404 || stealChat.status === 403, stealChat.status);

  const stealLetters = await call("GET", `/resumes/${resumeId}/cover-letter`, {
    cookie: otherCookie,
  });
  check(
    "nor list its cover letters",
    stealLetters.status === 404 || stealLetters.status === 403,
    stealLetters.status,
  );

  // --- Usage logging records no content ---
  console.log("\n--- Usage log ---");

  const logs = await prisma.aiUsageLog.findMany({ take: 20, orderBy: { createdAt: "desc" } });
  const logBlob = JSON.stringify(logs);
  check(
    "no usage row carries prompt or response content",
    !/Kubernetes and Go|Add a skills section/i.test(logBlob),
  );
  check(
    "no usage row carries a key",
    !/sk-[a-zA-Z0-9]{8,}/.test(logBlob) && (jwtSecret.length === 0 || !logBlob.includes(jwtSecret)),
  );

  // --- Cleanup ---
  await call("DELETE", `/resumes/${resumeId}`, { cookie });
  await prisma.aiProviderConfig.deleteMany({ where: { id: saved.json.config?.id } });
  await prisma.user.deleteMany({
    where: { email: { in: [user.email, admin.email, other.email].map((e) => e.toLowerCase()) } },
  });

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  console.log(failures === 0 ? "All good." : `${failures} failed.`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("\nThe AI smoke run threw:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
