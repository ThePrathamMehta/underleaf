"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ApiError } from "../lib/api";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { Button } from "./button";
import { Logo } from "./logo";

/** Human copy for the ?error= param the OAuth callback redirects back with. */
const OAUTH_ERRORS: Record<string, string> = {
  oauth_failed: "That sign-in didn't complete. Please try again.",
  link_conflict:
    "An account with this email already exists. Sign in with your password first to link this provider.",
};

/**
 * Shared shell for /login and /signup. Both flows differ only in fields and
 * copy, so the layout, error handling and redirect logic live in one place.
 */
export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const isSignup = mode === "signup";
  const { login, signup } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const oauthErrorParam = searchParams.get("error");
  const [error, setError] = useState<string | null>(
    oauthErrorParam ? (OAUTH_ERRORS[oauthErrorParam] ?? "Something went wrong signing in.") : null,
  );
  const [submitting, setSubmitting] = useState(false);

  // Preserved so a user bounced off a protected page lands back on it.
  const next = searchParams.get("next") ?? "/dashboard";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (isSignup) {
        await signup(email, password, name);
      } else {
        await login(email, password);
      }
      router.push(next);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Something went wrong. Please try again.",
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <div className="px-6 py-6">
        <Logo />
      </div>

      <div className="flex flex-1 items-center justify-center px-6 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-[26rem]"
        >
          <h1 className="font-display text-[2.5rem] leading-tight tracking-tight">
            {isSignup ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-2 text-ink-muted">
            {isSignup
              ? "Free while in beta. Your resumes are saved as you type."
              : "Sign in to pick up where you left off."}
          </p>

          {/* OAuth — first-class buttons in the app's own visual language, not
              generic provider badges. They redirect to the API's Passport flow. */}
          <div className="mt-8 grid gap-2.5">
            <OAuthButton provider="google" label="Continue with Google" icon={<GoogleIcon />} />
            <OAuthButton provider="github" label="Continue with GitHub" icon={<GitHubIcon />} />
          </div>

          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-rule" />
            <span className="font-mono text-[0.625rem] uppercase tracking-[0.14em] text-ink-faint">
              or with email
            </span>
            <span className="h-px flex-1 bg-rule" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {isSignup && (
              <Field
                label="Name"
                type="text"
                value={name}
                onChange={setName}
                autoComplete="name"
                placeholder="Avery Chen"
                required
              />
            )}

            <Field
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
              placeholder="you@example.com"
              required
            />

            <Field
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete={isSignup ? "new-password" : "current-password"}
              placeholder={isSignup ? "At least 8 characters" : "••••••••"}
              hint={isSignup ? "At least 8 characters." : undefined}
              required
            />

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

            <Button type="submit" size="lg" disabled={submitting} className="w-full">
              {submitting ? "One moment…" : isSignup ? "Create account" : "Sign in"}
            </Button>
          </form>

          <p className="mt-7 text-sm text-ink-muted">
            {isSignup ? "Already have an account? " : "New to Underleaf? "}
            <Link
              href={isSignup ? "/login" : "/signup"}
              className="text-accent underline decoration-accent-ring underline-offset-[3px] hover:decoration-accent"
            >
              {isSignup ? "Sign in" : "Create one"}
            </Link>
          </p>
        </motion.div>
      </div>
    </div>
  );
}

function OAuthButton({
  provider,
  label,
  icon,
}: {
  provider: "google" | "github";
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <a
      href={api.oauthUrl(provider)}
      className="inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-lg bg-paper-raised text-[0.9375rem] font-medium text-ink ring-1 ring-inset ring-rule-strong transition-colors hover:bg-paper-sunken"
    >
      {icon}
      {label}
    </a>
  );
}

function GoogleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95L3.97 7.3C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.36-3.88-1.36-.53-1.34-1.28-1.7-1.28-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.11 3.04.74.8 1.19 1.83 1.19 3.08 0 4.41-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  autoComplete,
  placeholder,
  hint,
  required,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required={required}
        className="h-11 w-full rounded-lg bg-paper-raised px-3.5 text-[0.9375rem] text-ink shadow-[inset_0_1px_2px_rgb(28_25_23/0.04)] ring-1 ring-inset ring-rule-strong transition-shadow placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent"
      />
      {hint && <span className="mt-1.5 block text-xs text-ink-faint">{hint}</span>}
    </label>
  );
}
