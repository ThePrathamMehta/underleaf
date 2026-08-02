"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { Button } from "./button";
import { Logo } from "./logo";

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
  const [error, setError] = useState<string | null>(null);
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

          <form onSubmit={handleSubmit} className="mt-9 space-y-4" noValidate>
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
