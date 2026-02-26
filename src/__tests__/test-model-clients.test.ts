/**
 * Tests for model client implementations.
 *
 * This module tests various LLM client implementations including:
 * - OpenAI
 * - Anthropic
 */

import { describe, it, expect } from "vitest";
import { BaseChatCompletionClient } from "../llm/base.js";
import { OpenAIChatCompletionClient } from "../llm/openai.js";
import { AnthropicChatCompletionClient } from "../llm/anthropic.js";
import type { Message } from "../messages.js";
import type { ChatCompletionResult, Usage } from "../types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function createMessages(): Message[] {
  return [
    {
      role: "system" as const,
      content: "You are a helpful assistant",
      source: "system",
      timestamp: new Date(),
    },
    {
      role: "user" as const,
      content: "Hello, how are you?",
      source: "user",
      timestamp: new Date(),
    },
  ];
}

function createTools(): Record<string, unknown>[] {
  return [
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get weather for a location",
        parameters: {
          type: "object",
          properties: {
            location: { type: "string" },
          },
          required: ["location"],
        },
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ModelClients", () => {
  describe("client inheritance", () => {
    it("OpenAIChatCompletionClient extends BaseChatCompletionClient", () => {
      const client = new OpenAIChatCompletionClient({ apiKey: "test" });
      expect(client).toBeInstanceOf(BaseChatCompletionClient);
    });

    it("AnthropicChatCompletionClient extends BaseChatCompletionClient", () => {
      const client = new AnthropicChatCompletionClient({ apiKey: "test" });
      expect(client).toBeInstanceOf(BaseChatCompletionClient);
    });
  });

  describe("client initialization", () => {
    it("initializes OpenAI client with model and api key", () => {
      const client = new OpenAIChatCompletionClient({
        model: "gpt-4",
        apiKey: "test-key",
      });
      expect(client.model).toBe("gpt-4");
      expect(client.apiKey).toBe("test-key");
    });

    it("initializes OpenAI client with default model", () => {
      const client = new OpenAIChatCompletionClient({ apiKey: "test-key" });
      expect(client.model).toBe("gpt-4.1-mini");
    });

    it("initializes Anthropic client with model and api key", () => {
      const client = new AnthropicChatCompletionClient({
        model: "claude-3-5-sonnet-20241022",
        apiKey: "test-key",
      });
      expect(client.model).toBe("claude-3-5-sonnet-20241022");
      expect(client.apiKey).toBe("test-key");
    });

    it("initializes Anthropic client with default model", () => {
      const client = new AnthropicChatCompletionClient({ apiKey: "test-key" });
      expect(client.model).toBe("claude-sonnet-4-5");
    });
  });

  describe("component types", () => {
    it("OpenAI client has correct component type", () => {
      expect(OpenAIChatCompletionClient.componentType).toBe("model_client");
    });

    it("Anthropic client has correct component type", () => {
      expect(AnthropicChatCompletionClient.componentType).toBe("model_client");
    });
  });

  describe("OpenAI message conversion", () => {
    it("converts basic system and user messages", () => {
      const client = new OpenAIChatCompletionClient({ apiKey: "test" });
      const messages = createMessages();

      const converted = client.convertMessagesToApiFormat(messages);

      expect(converted).toHaveLength(2);
      expect(converted[0].role).toBe("system");
      expect(converted[0].content).toBe("You are a helpful assistant");
      expect(converted[1].role).toBe("user");
      expect(converted[1].content).toBe("Hello, how are you?");
    });

    it("converts messages with tool calls", () => {
      const client = new OpenAIChatCompletionClient({ apiKey: "test" });
      const messages = createMessages();

      const messagesWithTools: Message[] = [
        ...messages,
        {
          role: "assistant" as const,
          content: "I'll check the weather",
          source: "assistant",
          timestamp: new Date(),
          toolCalls: [
            {
              toolName: "get_weather",
              parameters: { location: "Paris" },
              callId: "call_123",
            },
          ],
        },
        {
          role: "tool" as const,
          content: "It's sunny in Paris",
          toolCallId: "call_123",
          toolName: "get_weather",
          success: true,
          source: "tool",
          timestamp: new Date(),
        },
      ];

      const converted = client.convertMessagesToApiFormat(messagesWithTools);

      expect(converted).toHaveLength(4);

      // Assistant message with tool calls
      expect(converted[2].role).toBe("assistant");
      expect(converted[2].tool_calls).toBeDefined();
      const toolCalls = converted[2].tool_calls as Array<Record<string, unknown>>;
      expect(toolCalls).toHaveLength(1);
      expect((toolCalls[0] as any).id).toBe("call_123");
      expect((toolCalls[0] as any).type).toBe("function");
      expect((toolCalls[0] as any).function.name).toBe("get_weather");
      expect((toolCalls[0] as any).function.arguments).toBe(
        JSON.stringify({ location: "Paris" })
      );

      // Tool message
      expect(converted[3].role).toBe("tool");
      expect(converted[3].tool_call_id).toBe("call_123");
    });
  });

  describe("Anthropic message conversion", () => {
    it("converts basic system and user messages", () => {
      const client = new AnthropicChatCompletionClient({ apiKey: "test" });
      const messages = createMessages();

      // Access private method via cast
      const converted = (client as any).convertMessagesToAnthropicFormat(
        messages
      ) as Array<{ role: string; content: unknown }>;

      expect(converted).toHaveLength(2);
      expect(converted[0].role).toBe("system");
      expect(converted[1].role).toBe("user");
    });

    it("converts messages with tool calls to Anthropic content blocks", () => {
      const client = new AnthropicChatCompletionClient({ apiKey: "test" });
      const messages = createMessages();

      const messagesWithTools: Message[] = [
        ...messages,
        {
          role: "assistant" as const,
          content: "I'll check the weather",
          source: "assistant",
          timestamp: new Date(),
          toolCalls: [
            {
              toolName: "get_weather",
              parameters: { location: "Paris" },
              callId: "call_123",
            },
          ],
        },
      ];

      const converted = (client as any).convertMessagesToAnthropicFormat(
        messagesWithTools
      ) as Array<{ role: string; content: unknown }>;

      expect(converted).toHaveLength(3);

      // Anthropic uses content blocks for tool calls
      const assistantContent = converted[2].content;
      expect(Array.isArray(assistantContent)).toBe(true);
      const blocks = assistantContent as Array<Record<string, unknown>>;
      expect(blocks.some((block) => block.type === "tool_use")).toBe(true);

      const toolUseBlock = blocks.find((block) => block.type === "tool_use");
      expect(toolUseBlock).toBeDefined();
      expect(toolUseBlock!.name).toBe("get_weather");
      expect(toolUseBlock!.id).toBe("call_123");
      expect(toolUseBlock!.input).toEqual({ location: "Paris" });
    });

    it("converts tool responses to user role with tool_result", () => {
      const client = new AnthropicChatCompletionClient({ apiKey: "test" });

      const messages: Message[] = [
        {
          role: "user" as const,
          content: "What is the weather?",
          source: "user",
          timestamp: new Date(),
        },
        {
          role: "assistant" as const,
          content: "",
          source: "assistant",
          timestamp: new Date(),
          toolCalls: [
            {
              toolName: "get_weather",
              parameters: { location: "Paris" },
              callId: "call_456",
            },
          ],
        },
        {
          role: "tool" as const,
          content: "Sunny, 25C",
          toolCallId: "call_456",
          toolName: "get_weather",
          success: true,
          source: "tool",
          timestamp: new Date(),
        },
      ];

      const converted = (client as any).convertMessagesToAnthropicFormat(
        messages
      ) as Array<{ role: string; content: unknown }>;

      expect(converted).toHaveLength(3);

      // Tool response should be converted to user role with tool_result
      const toolResultMsg = converted[2];
      expect(toolResultMsg.role).toBe("user");
      const content = toolResultMsg.content as Array<Record<string, unknown>>;
      expect(Array.isArray(content)).toBe(true);
      expect(content[0].type).toBe("tool_result");
      expect(content[0].tool_use_id).toBe("call_456");
      expect(content[0].content).toBe("Sunny, 25C");
    });
  });

  describe("Anthropic tool conversion", () => {
    it("converts OpenAI-style tools to Anthropic format", () => {
      const client = new AnthropicChatCompletionClient({ apiKey: "test" });
      const tools = createTools();

      // Access private method via cast
      const converted = (client as any).convertToolsToAnthropicFormat(
        tools
      ) as Array<Record<string, unknown>>;

      expect(converted).toHaveLength(1);
      expect(converted[0].name).toBe("get_weather");
      expect(converted[0].description).toBe("Get weather for a location");
      expect(converted[0].input_schema).toBeDefined();

      const inputSchema = converted[0].input_schema as Record<string, unknown>;
      const properties = inputSchema.properties as Record<
        string,
        Record<string, unknown>
      >;
      expect(properties.location.type).toBe("string");
    });
  });

  describe("serialization", () => {
    it("serializes OpenAI client to config", () => {
      const client = new OpenAIChatCompletionClient({
        model: "gpt-4",
        apiKey: "test-key",
      });
      const config = client.toConfig();
      expect(config.model).toBe("gpt-4");
      expect(config.apiKey).toBe("test-key");
    });

    it("serializes Anthropic client to config", () => {
      const client = new AnthropicChatCompletionClient({
        model: "claude-3-5-sonnet-20241022",
        apiKey: "test-key",
      });
      const config = client.toConfig();
      expect(config.model).toBe("claude-3-5-sonnet-20241022");
      expect(config.apiKey).toBe("test-key");
    });

    it("deserializes OpenAI client from config", () => {
      const client = new OpenAIChatCompletionClient({
        model: "gpt-4",
        apiKey: "test-key",
      });
      const config = client.toConfig();
      const restored = OpenAIChatCompletionClient.fromConfig(config);
      expect(restored.model).toBe("gpt-4");
      expect(restored.apiKey).toBe("test-key");
    });

    it("deserializes Anthropic client from config", () => {
      const client = new AnthropicChatCompletionClient({
        model: "claude-3-5-sonnet-20241022",
        apiKey: "test-key",
      });
      const config = client.toConfig();
      const restored = AnthropicChatCompletionClient.fromConfig(config);
      expect(restored.model).toBe("claude-3-5-sonnet-20241022");
      expect(restored.apiKey).toBe("test-key");
    });
  });

  describe("streaming interface", () => {
    it("OpenAI client has createStream method", () => {
      const client = new OpenAIChatCompletionClient({ apiKey: "test" });
      expect(typeof client.createStream).toBe("function");
    });

    it("Anthropic client has createStream method", () => {
      const client = new AnthropicChatCompletionClient({ apiKey: "test" });
      expect(typeof client.createStream).toBe("function");
    });
  });
});
