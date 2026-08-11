"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  AI_FEATURE_PURPOSES,
  AI_PROVIDERS,
  AI_PROVIDER_LABELS,
  AI_PURPOSE_LABELS,
  type AiConfigResponse,
  type AiProvider,
  type AiProviderConfigDto,
  type AiPurpose,
  type AiSecretRefDto,
} from "@repo/types";
import { api, ApiError } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";
import { Button, ButtonLink } from "../../../components/button";
import { SiteHeader } from "../../../components/site-header";
import { Segmented } from "../../../components/editor/controls";

/**
 * Which provider and model answer each AI feature.
 *
 * Organized by purpose rather than as a flat list of rows, because that is the
 * decision an admin is actually making: "what runs the chat assistant", not
 * "what configurations exist". Each purpose gets one card showing the model
 * serving it today and a form to change it.
 *
 * What this page cannot do, by construction: display or accept an API key. Keys
 * live in the server's environment; the picker below chooses which environment
 * variable a purpose reads, and the server never sends a value back.
 */

/** The four features, then the catch-all — the order the cards render in. */
const PURPOSE_ORDER: AiPurpose[] = [...AI_FEATURE_PURPOSES, "all"];

const PURPOSE_HINTS: Record<AiPurpose, string> = {
  chat: "Edits the resume through tool calls. Benefits most from a strong model.",
  ats: "Runs on demand against the whole document. Cheap and fast is usually right.",
  jdMatch: "Compares a job description to the resume and suggests specific fixes.",
  coverLetter: "Writes the letter itself, so output quality is what shows.",
  all: "Used for any feature above that has no model of its own.",
};

const PROVIDER_OPTIONS = AI_PROVIDERS.map((provider) => ({
  value: provider,
  label: AI_PROVIDER_LABELS[provider],
}));

/**
 * Starting points, not a fixed list — the model field is free text precisely so
 * a model released next week is usable without a deploy.
 */
const MODEL_SUGGESTIONS: Record<AiProvider, string[]> = {
  anthropic: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
  openai: ["gpt-5", "gpt-5-mini", "gpt-4.1"],
  other: [],
};

const DEFAULT_SECRET_REF: Record<AiProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  other: "",
};

export default function AiSettingsPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [data, setData] = useState<AiConfigResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login?next=/admin/ai-settings");
  }, [loading, user, router]);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setData(await api.aiConfig(signal));
      setError(null);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      // 403 is its own state rather than an error banner: nothing on this page
      // is worth rendering to someone who can't use it, and the role is checked
      // server-side regardless of what `user.role` says here.
      if (caught instanceof ApiError && caught.status === 403) {
        setForbidden(true);
        return;
      }
      setError(caught instanceof ApiError ? caught.message : "Could not load AI settings.");
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [user, load]);

  if (!user) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-14">
          <div className="h-9 w-56 animate-pulse rounded bg-paper-sunken" />
          <div className="mt-10 space-y-4">
            <div className="h-40 animate-pulse rounded-xl bg-paper-raised ring-1 ring-inset ring-rule" />
            <div className="h-40 animate-pulse rounded-xl bg-paper-raised ring-1 ring-inset ring-rule" />
          </div>
        </main>
      </>
    );
  }

  if (forbidden) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-14">
          <h1 className="font-display text-[clamp(2rem,4vw,2.75rem)] leading-[1.05] tracking-tightest">
            Not your page
          </h1>
          <p className="mt-3 max-w-[60ch] text-ink-muted text-pretty">
            AI settings are admin-only. They decide which provider and model this deployment calls,
            and what that costs — so the role is granted by whoever runs the server, not requested
            from inside the app.
          </p>
          <ButtonLink href="/dashboard" size="md" className="mt-6">
            Back to your resumes
          </ButtonLink>
        </main>
      </>
    );
  }

  return (
    <>
      <SiteHeader />

      <main className="mx-auto max-w-3xl px-6 py-14">
        <header>
          <p className="mb-3 font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-ink-faint">
            Admin
          </p>
          <h1 className="font-display text-[clamp(2rem,4vw,2.75rem)] leading-[1.05] tracking-tightest">
            AI settings
          </h1>
          <p className="mt-3 max-w-[64ch] text-ink-muted text-pretty">
            Pick the provider and model behind each feature. Changes take effect on the next
            request — no redeploy. API keys are read from the server&rsquo;s environment; this page
            only chooses which one a feature uses, and never shows a key.
          </p>
        </header>

        {error && (
          <div className="mt-8 rounded-xl bg-danger-wash p-5 ring-1 ring-inset ring-danger/15">
            <p className="text-sm text-danger">{error}</p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        )}

        {!data && !error && (
          <div className="mt-10 space-y-4">
            {PURPOSE_ORDER.map((purpose) => (
              <div
                key={purpose}
                className="h-40 animate-pulse rounded-xl bg-paper-raised ring-1 ring-inset ring-rule"
              />
            ))}
          </div>
        )}

        {data && (
          <>
            <SecretRefSummary refs={data.availableSecretRefs} />

            <div className="mt-6 space-y-6">
              {PURPOSE_ORDER.map((purpose) => {
                const config = activeConfigFor(data.configs, purpose);
                return (
                  <PurposeCard
                    // Keyed by row id so a reload after saving remounts the form
                    // onto the saved values instead of leaving stale local edits.
                    key={`${purpose}:${config?.id ?? "none"}`}
                    purpose={purpose}
                    config={config}
                    secretRefs={data.availableSecretRefs}
                  />
                );
              })}
            </div>
          </>
        )}
      </main>
    </>
  );
}

