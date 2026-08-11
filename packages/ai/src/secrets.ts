/**
 * Resolving `AiProviderConfig.apiKeySecretRef` to an actual key.
 *
 * The database stores the *name* of an environment variable. This module is what
 * turns that name into a value, and it is the only place that is allowed to —
 * which is what makes "no raw API key in the database, ever" a property of the
 * design rather than a rule someone has to remember.
 *
 * Re-exported from `apps/api/src/config.ts`, so callers there read it as part of
 * the app's configuration; it lives here because it is an AI concern and belongs
 * next to the code that consumes it.
 */

/** Names always permitted, for the two first-party providers. */
const WELL_KNOWN_REFS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"] as const;

/**
 * Anything else must carry this prefix.
 *
 * Without the prefix rule an admin could save `apiKeySecretRef: "JWT_SECRET"`
 * and learn from the config endpoint's `apiKeyConfigured` flag whether it is
 * set — and, worse, a request would then sign itself to a third-party gateway
 * with this server's signing key. Requiring an opt-in prefix means only
 * variables a deployer deliberately named for this purpose are reachable.
 */
const ALLOWED_PREFIX = "AI_KEY_";

export function isAllowedSecretRef(ref: string): boolean {
  return (
    (WELL_KNOWN_REFS as readonly string[]).includes(ref) ||
    (ref.startsWith(ALLOWED_PREFIX) && ref.length > ALLOWED_PREFIX.length)
  );
}

/**
 * Returns the key behind a ref, or undefined.
 *
 * Undefined covers both "not allowed" and "not set" on purpose: distinguishing
 * them for the caller would leak exactly the probe the allowlist exists to
 * prevent. The admin UI learns which refs are configured from `listSecretRefs`,
 * whose answers are bounded by the allowlist to begin with.
 */
export function resolveSecretRef(ref: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!isAllowedSecretRef(ref)) return undefined;
  const value = env[ref];
  return value && value.length > 0 ? value : undefined;
}

/**
 * Every ref an admin may choose, and whether each is populated.
 *
 * Both first-party names are always listed even when unset, so the settings page
 * can say "OPENAI_API_KEY isn't set on the server" instead of silently omitting
 * the option and leaving the admin to guess why OpenAI isn't offered.
 */
export function listSecretRefs(
  env: NodeJS.ProcessEnv = process.env,
): Array<{ name: string; configured: boolean }> {
  const names = new Set<string>(WELL_KNOWN_REFS);

  for (const key of Object.keys(env)) {
    if (key.startsWith(ALLOWED_PREFIX) && key.length > ALLOWED_PREFIX.length) {
      names.add(key);
    }
  }

  return [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, configured: Boolean(env[name] && env[name]!.length > 0) }));
}
