import { describe, expect, test } from "bun:test";
import { isAllowedSecretRef, listSecretRefs, resolveSecretRef } from "./secrets";

/**
 * The allowlist is the one piece of this package where a bug is a security bug
 * rather than a broken feature, so it is the piece that gets tested.
 *
 * `resolveSecretRef` and `listSecretRefs` both take an `env` parameter with a
 * `process.env` default precisely so these can run against a fixture instead of
 * mutating the real environment and leaking state between test files.
 */

const ENV = {
  ANTHROPIC_API_KEY: "sk-ant-fixture",
  OPENAI_API_KEY: "",
  AI_KEY_TOGETHER: "together-fixture",
  JWT_SECRET: "the-signing-key-nobody-should-reach",
  DATABASE_URL: "postgresql://localhost/underleaf",
} as NodeJS.ProcessEnv;

describe("isAllowedSecretRef", () => {
  test("permits the two first-party names", () => {
    expect(isAllowedSecretRef("ANTHROPIC_API_KEY")).toBe(true);
    expect(isAllowedSecretRef("OPENAI_API_KEY")).toBe(true);
  });

  test("permits opt-in prefixed names", () => {
    expect(isAllowedSecretRef("AI_KEY_TOGETHER")).toBe(true);
    expect(isAllowedSecretRef("AI_KEY_X")).toBe(true);
  });

  test("refuses the bare prefix, which names no variable", () => {
    expect(isAllowedSecretRef("AI_KEY_")).toBe(false);
  });

  // The attack the prefix rule exists to stop: an admin saving a config that
  // points at a server secret and reading its presence back through the API.
  test("refuses secrets that aren't AI keys", () => {
    expect(isAllowedSecretRef("JWT_SECRET")).toBe(false);
    expect(isAllowedSecretRef("DATABASE_URL")).toBe(false);
    expect(isAllowedSecretRef("PATH")).toBe(false);
  });

  test("is not fooled by a name that merely contains the prefix", () => {
    expect(isAllowedSecretRef("MY_AI_KEY_THING")).toBe(false);
    expect(isAllowedSecretRef("ai_key_together")).toBe(false);
  });
});

describe("resolveSecretRef", () => {
  test("returns the value behind an allowed, populated ref", () => {
    expect(resolveSecretRef("ANTHROPIC_API_KEY", ENV)).toBe("sk-ant-fixture");
    expect(resolveSecretRef("AI_KEY_TOGETHER", ENV)).toBe("together-fixture");
  });

  test("treats an empty value as unset", () => {
    expect(resolveSecretRef("OPENAI_API_KEY", ENV)).toBeUndefined();
  });

  /**
   * The important one. A disallowed ref must answer exactly as an unset one
   * does — same undefined, no thrown error naming the variable. Anything that
   * distinguishes the two hands back the probe the allowlist is there to deny.
   */
  test("refuses a disallowed ref even when it is set", () => {
    expect(resolveSecretRef("JWT_SECRET", ENV)).toBeUndefined();
    expect(resolveSecretRef("DATABASE_URL", ENV)).toBeUndefined();
  });

  test("answers identically for disallowed-and-set and allowed-but-unset", () => {
    expect(resolveSecretRef("JWT_SECRET", ENV)).toBe(resolveSecretRef("OPENAI_API_KEY", ENV));
  });
});

describe("listSecretRefs", () => {
  test("always offers both first-party names, set or not", () => {
    const names = listSecretRefs(ENV).map((entry) => entry.name);
    expect(names).toContain("ANTHROPIC_API_KEY");
    expect(names).toContain("OPENAI_API_KEY");
  });

  test("reports configured accurately, so the UI can explain an absent option", () => {
    const refs = listSecretRefs(ENV);
    expect(refs.find((entry) => entry.name === "ANTHROPIC_API_KEY")?.configured).toBe(true);
    expect(refs.find((entry) => entry.name === "OPENAI_API_KEY")?.configured).toBe(false);
  });

  test("includes prefixed refs and nothing else from the environment", () => {
    const names = listSecretRefs(ENV).map((entry) => entry.name);
    expect(names).toContain("AI_KEY_TOGETHER");
    expect(names).not.toContain("JWT_SECRET");
    expect(names).not.toContain("DATABASE_URL");
  });

  // Every name it offers must be one resolveSecretRef would accept, or the
  // admin UI could present a choice that silently never resolves.
  test("only ever lists names the allowlist accepts", () => {
    for (const { name } of listSecretRefs(ENV)) {
      expect(isAllowedSecretRef(name)).toBe(true);
    }
  });

  test("never carries a value, only a name and a flag", () => {
    for (const entry of listSecretRefs(ENV)) {
      expect(Object.keys(entry).sort()).toEqual(["configured", "name"]);
    }
  });
});