/** The active row targeting this purpose exactly. `all` is a fallback at call
 * time, not a substitute here — a card should show what *it* is configured
 * with, so an empty card reads as "falls back", which is the truth. */
function activeConfigFor(
  configs: AiProviderConfigDto[],
  purpose: AiPurpose,
): AiProviderConfigDto | null {
  return configs.find((config) => config.purpose === purpose && config.isActive) ?? null;
}

// --- Keys ---

function SecretRefSummary({ refs }: { refs: AiSecretRefDto[] }) {
  const configured = refs.filter((ref) => ref.configured);

  return (
    <section className="mt-10 rounded-xl bg-paper-sunken p-5 ring-1 ring-inset ring-rule">
      <h2 className="font-display text-base tracking-tight">Keys on this server</h2>
      <p className="mt-1.5 max-w-[62ch] text-[0.875rem] leading-relaxed text-ink-muted text-pretty">
        Set as environment variables where the API runs. Underleaf stores the name, never the value.
      </p>

      <ul className="mt-4 flex flex-wrap gap-2">
        {refs.map((ref) => (
          <li
            key={ref.name}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[0.75rem] ring-1 ring-inset ${
              ref.configured
                ? "bg-paper text-ink ring-rule-strong"
                : "bg-transparent text-ink-faint ring-rule"
            }`}
          >
            <span
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${ref.configured ? "bg-positive" : "bg-ink-faint/40"}`}
            />
            {ref.name}
            <span className="sr-only">{ref.configured ? " is set" : " is not set"}</span>
          </li>
        ))}
      </ul>

      {configured.length === 0 && (
        <p className="mt-4 text-[0.8125rem] text-ink-muted">
          None are set yet. Add <span className="font-mono">ANTHROPIC_API_KEY</span> or{" "}
          <span className="font-mono">OPENAI_API_KEY</span> to the API&rsquo;s environment and
          restart it. Extra keys for other gateways must be named{" "}
          <span className="font-mono">AI_KEY_…</span>.
        </p>
      )}
    </section>
  );
}

// --- One purpose ---

