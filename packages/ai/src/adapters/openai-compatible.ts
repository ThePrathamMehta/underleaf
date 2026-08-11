import { AiError } from "../errors";
import type { AiAdapter, AiAdapterConfig } from "../types";
import { createOpenAiCompatibleAdapter } from "./openai";

/**
 * The spec's "or any other model": anything speaking OpenAI's chat-completions
 * format at a configured base URL — Together, Groq, OpenRouter, vLLM, Ollama.
 *
 * A thin wrapper rather than its own implementation, because it is the same
 * protocol. What it adds is the requirement that a base URL exist: for the
 * first-party providers a missing one falls back to the vendor's own endpoint,
 * which for this provider would mean quietly sending a self-hosted gateway's key
 * to OpenAI. `upsertAiConfigBodySchema` refuses to save such a row, and this is
 * the second gate, for rows that predate the check or were written directly.
 */
export function createOpenAiCompatibleProviderAdapter(config: AiAdapterConfig): AiAdapter {
  if (!config.baseUrl) {
    throw new AiError(
      "not_configured",
      "This model is set to an OpenAI-compatible provider but has no base URL.",
    );
  }
  return createOpenAiCompatibleAdapter(config, "other");
}
