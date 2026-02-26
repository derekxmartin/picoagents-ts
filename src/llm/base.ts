/**
 * Abstract base class for LLM provider implementations.
 *
 * Defines the unified interface that all LLM providers must implement,
 * providing a consistent way to interact with different language models.
 */

import type { Message, AssistantMessage, MultiModalMessage, ToolMessage } from "../messages.js";
import type { ChatCompletionChunk, ChatCompletionResult } from "../types.js";
import { isImage, toBase64 } from "../messages.js";
import { ComponentBase } from "../component-config.js";

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class BaseChatCompletionError extends Error {
  statusCode?: number;
  responseData?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode?: number,
    responseData?: Record<string, unknown>
  ) {
    super(message);
    this.name = "BaseChatCompletionError";
    this.statusCode = statusCode;
    this.responseData = responseData;
  }
}

export class RateLimitError extends BaseChatCompletionError {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

export class AuthenticationError extends BaseChatCompletionError {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class InvalidRequestError extends BaseChatCompletionError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRequestError";
  }
}

// ---------------------------------------------------------------------------
// BaseChatCompletionClient
// ---------------------------------------------------------------------------

/**
 * Abstract base class for LLM provider implementations.
 *
 * Provides a unified interface for different LLM providers (OpenAI, Anthropic, etc.)
 * while abstracting away provider-specific API differences.
 */
export abstract class BaseChatCompletionClient extends ComponentBase {
  static componentType = "model_client" as const;

  model: string;
  apiKey?: string;
  config: Record<string, unknown>;

  constructor(
    model: string,
    apiKey?: string,
    config: Record<string, unknown> = {}
  ) {
    super();
    this.model = model;
    this.apiKey = apiKey;
    this.config = config;
  }

  /**
   * Make a single LLM API call.
   */
  abstract create(
    messages: Message[],
    options?: {
      tools?: Record<string, unknown>[];
      outputSchema?: Record<string, unknown>;
      temperature?: number;
      maxTokens?: number;
      [key: string]: unknown;
    }
  ): Promise<ChatCompletionResult>;

  /**
   * Make a streaming LLM API call.
   */
  abstract createStream(
    messages: Message[],
    options?: {
      tools?: Record<string, unknown>[];
      outputSchema?: Record<string, unknown>;
      temperature?: number;
      maxTokens?: number;
      [key: string]: unknown;
    }
  ): AsyncGenerator<ChatCompletionChunk, void, undefined>;

  /**
   * Convert internal Message objects to OpenAI-compatible API format.
   *
   * Helper method that subclasses can override to handle
   * provider-specific message formatting requirements.
   */
  convertMessagesToApiFormat(messages: Message[]): Record<string, unknown>[] {
    const apiMessages: Record<string, unknown>[] = [];

    for (const msg of messages) {
      let apiMsg: Record<string, unknown>;

      // Handle MultiModalMessage
      if ("mimeType" in msg) {
        const mm = msg as MultiModalMessage;
        apiMsg = { role: mm.role };

        if (mm.mimeType.startsWith("text/")) {
          apiMsg.content = mm.content;
        } else {
          const contentParts: Record<string, unknown>[] = [];

          if (mm.content && mm.content.trim()) {
            contentParts.push({ type: "text", text: mm.content });
          }

          if (isImage(mm)) {
            if (mm.data) {
              const base64Data = toBase64(mm);
              const dataUrl = `data:${mm.mimeType};base64,${base64Data}`;
              contentParts.push({
                type: "image_url",
                image_url: { url: dataUrl },
              });
            } else if (mm.mediaUrl) {
              contentParts.push({
                type: "image_url",
                image_url: { url: mm.mediaUrl },
              });
            }
          }

          apiMsg.content = contentParts;
        }
      } else {
        // Regular message
        apiMsg = { role: msg.role, content: msg.content };

        // Handle assistant messages with tool calls
        if (
          msg.role === "assistant" &&
          "toolCalls" in msg &&
          (msg as AssistantMessage).toolCalls
        ) {
          const am = msg as AssistantMessage;
          apiMsg.tool_calls = am.toolCalls!.map((tc) => ({
            id: tc.callId,
            type: "function",
            function: {
              name: tc.toolName,
              arguments:
                typeof tc.parameters === "object"
                  ? JSON.stringify(tc.parameters)
                  : tc.parameters,
            },
          }));
        }

        // Handle tool messages
        if (msg.role === "tool" && "toolCallId" in msg) {
          const tm = msg as ToolMessage;
          apiMsg.tool_call_id = tm.toolCallId;
        }
      }

      apiMessages.push(apiMsg);
    }

    return apiMessages;
  }

  /**
   * Make a JSON schema compatible with provider requirements.
   * Adds additionalProperties: false recursively.
   */
  protected makeSchemaCompatible(
    schema: Record<string, unknown>
  ): Record<string, unknown> {
    const compatible = { ...schema };

    if (compatible.type === "object") {
      compatible.additionalProperties = false;

      const properties = compatible.properties as
        | Record<string, Record<string, unknown>>
        | undefined;
      if (properties) {
        const newProps: Record<string, unknown> = {};
        for (const [propName, propSchema] of Object.entries(properties)) {
          if (typeof propSchema === "object" && propSchema !== null) {
            newProps[propName] = this.makeSchemaCompatible(propSchema);
          } else {
            newProps[propName] = propSchema;
          }
        }
        compatible.properties = newProps;
      }
    }

    if (compatible.type === "array") {
      const items = compatible.items as Record<string, unknown> | undefined;
      if (items && typeof items === "object") {
        compatible.items = this.makeSchemaCompatible(items);
      }
    }

    return compatible;
  }

  toConfig(): Record<string, unknown> {
    return {
      model: this.model,
      apiKey: this.apiKey,
      config: this.config,
    };
  }
}
