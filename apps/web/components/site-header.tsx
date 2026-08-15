"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../lib/auth-context";
import { Button, ButtonLink } from "./button";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";

/** Marketing/app header. The editor uses its own toolbar instead of this. */
export function SiteHeader() {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-rule/70 bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Logo />

        <nav className="flex items-center gap-1">
          <NavLink href="/templates" active={pathname === '/templates'}>
            Templates
          </NavLink>

          {/* PDF editing lived only behind a dashboard button, which hid it from
              everyone who hadn't signed in yet. */}
          <NavLink href="/pdf" active={pathname === '/pdf'}>
            Edit a PDF
          </NavLink>

          <NavLink href="/pricing" active={pathname === '/pricing'}>
            Pricing
          </NavLink>

          {loading ? (
            // Reserve the space so the header doesn't jolt when auth resolves.
            <div className="ml-2 h-10 w-[13rem]" aria-hidden />
          ) : user ? (
            <>
              <NavLink href="/dashboard" active={pathname === '/dashboard'}>
                My resumes
              </NavLink>
              <NavLink href="/settings" active={pathname === '/settings'}>
                Settings
              </NavLink>
              {/* A rendering hint only — /admin/ai-settings re-reads the role
                  from the database, so a client that lies about it gains a link
                  to a 403. */}
              {user.role === "admin" && (
                <NavLink href="/admin/ai-settings" active={pathname.startsWith('/admin')}>
                  AI
                </NavLink>
              )}
              <Button variant="ghost" size="md" className="ml-1" onClick={() => void logout()}>
                Sign out
              </Button>
            </>
          ) : (
            <>
              <NavLink href="/login" active={pathname === '/login'}>
                Sign in
              </NavLink>
              <ButtonLink href="/signup" size="md" className="ml-2">
                Get started
              </ButtonLink>
            </>
          )}
          <ThemeToggle className="ml-1" />
        </nav>
      </div>
    </header>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-lg px-3 py-2 text-sm transition-colors ${
        active ? "text-ink" : "text-ink-muted hover:bg-paper-sunken hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}
