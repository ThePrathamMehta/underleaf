import Anthropic, { APIError, APIUserAbortError } from "@anthropic-ai/sdk";
import type {
  ContentBlockParam,
  MessageParam,
  StopReason,
  Tool,
} from "@anthropic-ai/sdk/resources/messages";
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
 * Anthropic Messages API.
 *
 * Built on the official SDK rather than hand-rolled `fetch` + SSE parsing. The
 * wire format has real subtleties — tool arguments arrive as a sequence of
 * `input_json_delta` fragments that only become valid JSON once the block
 * closes — and the SDK's types are the authoritative description of them, so
 * TypeScript catches a mismatch here at build time instead of at 2am.
 */

/**
 * Anthropic requires `max_tokens`; there is no "as much as you need". Sized for
 * the longest thing v4 asks for, which is a chat turn rewriting several sections
 * of a resume in one go.
 */
const DEFAULT_MAX_TOKENS = 4096;

function mapStopReason(reason: StopReason | null): AiStopReason {
  switch (reason) {
    case "tool_use":
      return "tool_calls";
    case "max_tokens":
      return "max_tokens";
    case "end_turn":
    case "stop_sequence":
      return "end_turn";
    default:
      // `pause_turn` and `refusal` are real outcomes but nothing upstream can
      // act on them differently, and a refusal reads to the user as the model
      // declining — which the accompanying text already says.
      return "other";
  }
}

function toAnthropicTools(tools: AiToolDef[]): Tool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    // The JSON Schema is generated from Zod by `toolFromZod`, so the schema the
    // model is shown is the same object the arguments are validated against.
    input_schema: tool.parameters as Tool.InputSchema,
  }));
}

/**
 * Rebuilds our flat message list as Anthropic content blocks.
 *
 * The shapes differ in one structural way worth naming: we carry tool calls and
 * their results as fields on a message, Anthropic carries them as blocks inside
 * one. Assistant tool calls become `tool_use` blocks on the assistant turn, and
 * their results become `tool_result` blocks on the *user* turn that answers —
 * which is why `AiMessage.toolResults` lives on a user message.
 */
function toAnthropicMessages(messages: AiMessage[]): MessageParam[] {
  return messages.map((message) => {
    const blocks: ContentBlockParam[] = [];

    for (const result of message.toolResults ?? []) {
      blocks.push({
        type: "tool_result",
        tool_use_id: result.toolCallId,
        content: result.content,
        is_error: result.isError ?? false,
      });
    }

    if (message.content.length > 0) {
      blocks.push({ type: "text", text: message.content });
    }

    for (const call of message.toolCalls ?? []) {
      blocks.push({
        type: "tool_use",
        id: call.id,
        name: call.name,
        input: parseArgumentsOrEmpty(call.arguments),
      });
    }

    // A turn with no blocks at all is rejected by the API. That only happens for
    // an assistant message that was pure tool calls we failed to record, so an
    // empty-string text block keeps a malformed history from 400ing the whole
    // conversation.
    if (blocks.length === 0) {
      blocks.push({ type: "text", text: "" });
    }

    return { role: message.role, content: blocks };
  });
}

/**
 * Replaying history, not validating it — the arguments were already checked when
 * the call was made, and a history entry that no longer parses shouldn't take
 * down the next turn.
 */
function parseArgumentsOrEmpty(json: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return {};
  }
}

function mapError(error: unknown): AiError {
  if (error instanceof APIUserAbortError) {
    return new AiError("timeout", undefined, { cause: error });
  }
  if (error instanceof APIError) {
    // `status` is undefined on connection and timeout errors, which
    // `codeForStatus` already reports as a provider fault rather than guessing.
    return new AiError(codeForStatus(error.status), error.message, {
      status: error.status,
      cause: error,
    });
  }
  return toAiError(error);
}

