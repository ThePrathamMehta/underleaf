import type {
  AiConfigResponse,
  AiProviderConfigDto,
  AiUsageDto,
  AtsHistoryEntry,
  AtsScoreResponse,
  ChangePasswordBody,
  ChatHistoryResponse,
  ChatStreamEvent,
  CompareJdBody,
  CoverLetterDto,
  CoverLetterListResponse,
  CoverLetterResponse,
  CreateCheckoutBody,
  DeleteAccountBody,
  GenerateCoverLetterBody,
  JdCompareResponse,
  JdComparisonSummary,
  PdfDocumentDto,
  PdfDocumentSummaryDto,
  PlanDto,
  ProfessionDto,
  PublicUser,
  RenamePdfDocumentBody,
  ResumeWithTemplateDto,
  SendChatBody,
  SubscriptionDto,
  TemplateDto,
  UpdateCoverLetterBody,
  UpdatePdfTextRunBody,
  UpdateProfileBody,
  UpdateResumeBody,
  UpsertAiConfigBody,
} from "@repo/types";
import { ALLOWANCE_EXHAUSTED } from "@repo/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: Array<{ path: string; message: string }>,
    /**
     * The machine-readable half of the body, when there is one. Only
     * `allowance_exhausted` (402) sets these today: `usage` is the counter as the
     * server saw it, so a panel can render "0 of 10 left" and an upgrade link
     * beside the message instead of the message alone (v5 Section 6).
     */
    readonly code?: string,
    readonly usage?: AiUsageDto,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** True when this request was refused for want of allowance, not for a fault. */
  get isAllowanceExhausted(): boolean {
    return this.status === 402 && this.code === ALLOWANCE_EXHAUSTED;
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? "GET",
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      // Carries the httpOnly auth cookie; without it every request is anonymous.
      credentials: "include",
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "Could not reach the server. Is the API running?");
  }

  if (response.status === 204) return undefined as T;

  const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error ?? `Request failed with status ${response.status}`,
      payload?.details,
      payload?.code,
      payload?.usage,
    );
  }

  return payload as T;
}

/**
 * Multipart sibling of `request`. Kept separate because `request` JSON-encodes
 * its body and sets Content-Type; for FormData the browser must set that header
 * itself so it can generate the multipart boundary.
 */