function PurposeCard({
  purpose,
  config,
  secretRefs,
}: {
  purpose: AiPurpose;
  config: AiProviderConfigDto | null;
  secretRefs: AiSecretRefDto[];
}) {
  /**
   * The row as the server last confirmed it — seeded from the prop, then
   * replaced by the save response. Held here rather than refetched because the
   * PATCH already returns the persisted row: refetching would only re-derive
   * what we were just handed, and remount this form mid-interaction.
   */
  const [current, setCurrent] = useState(config);

  const [provider, setProvider] = useState<AiProvider>(config?.provider ?? "anthropic");
  const [modelName, setModelName] = useState(config?.modelName ?? "");
  const [secretRef, setSecretRef] = useState(
    config?.apiKeySecretRef ?? DEFAULT_SECRET_REF[config?.provider ?? "anthropic"],
  );
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function changeProvider(next: AiProvider) {
    setProvider(next);
    setSaved(false);
    // Follow the provider unless the admin has already chosen a ref that isn't
    // the old provider's default — retyping ANTHROPIC_API_KEY after every
    // toggle is busywork, but silently discarding a deliberate choice is worse.
    if (secretRef === "" || secretRef === DEFAULT_SECRET_REF[provider]) {
      setSecretRef(DEFAULT_SECRET_REF[next]);
    }
  }

  const selectedRef = secretRefs.find((ref) => ref.name === secretRef);
  const suggestions = MODEL_SUGGESTIONS[provider];

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);

    try {
      const response = await api.saveAiConfig({
        ...(current ? { id: current.id } : {}),
        provider,
        modelName: modelName.trim(),
        apiKeySecretRef: secretRef,
        purpose,
        isActive: true,
        baseUrl: baseUrl.trim() ? baseUrl.trim() : null,
      });
      setCurrent(response.config);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save that model.");
    } finally {
      setSaving(false);
    }
  }

  const canSave = modelName.trim().length > 0 && secretRef.length > 0 && !saving;

  return (
    <section className="rounded-xl bg-paper-raised p-6 ring-1 ring-inset ring-rule sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl tracking-tight">{AI_PURPOSE_LABELS[purpose]}</h2>
          <p className="mt-1.5 max-w-[58ch] text-[0.9375rem] leading-relaxed text-ink-muted text-pretty">
            {PURPOSE_HINTS[purpose]}
          </p>
        </div>
        <CurrentModelBadge config={current} />
      </div>

      <form onSubmit={save} className="mt-6 space-y-4" noValidate>
        <Segmented
          label="Provider"
          options={PROVIDER_OPTIONS}
          value={provider}
          onChange={changeProvider}
        />

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Model</span>
          <input
            type="text"
            value={modelName}
            onChange={(event) => {
              setModelName(event.target.value);
              setSaved(false);
            }}
            placeholder={suggestions[0] ?? "model-name"}
            spellCheck={false}
            className="h-11 w-full rounded-lg bg-paper px-3.5 font-mono text-[0.875rem] text-ink shadow-[inset_0_1px_2px_rgb(28_25_23/0.04)] ring-1 ring-inset ring-rule-strong transition-shadow placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent"
          />
          {suggestions.length > 0 && (
            <span className="mt-2 flex flex-wrap items-center gap-1.5">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    setModelName(suggestion);
                    setSaved(false);
                  }}
                  className="rounded-md bg-paper-sunken px-2 py-1 font-mono text-[0.6875rem] text-ink-muted ring-1 ring-inset ring-rule transition-colors hover:text-ink"
                >
                  {suggestion}
                </button>
              ))}
            </span>
          )}
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">API key</span>
          <select
            value={secretRef}
            onChange={(event) => {
              setSecretRef(event.target.value);
              setSaved(false);
            }}
            className="h-11 w-full rounded-lg bg-paper px-3 font-mono text-[0.875rem] text-ink shadow-[inset_0_1px_2px_rgb(28_25_23/0.04)] ring-1 ring-inset ring-rule-strong focus:outline-none focus:ring-2 focus:ring-accent"
          >
            {secretRef === "" && <option value="">Choose a key…</option>}
            {secretRefs.map((ref) => (
              <option key={ref.name} value={ref.name}>
                {ref.name}
                {ref.configured ? "" : " (not set)"}
              </option>
            ))}
          </select>
          <span className="mt-1.5 block text-xs text-ink-faint">
            {selectedRef && !selectedRef.configured
              ? `${selectedRef.name} has no value on this server — calls will fail until it's set.`
              : "The environment variable to read the key from. Its value never leaves the server."}
          </span>
        </label>

        {provider === "other" && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Base URL</span>
            <input
              type="url"
              value={baseUrl}
              onChange={(event) => {
                setBaseUrl(event.target.value);
                setSaved(false);
              }}
              placeholder="https://api.together.xyz/v1"
              spellCheck={false}
              className="h-11 w-full rounded-lg bg-paper px-3.5 font-mono text-[0.875rem] text-ink shadow-[inset_0_1px_2px_rgb(28_25_23/0.04)] ring-1 ring-inset ring-rule-strong transition-shadow placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <span className="mt-1.5 block text-xs text-ink-faint">
              Any endpoint speaking OpenAI&rsquo;s chat-completions format.
            </span>
          </label>
        )}

        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            role="alert"
            className="rounded-lg bg-danger-wash px-3 py-2.5 text-sm text-danger ring-1 ring-inset ring-danger/15"
          >
            {error}
          </motion.p>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" size="md" disabled={!canSave}>
            {saving ? "Saving…" : current ? "Update model" : "Set model"}
          </Button>
          <AnimatePresence>
            {saved && (
              <motion.span
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                aria-live="polite"
                className="text-[0.8125rem] text-positive"
              >
                Saved
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </form>
    </section>
  );
}

function CurrentModelBadge({ config }: { config: AiProviderConfigDto | null }) {
  if (!config) {
    return (
      <span className="shrink-0 rounded-md bg-paper-sunken px-2.5 py-1 text-[0.75rem] text-ink-faint ring-1 ring-inset ring-rule">
        Falls back
      </span>
    );
  }

  return (
    <span
      className={`shrink-0 rounded-md px-2.5 py-1 font-mono text-[0.75rem] ring-1 ring-inset ${
        config.apiKeyConfigured
          ? "bg-paper text-ink-muted ring-rule-strong"
          : "bg-danger-wash text-danger ring-danger/15"
      }`}
      title={
        config.apiKeyConfigured
          ? `${AI_PROVIDER_LABELS[config.provider]} · ${config.modelName}`
          : `${config.apiKeySecretRef} is not set on the server`
      }
    >
      {config.modelName}
      {!config.apiKeyConfigured && " · no key"}
    </span>
  );
}
