"use client";

import type { PublicUser } from "@repo/types";
import Link from "next/link";
import { useAuth } from "../../lib/auth-context";
import { FieldLabel, Popover } from "./controls";

/** Two-letter monogram: first + last initial, or the first two characters. */
function initials(user: PublicUser): string {
  const source = (user.name?.trim() || user.email).trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

/**
 * Account control for the editor toolbar. The editor has its own chrome and
 * doesn't render the marketing SiteHeader, so its logout/account affordance
 * lives here. Reads auth from context directly (as SiteHeader does) so the
 * toolbar's prop surface stays unchanged.
 */
export function UserMenu() {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <Popover
      width={240}
      align="right"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label="Account menu"
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-semibold tracking-wide ring-1 ring-inset transition-colors duration-150 ${
            open
              ? "bg-ink text-paper ring-transparent"
              : "bg-paper-sunken text-ink-muted ring-rule hover:text-ink"
          }`}
        >
          {initials(user)}
        </button>
      )}
    >
      {(close) => (
        <div className="space-y-0.5">
          <div className="px-1 pb-2">
            <FieldLabel>Signed in as</FieldLabel>
            <p className="mt-1.5 truncate text-sm font-medium text-ink">{user.name}</p>
            <p className="truncate text-[0.8125rem] text-ink-muted">{user.email}</p>
          </div>

          <div className="my-1 h-px bg-rule" aria-hidden />

          <Link
            href="/settings"
            onClick={close}
            className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm text-ink-muted transition-colors hover:bg-paper-sunken hover:text-ink"
          >
            Account settings
          </Link>

          <button
            type="button"
            onClick={() => {
              close();
              void logout();
            }}
            className="w-full rounded-md px-2 py-1.5 text-left text-sm text-ink-muted transition-colors hover:bg-paper-sunken hover:text-ink"
          >
            Sign out
          </button>
        </div>
      )}
    </Popover>
  );
}
