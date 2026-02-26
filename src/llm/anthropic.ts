/**
 * Anthropic Claude LLM client implementation.
 *
 * Provides integration with Anthropic's Claude API using the official
 * @anthropic-ai/sdk npm package.
 */

import type {
  Message,
  AssistantMessage,
  MultiModalMessage,
  ToolMessage,
} from "../messages.js";
import { isImage, toBase64 } from "../messages.js";
import type { ChatCompletionChunk, ChatCompletionResult, Usage } from "../types.js";
import {
  BaseChatCompletionClient,
  BaseChatCompletionError,
  AuthenticationError,
  RateLimitError,
} from "./base.js";

// ---------------------------------------------------------------------------
// AnthropicChatCompletionClient
// ---------------------------------------------------------------------------

/**
 * Anthropic implementation of BaseChatCompletionClient.
 *
 * Supports Claude 3 models (Opus, Sonnet, Haiku) with
 * function calling and structured output capabilities.
 */
export class AnthropicChatCompletionClient extends BaseChatCompletionClient {
  static override componentType = "model_client" as const;
  static override componentVersion = 1;
  static componentProviderOverride =
    "picoagents/llm/AnthropicChatCompletionClient";

  private client: any; // Anthropic client
  private baseUrl?: string;

  constructor(options: {
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    [key: string]: unknown;
  } = {}) {
    const { model = "claude-sonnet-4-5", apiKey, baseUrl, ...rest } = options;
    super(model, apiKey, rest);
    this.baseUrl = baseUrl;

    // Lazy-import Anthropic to allow the file to be loaded without the package
    const Anthropic =
      require("@anthropic-ai/sdk").default ?? require("@anthropic-ai/sdk");
    this.client = new Anthropic({
      apiKey,
      baseURL: baseUrl,
    });
  }

  async create(
    messages: Message[],
    options: {
      tools?: Record<string, unknown>[];
      outputSchema?: Record<string, unknown>;
      temperature?: number;
      maxTokens?: number;
      [key: string]: unknown;
    } = {}
  ): Promise<ChatCompletionResult> {
    try {
      const startTime = Date.now();

      // Convert messages to Anthropic format
      const apiMessages = this.convertMessagesToAnthropicFormat(messages);

      // Extract system message (Anthropic uses a separate system parameter)
      let systemMessage: string | undefined;
      if (apiMessages.length > 0 && apiMessages[0].role === "system") {
        systemMessage = apiMessages[0].content as string;
        apiMessages.shift();
      }

      const requestParams: Record<string, unknown> = {
        model: this.model,
        messages: apiMessages,
        max_tokens: options.maxTokens ?? 4096,
      };

      if (systemMessage) {
        requestParams.system = systemMessage;
      }
      if (options.temperature !== undefined) {
        requestParams.temperature = options.temperature;
      }
      if (options.tools && options.tools.length > 0) {
        requestParams.tools =
          this.convertToolsToAnthropicFormat(options.tools);
      }

      // Structured output
      if (options.outputSchema) {
        requestParams.betas = ["structured-outputs-2025-11-13"];
        const schema = this.makeSchemaCompatible(options.outputSchema);
        requestParams.output_format = {
          type: "json_schema",
          schema,
        };
      }

      // Make API call
      let response: any;
      if (options.outputSchema) {
        response = await this.client.beta.messages.create(requestParams);
      } else {
        response = await this.client.messages.create(requestParams);
      }

      const durationMs = Date.now() - startTime;

      // Extract content and tool calls
      let assistantContent = "";
      const toolCalls: Array<{
        toolName: string;
        parameters: Record<string, unknown>;
        callId: string;
      }> = [];

      for (const block of response.content) {
        if (block.type === "text") {
          assistantContent += block.text;
        } else if (block.type === "tool_use") {
          toolCalls.push({
            toolName: block.name,
            parameters:
              typeof block.input === "object" ? block.input : {},
            callId: block.id,
          });
        }
      }

      const assistantMessage: AssistantMessage = {
        role: "assistant",
        content: assistantContent,
        source: "llm",
        timestamp: new Date(),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };

      // Parse structured output
      let structuredOutput: Record<string, unknown> | undefined;
      if (options.outputSchema && assistantContent) {
        try {
          structuredOutput = JSON.parse(assistantContent);
        } catch {
          // continue without structured output
        }
      }

      // Usage
      const usage: Usage = {
        durationMs,
        llmCalls: 1,
        tokensInput: response.usage.input_tokens,
        tokensOutput: response.usage.output_tokens,
        toolCalls: toolCalls.length,
        memoryOperations: 0,
        costEstimate: this.estimateCost(
          response.usage.input_tokens,
          response.usage.output_tokens
        ),
      };

      return {
        message: assistantMessage,
        usage,
        model: response.model,
        finishReason: response.stop_reason || "stop",
        structuredOutput,
      };
    } catch (e: unknown) {
      this.handleError(e);
    }
  }

