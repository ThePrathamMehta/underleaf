"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { Button } from "../../components/button";
import { SiteHeader } from "../../components/site-header";

/**
 * Account settings.
 *
 * Split into three independent forms rather than one big Save: changing a name
 * and changing a password have different confirmation requirements and different
 * failure modes, and one shared submit would either over-ask (a password to
 * rename yourself) or under-ask (no password to change one).
 *
 * Everything here branches on `user.hasPassword`. An OAuth-only account has no
 * password to confirm, so it gets "set a password" instead of "change", and
 * confirms deletion by typing its email instead.
 */
export default function SettingsPage() {
  const router = useRouter();
  const { user, loading, setUser } = useAuth();

  useEffect(() => {
    if (!loading && !user) router.replace("/login?next=/settings");
  }, [loading, user, router]);

  if (!user) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-14">
          <div className="h-9 w-56 animate-pulse rounded bg-paper-sunken" />
          <div className="mt-10 space-y-4">
            <div className="h-24 animate-pulse rounded-xl bg-paper-raised ring-1 ring-inset ring-rule" />
            <div className="h-24 animate-pulse rounded-xl bg-paper-raised ring-1 ring-inset ring-rule" />
          </div>
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
            Account
          </p>
          <h1 className="font-display text-[clamp(2rem,4vw,2.75rem)] leading-[1.05] tracking-tightest">
            Settings
          </h1>
          <p className="mt-3 text-ink-muted">
            Signed in as {user.email}
            {user.oauthProvider && <> · connected with {providerName(user.oauthProvider)}</>} · member
            since {memberSince(user.createdAt)}
          </p>
        </header>

        <div className="mt-12 space-y-6">
          <ProfileSection key={`profile-${user.id}`} />
          <PasswordSection key={`password-${user.id}`} />
          <DangerSection key={`danger-${user.id}`} onDeleted={() => setUser(null)} />
        </div>
      </main>
    </>
  );
}

// --- Profile ---

function ProfileSection() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!user) return null;

  // Nothing to send is nothing to save — this also keeps the API's "provide a
  // name or an email" rejection unreachable from the UI.
  const dirty = name.trim() !== user.name || email.trim().toLowerCase() !== user.email;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!user || !dirty) return;

    setError(null);
    setSaved(false);
    setSaving(true);

    try {
      // Only the changed fields go up, so a rename can't fail on an email
      // conflict it didn't cause.
      const { user: updated } = await api.updateProfile({
        ...(name.trim() !== user.name ? { name: name.trim() } : {}),
        ...(email.trim().toLowerCase() !== user.email ? { email: email.trim() } : {}),
      });
      setUser(updated);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save those changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Profile" description="The name on your account. Not the name on your resumes.">
      <form onSubmit={save} className="space-y-4" noValidate>
        <Field
          label="Name"
          type="text"
          value={name}
          onChange={(value) => {
            setName(value);
            setSaved(false);
          }}
          autoComplete="name"
        />

        <Field
          label="Email"
          type="email"
          value={email}
          onChange={(value) => {
            setEmail(value);
            setSaved(false);
          }}
          autoComplete="email"
          hint="You sign in with this address."
        />

        {error && <Alert>{error}</Alert>}

        <div className="flex items-center gap-3">
          <Button type="submit" size="md" disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
          <SavedFlag show={saved && !dirty} />
        </div>
      </form>
    </Section>
  );
}

// --- Password ---

function PasswordSection() {
  const { user } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!user) return null;

  const hasPassword = user.hasPassword;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);

    // Checked here rather than server-side: the confirmation field exists to
    // catch a typo in the browser, and the API has no use for a second copy.
    if (next !== confirm) {
      setError("Those two passwords don't match.");
      return;
    }
    if (next.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setSaving(true);
    try {
      await api.changePassword({
        ...(hasPassword ? { currentPassword: current } : {}),
        newPassword: next,
      });
      setCurrent("");
      setNext("");
      setConfirm("");
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not change your password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      title={hasPassword ? "Password" : "Set a password"}
      description={
        hasPassword
          ? "Changing it doesn't sign you out of this browser."
          : `You signed up with ${providerName(user.oauthProvider)}, so this account has no password yet. Setting one lets you sign in with your email as well — the provider stays connected either way.`
      }
    >
      <form onSubmit={save} className="space-y-4" noValidate>
        {hasPassword && (
          <Field
            label="Current password"
            type="password"
            value={current}
            onChange={setCurrent}
            autoComplete="current-password"
          />
        )}

        <Field
          label={hasPassword ? "New password" : "Password"}
          type="password"
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          hint="At least 8 characters."
        />

        <Field
          label="Confirm password"
          type="password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
        />

        {error && <Alert>{error}</Alert>}

        <div className="flex items-center gap-3">
          <Button type="submit" size="md" disabled={saving || next.length === 0}>
            {saving ? "Saving…" : hasPassword ? "Change password" : "Set password"}
          </Button>
          <SavedFlag show={saved} label={hasPassword ? "Password changed" : "Password set"} />
        </div>
      </form>
    </Section>
  );
}

