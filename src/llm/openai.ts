/**
 * OpenAI LLM client implementation.
 *
 * Provides integration with OpenAI's API using the official openai npm package.
 */

import type { Message, AssistantMessage } from "../messages.js";
import type { ChatCompletionChunk, ChatCompletionResult, Usage } from "../types.js";
import {
  BaseChatCompletionClient,
  BaseChatCompletionError,
  AuthenticationError,
  RateLimitError,
} from "./base.js";

// ---------------------------------------------------------------------------
// OpenAIChatCompletionClient
// ---------------------------------------------------------------------------

/**
 * OpenAI implementation of BaseChatCompletionClient.
 *
 * Supports GPT-4, GPT-3.5-turbo, and other OpenAI models with
 * function calling capabilities.
 */
export class OpenAIChatCompletionClient extends BaseChatCompletionClient {
  static override componentType = "model_client" as const;
  static override componentVersion = 1;
  static componentProviderOverride =
    "picoagents/llm/OpenAIChatCompletionClient";

  private client: any; // OpenAI client (lazily initialised)
  private clientPromise: Promise<any> | null = null;
  private baseUrl?: string;
  private organization?: string;

  constructor(options: {
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    organization?: string;
    [key: string]: unknown;
  } = {}) {
    const {
      model = "gpt-4.1-mini",
      apiKey,
      baseUrl,
      organization,
      ...rest
    } = options;
    super(model, apiKey, rest);
    this.baseUrl = baseUrl;
    this.organization = organization;
  }