export function createAnthropicAdapter(config: AiAdapterConfig): AiAdapter {
  const client = new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseUrl ?? undefined,
    // Retries are `client.ts`'s job, once, with our own classification of what
    // is worth retrying. Two layers of backoff would silently multiply the wall
    // time a user waits before seeing an error.
    maxRetries: 0,
  });

  function buildParams(request: AiRequest) {
    return {
      model: config.modelName,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: toAnthropicMessages(request.messages),
      ...(request.system ? { system: request.system } : {}),
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.tools?.length ? { tools: toAnthropicTools(request.tools) } : {}),
    };
  }

  function requestOptions(request: AiRequest) {
    return {
      ...(request.signal ? { signal: request.signal } : {}),
      ...(request.timeoutMs ? { timeout: request.timeoutMs } : {}),
    };
  }

  return {
    provider: "anthropic",
    modelName: config.modelName,

    async complete(request: AiRequest): Promise<AiCompletion> {
      try {
        const message = await client.messages.create(
          { ...buildParams(request), stream: false },
          requestOptions(request),
        );

        let text = "";
        const toolCalls: AiToolCall[] = [];

        for (const block of message.content) {
          if (block.type === "text") {
            text += block.text;
          } else if (block.type === "tool_use") {
            toolCalls.push({
              id: block.id,
              name: block.name,
              // Re-serialized rather than passed as an object: `AiToolCall`
              // carries raw JSON text so streaming and non-streaming paths hand
              // callers the same thing to validate.
              arguments: JSON.stringify(block.input ?? {}),
            });
          }
        }

        return {
          text,
          toolCalls,
          usage: {
            promptTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens,
          },
          stopReason: mapStopReason(message.stop_reason),
        };
      } catch (error) {
        throw mapError(error);
      }
    },

    async *stream(request: AiRequest): AsyncIterable<AiStreamEvent> {
      /**
       * Open tool_use blocks, keyed by the index the API assigns them.
       *
       * Buffered rather than streamed through: a consumer can do nothing with
       * half a JSON object, and every one of them would otherwise have to
       * reimplement this same accumulator to find out what the model asked for.
       */
      const pending = new Map<number, { id: string; name: string; json: string }>();
      let promptTokens = 0;
      let outputTokens = 0;
      let stopReason: AiStopReason = "end_turn";

      try {
        const stream = await client.messages.create(
          { ...buildParams(request), stream: true },
          requestOptions(request),
        );

        for await (const event of stream) {
          switch (event.type) {
            case "message_start":
              promptTokens = event.message.usage.input_tokens;
              outputTokens = event.message.usage.output_tokens;
              break;

            case "content_block_start":
              if (event.content_block.type === "tool_use") {
                pending.set(event.index, {
                  id: event.content_block.id,
                  name: event.content_block.name,
                  json: "",
                });
              }
              break;

            case "content_block_delta":
              if (event.delta.type === "text_delta") {
                yield { type: "text", text: event.delta.text };
              } else if (event.delta.type === "input_json_delta") {
                const open = pending.get(event.index);
                if (open) open.json += event.delta.partial_json;
              }
              break;

            case "content_block_stop": {
              const open = pending.get(event.index);
              if (open) {
                pending.delete(event.index);
                yield {
                  type: "tool_call",
                  // A tool taking no arguments produces no deltas at all, so the
                  // buffer is empty rather than "{}" — and "" is not JSON.
                  toolCall: { id: open.id, name: open.name, arguments: open.json || "{}" },
                };
              }
              break;
            }

            case "message_delta":
              stopReason = mapStopReason(event.delta.stop_reason);
              // Cumulative across the response, so this replaces rather than adds.
              outputTokens = event.usage.output_tokens;
              break;

            default:
              break;
          }
        }

        yield { type: "usage", usage: { promptTokens, outputTokens } };
        yield { type: "done", stopReason };
      } catch (error) {
        // Surfaced as an event, not a throw: a stream that has already yielded
        // text mid-turn needs the consumer to see the failure *and* keep what it
        // rendered. `client.ts` converts this back to a throw where callers want one.
        const aiError = mapError(error);
        yield { type: "error", code: aiError.code, message: aiError.message };
      }
    },
  };
}