async function upload<T>(path: string, form: FormData, signal?: AbortSignal): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_URL}${path}`, {
      method: "POST",
      body: form,
      credentials: "include",
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "Could not reach the server. Is the API running?");
  }

  const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    // 413 comes from multer's own limit handler, which may not produce JSON.
    const fallback =
      response.status === 413
        ? "That file is too large."
        : `Upload failed with status ${response.status}`;
    throw new ApiError(response.status, payload?.error ?? fallback, payload?.details);
  }

  return payload as T;
}

/**
 * POSTs a JSON body and yields the server-sent events it streams back.
 *
 * `EventSource` would be the obvious tool and cannot be used: it only issues GET
 * requests, and the chat message is a body. So this is `fetch` plus a hand-rolled
 * frame parser — small, because the server only ever sends `data:` lines.
 *
 * Non-2xx responses are still parsed as JSON and thrown as `ApiError`, so the
 * caller distinguishes "you aren't allowed" from "the stream broke" the same way
 * it does everywhere else.
 */
export async function* streamRequest<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<T> {
  let response: Response;

  try {
    response = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
      credentials: "include",
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "Could not reach the server. Is the API running?");
  }

  if (!response.ok) {
    const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
    const payload = isJson ? await response.json() : null;
    // A refusal for want of allowance lands here rather than as an in-band
    // `error` event: the server meters before it flushes headers, precisely so
    // the status line can still say 402 and the panel can render an upgrade
    // prompt instead of an empty assistant turn.
    throw new ApiError(
      response.status,
      payload?.error ?? `Request failed with status ${response.status}`,
      payload?.details,
      payload?.code,
      payload?.usage,
    );
  }

  if (!response.body) throw new ApiError(0, "The server sent an empty response.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Frames are separated by a blank line. Anything after the last one is a
      // partial frame and stays in the buffer for the next chunk — a large
      // `document` event routinely arrives split across reads.
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");

        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");

        if (data) yield JSON.parse(data) as T;
      }
    }
  } finally {
    // Releasing the lock lets an abort actually tear the connection down rather
    // than leaving it half-open until the tab closes.
    reader.releaseLock();
  }
}

export const api = {
  signup(body: { email: string; password: string; name: string }) {
    return request<{ user: PublicUser }>("/auth/signup", { method: "POST", body });
  },

  login(body: { email: string; password: string }) {
    return request<{ user: PublicUser }>("/auth/login", { method: "POST", body });
  },

  logout() {
    return request<void>("/auth/logout", { method: "POST" });
  },

  me(signal?: AbortSignal) {
    return request<{ user: PublicUser }>("/auth/me", { signal });
  },

  // --- Account settings ---

  updateProfile(body: UpdateProfileBody) {
    return request<{ user: PublicUser }>("/auth/me", { method: "PATCH", body });
  },

  changePassword(body: ChangePasswordBody) {
    return request<void>("/auth/me/password", { method: "PUT", body });
  },

  /** Irreversible: cascades to every resume, uploaded PDF and stored file. */
  deleteAccount(body: DeleteAccountBody) {
    return request<void>("/auth/me", { method: "DELETE", body });
  },

  templates(filters?: { category?: string; profession?: string }) {
    const params = new URLSearchParams();
    if (filters?.category) params.set("category", filters.category);
    if (filters?.profession) params.set("profession", filters.profession);
    const query = params.toString();
    return request<{ templates: TemplateDto[] }>(`/templates${query ? `?${query}` : ""}`);
  },

  professions() {
    return request<{ professions: ProfessionDto[] }>("/professions");
  },

  resumes() {
    return request<{ resumes: ResumeWithTemplateDto[] }>("/resumes");
  },

  resume(id: string) {
    return request<{ resume: ResumeWithTemplateDto }>(`/resumes/${id}`);
  },

  createResume(body: {
    templateId: string;
    title?: string;
    blank?: boolean;
    /** Slug of the profession being browsed; picks that profession's sample. */
    profession?: string;
  }) {
    return request<{ resume: ResumeWithTemplateDto }>("/resumes", { method: "POST", body });
  },

  updateResume(id: string, body: UpdateResumeBody, signal?: AbortSignal) {
    return request<{ resume: ResumeWithTemplateDto }>(`/resumes/${id}`, {
      method: "PATCH",
      body,
      signal,
    });
  },

  deleteResume(id: string) {
    return request<void>(`/resumes/${id}`, { method: "DELETE" });
  },

  duplicateResume(id: string) {
    return request<{ resume: ResumeWithTemplateDto }>(`/resumes/${id}/duplicate`, { method: "POST" });
  },

  /** Absolute URL so the browser can navigate to it for a file download. */
  exportUrl(id: string, pageSize?: string) {
    const query = pageSize ? `?pageSize=${pageSize}` : "";
    return `${API_URL}/resumes/${id}/export.pdf${query}`;
  },

  /**
   * Absolute URL that *starts* a provider's server-side OAuth flow. The
   * provider itself is what later calls `/auth/:provider/callback`; sending the
   * browser straight to the callback would arrive with no authorization code.
   */
  oauthUrl(provider: "google" | "github") {
    return `${API_URL}/auth/${provider}`;
  },

  // --- PDF editing ---

  uploadPdf(file: File, signal?: AbortSignal) {
    const form = new FormData();
    form.append("file", file);
    return upload<{ document: PdfDocumentDto }>("/pdfs", form, signal);
  },

  pdfs() {
    return request<{ documents: PdfDocumentSummaryDto[] }>("/pdfs");
  },

  pdf(id: string) {
    return request<{ document: PdfDocumentDto }>(`/pdfs/${id}`);
  },

  updatePdfTitle(id: string, body: RenamePdfDocumentBody) {
    return request<{ document: PdfDocumentDto }>(`/pdfs/${id}`, { method: "PATCH", body });
  },

  updatePdfRun(pdfId: string, runId: string, body: UpdatePdfTextRunBody, signal?: AbortSignal) {
    return request<void>(`/pdfs/${pdfId}/runs/${runId}`, { method: "PATCH", body, signal });
  },

  deletePdf(id: string) {
    return request<void>(`/pdfs/${id}`, { method: "DELETE" });
  },

  /** Absolute URL for redact-and-redraw export. */
  pdfExportUrl(id: string) {
    return `${API_URL}/pdfs/${id}/export.pdf`;
  },

  /**
   * Absolute URL for a relative asset path the API handed back (page images,
   * font programs). The server returns these relative precisely so it never has
   * to know its own public URL — joining them is the client's job.
   */
  assetUrl(path: string) {
    return `${API_URL}/${path}`;
  },

  // --- Admin: AI provider settings ---

  /**
   * Note what these two never carry: an API key. The response holds env var
   * *names* and a configured flag, and the request sends back a name. There is
   * no field on either side that could hold a secret, which is what makes "no
   * raw key reaches the browser" true by shape rather than by discipline.
   */
  aiConfig(signal?: AbortSignal) {
    return request<AiConfigResponse>("/admin/ai-config", { signal });
  },

  saveAiConfig(body: UpsertAiConfigBody) {
    return request<{ config: AiProviderConfigDto }>("/admin/ai-config", {
      method: "PATCH",
      body,
    });
  },

  // --- Chat assistant ---

  chatHistory(resumeId: string, signal?: AbortSignal) {
    return request<ChatHistoryResponse>(`/resumes/${resumeId}/chat`, { signal });
  },

  clearChat(resumeId: string) {
    return request<void>(`/resumes/${resumeId}/chat`, { method: "DELETE" });
  },

  /**
   * One assistant turn. The `document` events it yields are computed but not
   * saved by the server — applying them is the editor's job, which is what puts
   * an AI edit on the same undo stack as a keystroke.
   */
  sendChatMessage(resumeId: string, body: SendChatBody, signal?: AbortSignal) {
    return streamRequest<ChatStreamEvent>(`/resumes/${resumeId}/chat`, body, signal);
  },

  // --- ATS score ---

  /** Runs the checks. Deliberately a POST: it costs money and writes history. */
  scoreAts(resumeId: string, signal?: AbortSignal) {
    return request<AtsScoreResponse>(`/resumes/${resumeId}/ats-score`, { method: "POST", signal });
  },

  /**
   * The most recent run, or `undefined` when there has never been one — the API
   * answers 204 for that, which `request` already turns into undefined. A panel
   * opening for the first time is an empty state, not an error.
   */
  latestAtsScore(resumeId: string, signal?: AbortSignal) {
    return request<AtsScoreResponse | undefined>(`/resumes/${resumeId}/ats-score/latest`, {
      signal,
    });
  },

  atsHistory(resumeId: string, signal?: AbortSignal) {
    return request<{ history: AtsHistoryEntry[] }>(`/resumes/${resumeId}/ats-score/history`, {
      signal,
    });
  },

  // --- Job description matching ---

  compareJd(resumeId: string, body: CompareJdBody, signal?: AbortSignal) {
    return request<JdCompareResponse>(`/resumes/${resumeId}/jd-compare`, {
      method: "POST",
      body,
      signal,
    });
  },

  jdComparisons(resumeId: string, signal?: AbortSignal) {
    return request<{ comparisons: JdComparisonSummary[] }>(`/resumes/${resumeId}/jd-compare`, {
      signal,
    });
  },

  jdComparison(resumeId: string, comparisonId: string, signal?: AbortSignal) {
    return request<JdCompareResponse>(`/resumes/${resumeId}/jd-compare/${comparisonId}`, {
      signal,
    });
  },

  /**
   * Applies one suggestion through the assistant, streaming the same events the
   * chat panel consumes — which is what makes the edit land on the editor's undo
   * stack as a single step, identical to a typed request.
   *
   * Note what isn't sent: the instruction. Only its id travels, and the server
   * reads the text it composed out of the stored comparison.
   */
  applyJdSuggestion(
    resumeId: string,
    comparisonId: string,
    suggestionId: string,
    signal?: AbortSignal,
  ) {
    return streamRequest<ChatStreamEvent>(
      `/resumes/${resumeId}/jd-compare/${comparisonId}/apply`,
      { suggestionId },
      signal,
    );
  },

  // --- Cover letters ---

  /**
   * Generates a letter, or regenerates one in place when `coverLetterId` is set.
   *
   * Omitting `jobDescriptionText` entirely asks the server to reuse the most
   * recent JD this resume was compared against; sending an empty string is an
   * explicit "write it without one". Those are different requests, which is why
   * the field is optional *and* nullable rather than just nullable.
   */
  generateCoverLetter(resumeId: string, body: GenerateCoverLetterBody, signal?: AbortSignal) {
    return request<CoverLetterResponse>(`/resumes/${resumeId}/cover-letter`, {
      method: "POST",
      body,
      signal,
    });
  },

  coverLetters(resumeId: string, signal?: AbortSignal) {
    return request<CoverLetterListResponse>(`/resumes/${resumeId}/cover-letter`, { signal });
  },

  coverLetter(letterId: string, signal?: AbortSignal) {
    return request<{ letter: CoverLetterDto }>(`/cover-letters/${letterId}`, { signal });
  },

  /** The autosave target for hand edits, same contract as `updateResume`. */
  updateCoverLetter(letterId: string, body: UpdateCoverLetterBody, signal?: AbortSignal) {
    return request<{ letter: CoverLetterDto }>(`/cover-letters/${letterId}`, {
      method: "PATCH",
      body,
      signal,
    });
  },

  deleteCoverLetter(letterId: string) {
    return request<void>(`/cover-letters/${letterId}`, { method: "DELETE" });
  },

  /** Absolute URL so the browser can navigate to it for a file download. */
  coverLetterExportUrl(letterId: string) {
    return `${API_URL}/cover-letters/${letterId}/export.pdf`;
  },

  // --- Billing & membership (v5) ---

  /**
   * Public: `/pricing` renders for signed-out visitors, so this never requires
   * an auth cookie. `paymentsEnabled` is the API telling the page whether the
   * Stripe key is configured — the page renders disabled buttons with a reason
   * instead of buttons that fail on click.
   */
  plans(signal?: AbortSignal) {
    return request<{ plans: PlanDto[]; paymentsEnabled: boolean }>("/billing/plans", { signal });
  },

  /**
   * Starts hosted Checkout and returns the URL to send the browser to. The body
   * names a plan by key; the amount is decided entirely by the server.
   */
  checkout(body: CreateCheckoutBody) {
    return request<{ url: string }>("/billing/checkout", { method: "POST", body });
  },

  /**
   * The caller's membership and live allowance, through the same resolution the
   * metered routes use — so the counter here is the counter the next AI action
   * will be checked against.
   */
  subscription(signal?: AbortSignal) {
    return request<{ subscription: SubscriptionDto }>("/billing/subscription", { signal });
  },

  /** Cancels at period end. Access continues to `currentPeriodEnd`, then stops. */
  cancelSubscription() {
    return request<{ subscription: SubscriptionDto }>("/billing/cancel", { method: "POST" });
  },

  /**
   * A Customer Portal session URL — payment methods, invoices, and cancelling
   * happen on Stripe's pages, not ours.
   */
  billingPortal() {
    return request<{ url: string }>("/billing/portal", { method: "POST" });
  },
};