  async *createStream(
    messages: Message[],
    options: {
      tools?: Record<string, unknown>[];
      outputSchema?: Record<string, unknown>;
      temperature?: number;
      maxTokens?: number;
      [key: string]: unknown;
    } = {}
  ): AsyncGenerator<ChatCompletionChunk, void, undefined> {
    try {
      // Convert messages to Anthropic format
      const apiMessages = this.convertMessagesToAnthropicFormat(messages);

      // Extract system message
      let systemMessage: string | undefined;
      if (apiMessages.length > 0 && apiMessages[0].role === "system") {
        systemMessage = apiMessages[0].content as string;
        apiMessages.shift();
      }

      const requestParams: Record<string, unknown> = {
        model: this.model,
        messages: apiMessages,
        max_tokens: options.maxTokens ?? 4096,
      };

      if (systemMessage) {
        requestParams.system = systemMessage;
      }
      if (options.temperature !== undefined) {
        requestParams.temperature = options.temperature;
      }
      if (options.tools && options.tools.length > 0) {
        requestParams.tools =
          this.convertToolsToAnthropicFormat(options.tools);
      }

      // Use stream API
      const stream = this.client.messages.stream(requestParams);
      const toolCallChunks: Record<
        number,
        { id: string; function: { name: string; arguments: string } }
      > = {};

      for await (const event of stream) {
        if (event.type === "content_block_delta") {
          if (event.delta?.type === "text_delta" && event.delta.text) {
            yield {
              content: event.delta.text,
              isComplete: false,
            };
          } else if (
            event.delta?.type === "input_json_delta" &&
            event.delta.partial_json
          ) {
            const blockIndex: number = event.index;
            if (!(blockIndex in toolCallChunks)) {
              toolCallChunks[blockIndex] = {
                id: `call_${blockIndex}`,
                function: { name: "", arguments: "" },
              };
            }
            toolCallChunks[blockIndex].function.arguments +=
              event.delta.partial_json;

            yield {
              content: "",
              isComplete: false,
              toolCallChunk: { ...toolCallChunks[blockIndex] },
            };
          }
        } else if (event.type === "content_block_start") {
          if (event.content_block?.type === "tool_use") {
            const blockIndex: number = event.index;
            toolCallChunks[blockIndex] = {
              id: event.content_block.id,
              function: {
                name: event.content_block.name,
                arguments: "",
              },
            };
          }
        }
      }

      // Get final message for usage stats
      const finalMessage = await stream.finalMessage();

      const usage: Usage = {
        durationMs: 0,
        llmCalls: 1,
        tokensInput: finalMessage.usage.input_tokens,
        tokensOutput: finalMessage.usage.output_tokens,
        toolCalls: Object.keys(toolCallChunks).length,
        memoryOperations: 0,
      };

      yield {
        content: "",
        isComplete: true,
        usage,
      };
    } catch (e: unknown) {
      this.handleError(e);
    }
  }

  // -------------------------------------------------------------------------
  // Anthropic-specific message conversion
  // -------------------------------------------------------------------------