// --- Delete ---

function DangerSection({ onDeleted }: { onDeleted: () => void }) {
  const router = useRouter();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [proof, setProof] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  const hasPassword = user.hasPassword;

  async function destroy(event: React.FormEvent) {
    event.preventDefault();
    if (!user) return;

    setError(null);
    setDeleting(true);

    try {
      await api.deleteAccount(hasPassword ? { password: proof } : { confirmEmail: proof });
      // The server already cleared the cookie; this clears the cached user so
      // the header doesn't render a signed-in state on the way out.
      onDeleted();
      router.replace("/");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not delete your account.");
      setDeleting(false);
    }
  }

  return (
    <section className="rounded-xl bg-paper-raised p-6 ring-1 ring-inset ring-danger/20 sm:p-7">
      <h2 className="font-display text-xl tracking-tight text-danger">Delete account</h2>
      <p className="mt-2 max-w-[62ch] text-[0.9375rem] leading-relaxed text-ink-muted text-pretty">
        This removes your account, every resume, every uploaded PDF and every file behind them.
        There is no undo and no export afterwards — download anything you want to keep first.
      </p>

      <AnimatePresence initial={false} mode="wait">
        {!open ? (
          <motion.div key="closed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Button variant="danger" size="md" className="mt-5" onClick={() => setOpen(true)}>
              Delete my account
            </Button>
          </motion.div>
        ) : (
          <motion.form
            key="open"
            onSubmit={destroy}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
            noValidate
          >
            <div className="mt-5 space-y-4">
              <Field
                label={hasPassword ? "Confirm with your password" : "Type your email to confirm"}
                type={hasPassword ? "password" : "email"}
                value={proof}
                onChange={setProof}
                autoComplete={hasPassword ? "current-password" : "off"}
                placeholder={hasPassword ? undefined : user.email}
              />

              {error && <Alert>{error}</Alert>}

              <div className="flex flex-wrap items-center gap-2.5">
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={() => {
                    setOpen(false);
                    setProof("");
                    setError(null);
                  }}
                >
                  Keep my account
                </Button>
                <Button type="submit" variant="danger" size="md" disabled={deleting || !proof}>
                  {deleting ? "Deleting…" : "Permanently delete"}
                </Button>
              </div>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </section>
  );
}

// --- Shared pieces ---

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl bg-paper-raised p-6 ring-1 ring-inset ring-rule sm:p-7">
      <h2 className="font-display text-xl tracking-tight">{title}</h2>
      <p className="mt-1.5 max-w-[62ch] text-[0.9375rem] leading-relaxed text-ink-muted text-pretty">
        {description}
      </p>
      <div className="mt-6">{children}</div>
    </section>
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
}: {
  label: string;
  type: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  placeholder?: string;
  hint?: string;
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
        className="h-11 w-full rounded-lg bg-paper px-3.5 text-[0.9375rem] text-ink shadow-[inset_0_1px_2px_rgb(28_25_23/0.04)] ring-1 ring-inset ring-rule-strong transition-shadow placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent"
      />
      {hint && <span className="mt-1.5 block text-xs text-ink-faint">{hint}</span>}
    </label>
  );
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <motion.p
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      role="alert"
      className="rounded-lg bg-danger-wash px-3 py-2.5 text-sm text-danger ring-1 ring-inset ring-danger/15"
    >
      {children}
    </motion.p>
  );
}

function SavedFlag({ show, label = "Saved" }: { show: boolean; label?: string }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.span
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0 }}
          // aria-live so the confirmation is announced; it's the only feedback
          // a successful save produces.
          aria-live="polite"
          className="inline-flex items-center gap-1.5 text-[0.8125rem] text-positive"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="m4 12 5.5 5.5L20 7" />
          </svg>
          {label}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function providerName(provider: string | null): string {
  if (provider === "google") return "Google";
  if (provider === "github") return "GitHub";
  return "a connected provider";
}

function memberSince(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
