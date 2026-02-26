import { describe, it, expect } from "vitest";
import type { Message, AssistantMessage, MultiModalMessage, ToolMessage } from "../../messages.js";
import {
  BaseChatCompletionClient,
  BaseChatCompletionError,
  RateLimitError,
  AuthenticationError,
  InvalidRequestError,
} from "../base.js";
import type { ChatCompletionChunk, ChatCompletionResult } from "../../types.js";

// Concrete implementation for testing abstract class
class MockClient extends BaseChatCompletionClient {
  async create(): Promise<ChatCompletionResult> {
    return {
      message: {
        role: "assistant",
        content: "mock response",
        source: "llm",
        timestamp: new Date(),
      },
      usage: {
        durationMs: 100,
        llmCalls: 1,
        tokensInput: 10,
        tokensOutput: 5,
        toolCalls: 0,
        memoryOperations: 0,
      },
      model: this.model,
      finishReason: "stop",
    };
  }

  async *createStream(): AsyncGenerator<ChatCompletionChunk, void, undefined> {
    yield { content: "hello", isComplete: false };
    yield { content: "", isComplete: true };
  }
}

describe("BaseChatCompletionClient", () => {
  it("should store model and apiKey", () => {
    const client = new MockClient("gpt-4", "sk-test");
    expect(client.model).toBe("gpt-4");
    expect(client.apiKey).toBe("sk-test");
  });

  it("should serialize to config", () => {
    const client = new MockClient("gpt-4", "sk-test", { foo: "bar" });
    const config = client.toConfig();
    expect(config.model).toBe("gpt-4");
    expect(config.apiKey).toBe("sk-test");
    expect((config.config as Record<string, unknown>).foo).toBe("bar");
  });

  describe("convertMessagesToApiFormat", () => {
    it("should convert simple messages", () => {
      const client = new MockClient("gpt-4");
      const messages: Message[] = [
        {
          role: "system",
          content: "You are a helper",
          source: "system",
          timestamp: new Date(),
        },
        {
          role: "user",
          content: "Hello",
          source: "user",
          timestamp: new Date(),
        },
      ];

      const apiMsgs = client.convertMessagesToApiFormat(messages);
      expect(apiMsgs).toHaveLength(2);
      expect(apiMsgs[0].role).toBe("system");
      expect(apiMsgs[0].content).toBe("You are a helper");
      expect(apiMsgs[1].role).toBe("user");
    });

    it("should convert assistant messages with tool calls", () => {
      const client = new MockClient("gpt-4");
      const messages: Message[] = [
        {
          role: "assistant",
          content: "",
          source: "agent",
          timestamp: new Date(),
          toolCalls: [
            {
              toolName: "calculator",
              parameters: { expression: "2+2" },
              callId: "call_1",
            },
          ],
        } as AssistantMessage,
      ];

      const apiMsgs = client.convertMessagesToApiFormat(messages);
      expect(apiMsgs).toHaveLength(1);
      const toolCalls = apiMsgs[0].tool_calls as any[];
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].id).toBe("call_1");
      expect(toolCalls[0].type).toBe("function");
      expect(toolCalls[0].function.name).toBe("calculator");
    });

    it("should convert tool messages", () => {
      const client = new MockClient("gpt-4");
      const messages: Message[] = [
        {
          role: "tool",
          content: "4",
          source: "calculator",
          timestamp: new Date(),
          toolCallId: "call_1",
          toolName: "calculator",
          success: true,
        } as ToolMessage,
      ];

      const apiMsgs = client.convertMessagesToApiFormat(messages);
      expect(apiMsgs[0].tool_call_id).toBe("call_1");
    });

    it("should convert multimodal image messages with base64 data", () => {
      const client = new MockClient("gpt-4");
      const messages: Message[] = [
        {
          role: "user",
          content: "What's in this image?",
          source: "user",
          timestamp: new Date(),
          mimeType: "image/png",
          data: "iVBORw0KGgo=",
          metadata: {},
        } as unknown as MultiModalMessage,
      ];

      const apiMsgs = client.convertMessagesToApiFormat(messages);
      expect(apiMsgs).toHaveLength(1);
      const content = apiMsgs[0].content as any[];
      expect(content).toHaveLength(2);
      expect(content[0].type).toBe("text");
      expect(content[1].type).toBe("image_url");
      expect(content[1].image_url.url).toContain("data:image/png;base64,");
    });
  });

  describe("makeSchemaCompatible", () => {
    it("should add additionalProperties: false to objects", () => {
      const client = new MockClient("gpt-4");
      // Access protected method via any cast
      const result = (client as any).makeSchemaCompatible({
        type: "object",
        properties: {
          name: { type: "string" },
          address: {
            type: "object",
            properties: { city: { type: "string" } },
          },
        },
      });

      expect(result.additionalProperties).toBe(false);
      expect(
        (result.properties as any).address.additionalProperties
      ).toBe(false);
    });

    it("should handle arrays with object items", () => {
      const client = new MockClient("gpt-4");
      const result = (client as any).makeSchemaCompatible({
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "number" } },
        },
      });

      expect((result.items as any).additionalProperties).toBe(false);
    });
  });
});

describe("Error classes", () => {
  it("BaseChatCompletionError stores status code and data", () => {
    const err = new BaseChatCompletionError("fail", 500, { key: "val" });
    expect(err.message).toBe("fail");
    expect(err.statusCode).toBe(500);
    expect(err.responseData?.key).toBe("val");
    expect(err.name).toBe("BaseChatCompletionError");
  });

  it("RateLimitError is a BaseChatCompletionError", () => {
    const err = new RateLimitError("too many requests");
    expect(err).toBeInstanceOf(BaseChatCompletionError);
    expect(err.name).toBe("RateLimitError");
  });

  it("AuthenticationError is a BaseChatCompletionError", () => {
    const err = new AuthenticationError("bad key");
    expect(err).toBeInstanceOf(BaseChatCompletionError);
    expect(err.name).toBe("AuthenticationError");
  });

  it("InvalidRequestError is a BaseChatCompletionError", () => {
    const err = new InvalidRequestError("bad request");
    expect(err).toBeInstanceOf(BaseChatCompletionError);
    expect(err.name).toBe("InvalidRequestError");
  });
});
