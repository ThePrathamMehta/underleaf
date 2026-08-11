import OpenAI, { APIError, APIUserAbortError } from "openai";
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type { AiProvider } from "@repo/types";
import { AiError, codeForStatus, toAiError } from "../errors";
import type {
  AiAdapter,
  AiAdapterConfig,
  AiCompletion,
  AiMessage,
  AiRequest,
  AiStopReason,
  AiStreamEvent,
  AiToolCall,
  AiToolDef,
} from "../types";

/**
 * OpenAI chat completions — and, through `openai-compatible.ts`, every gateway
 * that speaks the same wire format.
 *
 * The two share one implementation because they genuinely are one protocol; the
 * only differences are the base URL and which token-limit parameter is accepted,
 * both handled below. A second copy of the streaming tool-call accumulator would
 * be a second place for it to be subtly wrong.
 */

const DEFAULT_MAX_TOKENS = 4096;

function mapFinishReason(reason: string | null | undefined): AiStopReason {
  switch (reason) {
    case "tool_calls":
    case "function_call":
      return "tool_calls";
    case "length":
      return "max_tokens";
    case "stop":
      return "end_turn";
    default:
      return "other";
  }
}

function toOpenAiTools(tools: AiToolDef[]): ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Flattens our message list into OpenAI's.
 *
 * The one non-obvious rule: tool results are their own `role: "tool"` messages
 * and must immediately follow the assistant turn that requested them. We carry
 * results on the answering *user* message, so each one expands into its tool
 * messages first and only then into a user message — and a user turn that was
 * nothing but results contributes no user message at all, because an empty one
 * is rejected.
 */
