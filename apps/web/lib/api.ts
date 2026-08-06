import type {
  ProfessionDto,
  PublicUser,
  ResumeWithTemplateDto,
  TemplateDto,
  UpdateResumeBody,
} from "@repo/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = "ApiError";
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
    );
  }

  return payload as T;
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

  createResume(body: { templateId: string; title?: string; blank?: boolean }) {
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
};