  /**
   * Lazily import and instantiate the OpenAI SDK client.
   * Uses dynamic import() so the module works in both CJS and ESM.
   */
  private async ensureClient(): Promise<any> {
    if (this.client) return this.client;
    if (!this.clientPromise) {
      this.clientPromise = import("openai").then((mod) => {
        const OpenAI = mod.default ?? mod;
        this.client = new OpenAI({
          apiKey: this.apiKey,
          baseURL: this.baseUrl,
          organization: this.organization,
        });
        return this.client;
      });
    }
    return this.clientPromise;
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
      await this.ensureClient();
      const startTime = Date.now();

      const apiMessages = this.convertMessagesToApiFormat(messages);

      const requestParams: Record<string, unknown> = {
        model: this.model,
        messages: apiMessages,
      };

      // Temperature
      if (options.temperature !== undefined) {
        requestParams.temperature = options.temperature;
      }

      // Max tokens
      if (options.maxTokens !== undefined) {
        requestParams.max_tokens = options.maxTokens;
      }

      // Tools
      if (options.tools && options.tools.length > 0) {
        requestParams.tools = options.tools;
        requestParams.tool_choice = "auto";
      }

      // Structured output
      if (options.outputSchema) {
        const schema = this.makeSchemaCompatible(options.outputSchema);
        requestParams.response_format = {
          type: "json_schema",
          json_schema: {
            name: (schema.title as string) ?? "StructuredOutput",
            description:
              (schema.description as string) ?? "Structured output",
            strict: true,
            schema,
          },
        };
      }

      // Make API call
      const response = await (this.client as any).chat.completions.create(
        requestParams
      );

      const durationMs = Date.now() - startTime;
      const choice = response.choices[0];
      const assistantContent = choice.message.content || "";

      // Handle tool calls
      const toolCalls: Array<{
        toolName: string;
        parameters: Record<string, unknown>;
        callId: string;
      }> = [];

      if (choice.message.tool_calls) {
        for (const tc of choice.message.tool_calls) {
          if (tc.type === "function") {
            toolCalls.push({
              toolName: tc.function.name,
              parameters: tc.function.arguments
                ? JSON.parse(tc.function.arguments)
                : {},
              callId: tc.id,
            });
          }
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
          // If parsing fails, continue without structured output
        }
      }

      // Usage stats
      const usageData = response.usage;
      const usage: Usage = {
        durationMs,
        llmCalls: 1,
        tokensInput: usageData?.prompt_tokens ?? 0,
        tokensOutput: usageData?.completion_tokens ?? 0,
        toolCalls: toolCalls.length,
        memoryOperations: 0,
        costEstimate: usageData
          ? this.estimateCost(
              usageData.prompt_tokens,
              usageData.completion_tokens
            )
          : undefined,
      };

      return {
        message: assistantMessage,
        usage,
        model: response.model,
        finishReason: choice.finish_reason || "stop",
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
      await this.ensureClient();

      const apiMessages = this.convertMessagesToApiFormat(messages);

      const requestParams: Record<string, unknown> = {
        model: this.model,
        messages: apiMessages,
        stream: true,
        stream_options: { include_usage: true },
      };

      if (options.temperature !== undefined) {
        requestParams.temperature = options.temperature;
      }
      if (options.maxTokens !== undefined) {
        requestParams.max_tokens = options.maxTokens;
      }
      if (options.tools && options.tools.length > 0) {
        requestParams.tools = options.tools;
        requestParams.tool_choice = "auto";
      }

      const stream = await (this.client as any).chat.completions.create(
        requestParams
      );

      const toolCallChunks: Record<
        string | number,
        {
          id: string;
          function: { name: string; arguments: string };
        }
      > = {};

      for await (const chunk of stream) {
        // Handle usage-only chunk (final)
        if (
          chunk.usage &&
          (!chunk.choices || chunk.choices.length === 0)
        ) {
          const usage: Usage = {
            durationMs: 0,
            llmCalls: 1,
            tokensInput: chunk.usage.prompt_tokens,
            tokensOutput: chunk.usage.completion_tokens,
            toolCalls: 0,
            memoryOperations: 0,
          };
          yield {
            content: "",
            isComplete: true,
            toolCallChunk: undefined,
            usage,
          };
          break;
        }

        if (!chunk.choices || chunk.choices.length === 0) continue;

        const chunkChoice = chunk.choices[0];
        const delta = chunkChoice.delta;

        // Content chunks
        if (delta?.content) {
          yield {
            content: delta.content,
            isComplete: false,
          };
        }

        // Tool call chunks
        if (delta?.tool_calls) {
          for (const tcDelta of delta.tool_calls) {
            const index = tcDelta.index ?? tcDelta.id;
            const callId = tcDelta.id;

            if (!(index in toolCallChunks)) {
              toolCallChunks[index] = {
                id: callId ?? "",
                function: { name: "", arguments: "" },
              };
            }

            if (callId) {
              toolCallChunks[index].id = callId;
            }

            if (tcDelta.function?.name) {
              toolCallChunks[index].function.name = tcDelta.function.name;
            }
            if (tcDelta.function?.arguments) {
              toolCallChunks[index].function.arguments +=
                tcDelta.function.arguments;
            }

            yield {
              content: "",
              isComplete: false,
              toolCallChunk: { ...toolCallChunks[index] },
            };
          }
        }

        // Finish reason — wait for usage chunk
        if (chunkChoice.finish_reason) {
          continue;
        }
      }
    } catch (e: unknown) {
      this.handleError(e);
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private estimateCost(
    inputTokens: number,
    outputTokens: number
  ): number {
    const pricing: Record<string, { input: number; output: number }> = {
      "gpt-4": { input: 0.03 / 1000, output: 0.06 / 1000 },
      "gpt-4-turbo": { input: 0.01 / 1000, output: 0.03 / 1000 },
      "gpt-3.5-turbo": { input: 0.0005 / 1000, output: 0.0015 / 1000 },
    };

    const modelPricing = pricing[this.model] ?? pricing["gpt-4"];
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
      throw new AuthenticationError(`OpenAI authentication failed: ${message}`);
    }
    if (name === "RateLimitError") {
      throw new RateLimitError(`OpenAI rate limit exceeded: ${message}`);
    }
    if (name === "APIError") {
      throw new BaseChatCompletionError(`OpenAI API error: ${message}`);
    }
    throw new BaseChatCompletionError(`Unexpected error: ${message}`);
  }

  override toConfig(): Record<string, unknown> {
    return {
      model: this.model,
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      organization: this.organization,
      config: this.config,
    };
  }

  static fromConfig(config: Record<string, unknown>): OpenAIChatCompletionClient {
    return new OpenAIChatCompletionClient({
      model: config.model as string,
      apiKey: config.apiKey as string | undefined,
      baseUrl: config.baseUrl as string | undefined,
      organization: config.organization as string | undefined,
    });
  }
}