function toOpenAiMessages(messages: AiMessage[], system?: string): ChatCompletionMessageParam[] {
  const out: ChatCompletionMessageParam[] = [];

  if (system) {
    out.push({ role: "system", content: system });
  }

  for (const message of messages) {
    if (message.role === "assistant") {
      const toolCalls = message.toolCalls ?? [];
      out.push({
        role: "assistant",
        // Null rather than "" on a pure tool-call turn: the API treats an empty
        // string as content the assistant actually said.
        content: message.content.length > 0 ? message.content : null,
        ...(toolCalls.length > 0
          ? {
              tool_calls: toolCalls.map((call) => ({
                id: call.id,
                type: "function" as const,
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
      });
      continue;
    }

    for (const result of message.toolResults ?? []) {
      out.push({
        role: "tool",
        tool_call_id: result.toolCallId,
        // There is no `is_error` in this format, so the marker goes in the text.
        // The model reads it; nothing downstream branches on it.
        content: result.isError ? `Error: ${result.content}` : result.content,
      });
    }

    if (message.content.length > 0) {
      out.push({ role: "user", content: message.content });
    }
  }

  return out;
}

function mapError(error: unknown): AiError {
  if (error instanceof APIUserAbortError) {
    return new AiError("timeout", undefined, { cause: error });
  }
  if (error instanceof APIError) {
    return new AiError(codeForStatus(error.status), error.message, {
      status: error.status,
      cause: error,
    });
  }
  return toAiError(error);
}

/** Accumulates the streamed fragments of one tool call, keyed by its index. */
type PendingToolCall = { id: string; name: string; arguments: string };

function absorbToolCallDeltas(
  pending: Map<number, PendingToolCall>,
  deltas: ChatCompletionChunk.Choice.Delta.ToolCall[],
): void {
  for (const delta of deltas) {
    const existing = pending.get(delta.index) ?? { id: "", name: "", arguments: "" };
    // Every field arrives piecemeal and any of them may be absent from a given
    // chunk — id and name usually land in the first, arguments across many.
    if (delta.id) existing.id = delta.id;
    if (delta.function?.name) existing.name = delta.function.name;
    if (delta.function?.arguments) existing.arguments += delta.function.arguments;
    pending.set(delta.index, existing);
  }
}

/**
 * Shared by the `openai` and `other` providers. `provider` is carried through so
 * the usage log records which one was actually called, and so the token-limit
 * parameter can differ.
 */
export function createOpenAiCompatibleAdapter(
  config: AiAdapterConfig,
  provider: AiProvider,
): AiAdapter {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl ?? undefined,
    // See the note in the Anthropic adapter: one retry policy, in `client.ts`.
    maxRetries: 0,
  });

  function buildParams(request: AiRequest) {
    const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS;

    return {
      model: config.modelName,
      messages: toOpenAiMessages(request.messages, request.system),
      // OpenAI's newer models reject the older `max_tokens` outright, while many
      // self-hosted gateways only implement that one and ignore or reject
      // `max_completion_tokens`. Splitting on provider is what lets both work.
      ...(provider === "openai"
        ? { max_completion_tokens: maxTokens }
        : { max_tokens: maxTokens }),
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.tools?.length ? { tools: toOpenAiTools(request.tools) } : {}),
    };
  }

  function requestOptions(request: AiRequest) {
    return {
      ...(request.signal ? { signal: request.signal } : {}),
      ...(request.timeoutMs ? { timeout: request.timeoutMs } : {}),
    };
  }

  return {
    provider,
    modelName: config.modelName,

    async complete(request: AiRequest): Promise<AiCompletion> {
      try {
        const completion = await client.chat.completions.create(
          { ...buildParams(request), stream: false },
          requestOptions(request),
        );

        const choice = completion.choices[0];
        if (!choice) {
          throw new AiError("invalid_response", "The provider returned no choices.");
        }

        const toolCalls: AiToolCall[] = (choice.message.tool_calls ?? []).flatMap((call) =>
          // `custom` tool calls exist in the type union but we never send custom
          // tools, so anything else here is a response we can't act on.
          call.type === "function"
            ? [{ id: call.id, name: call.function.name, arguments: call.function.arguments }]
            : [],
        );

        return {
          text: choice.message.content ?? "",
          toolCalls,
          usage: {
            promptTokens: completion.usage?.prompt_tokens ?? 0,
            outputTokens: completion.usage?.completion_tokens ?? 0,
          },
          stopReason: mapFinishReason(choice.finish_reason),
        };
      } catch (error) {
        throw mapError(error);
      }
    },

    async *stream(request: AiRequest): AsyncIterable<AiStreamEvent> {
      const pending = new Map<number, PendingToolCall>();
      let promptTokens = 0;
      let outputTokens = 0;
      let stopReason: AiStopReason = "end_turn";

      try {
        const stream = await client.chat.completions.create(
          {
            ...buildParams(request),
            stream: true,
            // Without this the streaming response carries no token counts at
            // all, and the usage log — the entire point of which is cost
            // tracking — would record zeroes for every streamed call.
            stream_options: { include_usage: true },
          },
          requestOptions(request),
        );

        for await (const chunk of stream) {
          if (chunk.usage) {
            promptTokens = chunk.usage.prompt_tokens;
            outputTokens = chunk.usage.completion_tokens;
          }

          const choice = chunk.choices[0];
          if (!choice) continue;

          if (choice.delta.content) {
            yield { type: "text", text: choice.delta.content };
          }
          if (choice.delta.tool_calls?.length) {
            absorbToolCallDeltas(pending, choice.delta.tool_calls);
          }
          if (choice.finish_reason) {
            stopReason = mapFinishReason(choice.finish_reason);
          }
        }

        // Unlike Anthropic, this format has no per-block stop event — a tool
        // call is only known to be complete once the stream ends. So they are
        // emitted here, in index order, rather than as they close.
        for (const [, call] of [...pending.entries()].sort(([a], [b]) => a - b)) {
          yield {
            type: "tool_call",
            toolCall: { id: call.id, name: call.name, arguments: call.arguments || "{}" },
          };
        }

        yield { type: "usage", usage: { promptTokens, outputTokens } };
        yield { type: "done", stopReason };
      } catch (error) {
        const aiError = mapError(error);
        yield { type: "error", code: aiError.code, message: aiError.message };
      }
    },
  };
}

export function createOpenAiAdapter(config: AiAdapterConfig): AiAdapter {
  return createOpenAiCompatibleAdapter(config, "openai");
}