  private convertMessagesToAnthropicFormat(
    messages: Message[]
  ): Array<{ role: string; content: unknown }> {
    const apiMessages: Array<{ role: string; content: unknown }> = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        apiMessages.push({ role: "system", content: msg.content });
      } else if ("mimeType" in msg) {
        // MultiModalMessage
        const mm = msg as MultiModalMessage;
        const contentParts: Record<string, unknown>[] = [];

        if (mm.content && mm.content.trim()) {
          contentParts.push({ type: "text", text: mm.content });
        }

        if (isImage(mm) && (mm.data || mm.mediaUrl)) {
          if (mm.data) {
            const base64Data = toBase64(mm);
            contentParts.push({
              type: "image",
              source: {
                type: "base64",
                media_type: mm.mimeType,
                data: base64Data,
              },
            });
          }
          // Anthropic doesn't support image URLs directly
        }

        apiMessages.push({
          role: mm.role,
          content: contentParts.length > 0 ? contentParts : mm.content,
        });
      } else if (
        msg.role === "assistant" &&
        "toolCalls" in msg &&
        (msg as AssistantMessage).toolCalls
      ) {
        // Assistant with tool calls
        const am = msg as AssistantMessage;
        const contentBlocks: Record<string, unknown>[] = [];

        if (am.content) {
          contentBlocks.push({ type: "text", text: am.content });
        }

        for (const tc of am.toolCalls!) {
          contentBlocks.push({
            type: "tool_use",
            id: tc.callId,
            name: tc.toolName,
            input: tc.parameters,
          });
        }

        apiMessages.push({ role: "assistant", content: contentBlocks });
      } else if (msg.role === "tool" && "toolCallId" in msg) {
        // Tool response → Anthropic uses "user" role for tool results
        const tm = msg as ToolMessage;
        apiMessages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: tm.toolCallId,
              content: tm.content,
            },
          ],
        });
      } else {
        apiMessages.push({ role: msg.role, content: msg.content });
      }
    }

    return apiMessages;
  }

  /**
   * Convert OpenAI-style tool definitions to Anthropic format.
   */
  private convertToolsToAnthropicFormat(
    tools: Record<string, unknown>[]
  ): Record<string, unknown>[] {
    const anthropicTools: Record<string, unknown>[] = [];

    for (const tool of tools) {
      if (tool.type === "function") {
        const fn = tool.function as Record<string, unknown>;
        anthropicTools.push({
          name: fn.name,
          description: fn.description ?? "",
          input_schema: fn.parameters ?? {},
        });
      }
    }

    return anthropicTools;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private estimateCost(
    inputTokens: number,
    outputTokens: number
  ): number {
    const pricing: Record<string, { input: number; output: number }> = {
      "claude-3-5-sonnet": { input: 0.003 / 1000, output: 0.015 / 1000 },
      "claude-3-opus": { input: 0.015 / 1000, output: 0.075 / 1000 },
      "claude-3-sonnet": { input: 0.003 / 1000, output: 0.015 / 1000 },
      "claude-3-haiku": { input: 0.00025 / 1000, output: 0.00125 / 1000 },
    };

    let modelPricing: { input: number; output: number } | undefined;
    for (const [prefix, prices] of Object.entries(pricing)) {
      if (this.model.startsWith(prefix)) {
        modelPricing = prices;
        break;
      }
    }
    if (!modelPricing) {
      modelPricing = pricing["claude-3-sonnet"];
    }

    return (
      inputTokens * modelPricing.input + outputTokens * modelPricing.output
    );
  }

  private handleError(e: unknown): never {
    if (e instanceof BaseChatCompletionError) throw e;

    const err = e as { constructor?: { name?: string }; message?: string };
    const name = err.constructor?.name ?? "";
    const message = err.message ?? String(e);

    if (name === "AuthenticationError") {
      throw new AuthenticationError(
        `Anthropic authentication failed: ${message}`
      );
    }
    if (name === "RateLimitError") {
      throw new RateLimitError(
        `Anthropic rate limit exceeded: ${message}`
      );
    }
    if (name === "APIError") {
      throw new BaseChatCompletionError(
        `Anthropic API error: ${message}`
      );
    }
    throw new BaseChatCompletionError(`Unexpected error: ${message}`);
  }

  override toConfig(): Record<string, unknown> {
    return {
      model: this.model,
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      config: this.config,
    };
  }

  static fromConfig(
    config: Record<string, unknown>
  ): AnthropicChatCompletionClient {
    return new AnthropicChatCompletionClient({
      model: config.model as string,
      apiKey: config.apiKey as string | undefined,
      baseUrl: config.baseUrl as string | undefined,
    });
  }
}
