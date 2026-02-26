/**
 * Comprehensive tests for AnthropicChatCompletionClient.
 *
 * Tests cover:
 * - Client initialization & configuration
 * - Message conversion (system, user, assistant, tool, multimodal)
 * - Tool conversion (OpenAI -> Anthropic format)
 * - API call mocking (create, createStream)
 * - Structured output handling
 * - Cost estimation
 * - Error handling (auth, rate limit, API errors)
 * - Serialization / deserialization
 * - Schema compatibility (additionalProperties injection)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Message, AssistantMessage, ToolMessage, MultiModalMessage } from "../messages.js";
import {
  BaseChatCompletionClient,
  BaseChatCompletionError,
  AuthenticationError,
  RateLimitError,
} from "../llm/base.js";
import { AnthropicChatCompletionClient } from "../llm/anthropic.js";

// ---------------------------------------------------------------------------
// Helpers — mock the internal `this.client` after construction
// ---------------------------------------------------------------------------

const mockCreate = vi.fn();
const mockBetaCreate = vi.fn();
const mockStream = vi.fn();

/**
 * Create a client and replace its internal Anthropic SDK client with mocks.
 */
function makeClient(opts: Record<string, unknown> = {}): AnthropicChatCompletionClient {
  const client = new AnthropicChatCompletionClient({ apiKey: "test-key", ...opts });
  // Replace the real Anthropic client with our mock object
  (client as any).client = {
    messages: { create: mockCreate, stream: mockStream },
    beta: { messages: { create: mockBetaCreate } },
  };
  return client;
}

function basicMessages(): Message[] {
  return [
    { role: "system", content: "You are helpful.", source: "system", timestamp: new Date() },
    { role: "user", content: "Hi", source: "user", timestamp: new Date() },
  ];
}

function anthropicResponse(overrides: Record<string, unknown> = {}) {
  return {
    content: [{ type: "text", text: "Hello back!" }],
    model: "claude-sonnet-4-5",
    stop_reason: "end_turn",
    usage: { input_tokens: 20, output_tokens: 10 },
    ...overrides,
  };
}

function toolUseResponse() {
  return anthropicResponse({
    content: [
      { type: "text", text: "Let me check." },
      {
        type: "tool_use",
        id: "toolu_01",
        name: "get_weather",
        input: { location: "Paris" },
      },
    ],
    stop_reason: "tool_use",
  });
}

function makeStreamMock(events: any[], finalUsage = { input_tokens: 15, output_tokens: 8 }) {
  const asyncIterator = {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < events.length) return { done: false, value: events[i++] };
          return { done: true, value: undefined };
        },
      };
    },
    finalMessage: vi.fn().mockResolvedValue({ usage: finalUsage }),
  };
  return asyncIterator;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AnthropicChatCompletionClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // Initialization
  // =========================================================================

  describe("initialization", () => {
    it("extends BaseChatCompletionClient", () => {
      const client = makeClient();
      expect(client).toBeInstanceOf(BaseChatCompletionClient);
    });

    it("uses default model when none provided", () => {
      const client = makeClient();
      expect(client.model).toBe("claude-sonnet-4-5");
    });

    it("accepts a custom model", () => {
      const client = makeClient({ model: "claude-3-opus-20240229" });
      expect(client.model).toBe("claude-3-opus-20240229");
    });

    it("stores the api key", () => {
      const client = makeClient({ apiKey: "sk-ant-123" });
      expect(client.apiKey).toBe("sk-ant-123");
    });

    it("has correct component type", () => {
      expect(AnthropicChatCompletionClient.componentType).toBe("model_client");
    });

    it("has correct component version", () => {
      expect(AnthropicChatCompletionClient.componentVersion).toBe(1);
    });

    it("has correct component provider override", () => {
      expect(AnthropicChatCompletionClient.componentProviderOverride).toBe(
        "picoagents/llm/AnthropicChatCompletionClient"
      );
    });
  });

  // =========================================================================
  // Message conversion
  // =========================================================================

  describe("message conversion", () => {
    it("converts system message", () => {
      const client = makeClient();
      const msgs: Message[] = [
        { role: "system", content: "Be brief.", source: "system", timestamp: new Date() },
      ];
      const converted = (client as any).convertMessagesToAnthropicFormat(msgs);
      expect(converted).toHaveLength(1);
      expect(converted[0]).toEqual({ role: "system", content: "Be brief." });
    });

    it("converts basic user message", () => {
      const client = makeClient();
      const msgs: Message[] = [
        { role: "user", content: "Hello", source: "user", timestamp: new Date() },
      ];
      const converted = (client as any).convertMessagesToAnthropicFormat(msgs);
      expect(converted).toHaveLength(1);
      expect(converted[0]).toEqual({ role: "user", content: "Hello" });
    });

    it("converts basic assistant message (no tool calls)", () => {
      const client = makeClient();
      const msgs: Message[] = [
        { role: "assistant", content: "Hi there!", source: "llm", timestamp: new Date() },
      ];
      const converted = (client as any).convertMessagesToAnthropicFormat(msgs);
      expect(converted).toHaveLength(1);
      expect(converted[0]).toEqual({ role: "assistant", content: "Hi there!" });
    });

    it("converts assistant message with tool calls to content blocks", () => {
      const client = makeClient();
      const msgs: Message[] = [
        {
          role: "assistant",
          content: "Calling tool",
          source: "llm",
          timestamp: new Date(),
          toolCalls: [
            { toolName: "search", parameters: { q: "test" }, callId: "call_1" },
            { toolName: "lookup", parameters: { id: 42 }, callId: "call_2" },
          ],
        } as AssistantMessage,
      ];
      const converted = (client as any).convertMessagesToAnthropicFormat(msgs);
      expect(converted).toHaveLength(1);

      const blocks = converted[0].content as any[];
      expect(blocks).toHaveLength(3); // text + 2 tool_use
      expect(blocks[0]).toEqual({ type: "text", text: "Calling tool" });
      expect(blocks[1]).toEqual({
        type: "tool_use", id: "call_1", name: "search", input: { q: "test" },
      });
      expect(blocks[2]).toEqual({
        type: "tool_use", id: "call_2", name: "lookup", input: { id: 42 },
      });
    });

    it("converts assistant message with tool calls and no text content", () => {
      const client = makeClient();
      const msgs: Message[] = [
        {
          role: "assistant",
          content: "",
          source: "llm",
          timestamp: new Date(),
          toolCalls: [
            { toolName: "get_weather", parameters: { city: "NYC" }, callId: "call_99" },
          ],
        } as AssistantMessage,
      ];
      const converted = (client as any).convertMessagesToAnthropicFormat(msgs);
      const blocks = converted[0].content as any[];
      // Empty content should NOT produce a text block
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe("tool_use");
    });

    it("converts tool result message to user role with tool_result content", () => {
      const client = makeClient();
      const msgs: Message[] = [
        {
          role: "tool",
          content: "Sunny, 25C",
          toolCallId: "call_99",
          toolName: "get_weather",
          success: true,
          source: "tool",
          timestamp: new Date(),
        } as ToolMessage,
      ];
      const converted = (client as any).convertMessagesToAnthropicFormat(msgs);
      expect(converted).toHaveLength(1);
      expect(converted[0].role).toBe("user");
      const content = converted[0].content as any[];
      expect(content).toHaveLength(1);
      expect(content[0]).toEqual({
        type: "tool_result",
        tool_use_id: "call_99",
        content: "Sunny, 25C",
      });
    });

    it("converts multimodal image message with base64 data", () => {
      const client = makeClient();
      const imageData = Buffer.from("fake-png-bytes");
      const msgs: Message[] = [
        {
          role: "user",
          content: "What is this?",
          source: "user",
          timestamp: new Date(),
          mimeType: "image/png",
          data: imageData,
          metadata: {},
        } as unknown as MultiModalMessage,
      ];
      const converted = (client as any).convertMessagesToAnthropicFormat(msgs);
      expect(converted).toHaveLength(1);
      expect(converted[0].role).toBe("user");

      const parts = converted[0].content as any[];
      expect(parts).toHaveLength(2);
      expect(parts[0]).toEqual({ type: "text", text: "What is this?" });
      expect(parts[1].type).toBe("image");
      expect(parts[1].source.type).toBe("base64");
      expect(parts[1].source.media_type).toBe("image/png");
      expect(typeof parts[1].source.data).toBe("string"); // base64 string
    });

    it("converts multimodal message with empty text content", () => {
      const client = makeClient();
      const msgs: Message[] = [
        {
          role: "user",
          content: "",
          source: "user",
          timestamp: new Date(),
          mimeType: "image/jpeg",
          data: Buffer.from("jpeg-bytes"),
          metadata: {},
        } as unknown as MultiModalMessage,
      ];
      const converted = (client as any).convertMessagesToAnthropicFormat(msgs);
      const parts = converted[0].content as any[];
      // Only image, no text block for empty content
      expect(parts).toHaveLength(1);
      expect(parts[0].type).toBe("image");
    });

    it("preserves order of multiple messages", () => {
      const client = makeClient();
      const msgs = basicMessages();
      const converted = (client as any).convertMessagesToAnthropicFormat(msgs);
      expect(converted).toHaveLength(2);
      expect(converted[0].role).toBe("system");
      expect(converted[1].role).toBe("user");
    });

    it("handles a complete conversation flow", () => {
      const client = makeClient();
      const msgs: Message[] = [
        { role: "system", content: "You are a weather assistant.", source: "system", timestamp: new Date() },
        { role: "user", content: "What's the weather?", source: "user", timestamp: new Date() },
        {
          role: "assistant", content: "", source: "llm", timestamp: new Date(),
          toolCalls: [{ toolName: "get_weather", parameters: { city: "London" }, callId: "c1" }],
        } as AssistantMessage,
        {
          role: "tool", content: "Rainy, 12C", toolCallId: "c1",
          toolName: "get_weather", success: true, source: "tool", timestamp: new Date(),
        } as ToolMessage,
        { role: "assistant", content: "It's rainy in London at 12C.", source: "llm", timestamp: new Date() },
      ];
      const converted = (client as any).convertMessagesToAnthropicFormat(msgs);
      expect(converted).toHaveLength(5);
      expect(converted[0].role).toBe("system");
      expect(converted[1].role).toBe("user");
      expect(converted[2].role).toBe("assistant");
      expect(converted[3].role).toBe("user"); // tool_result -> user
      expect(converted[4].role).toBe("assistant");
    });
  });

  // =========================================================================
  // Tool conversion
  // =========================================================================

  describe("tool conversion", () => {
    it("converts OpenAI-format tools to Anthropic format", () => {
      const client = makeClient();
      const tools = [
        {
          type: "function",
          function: {
            name: "search",
            description: "Search the web",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
            },
          },
        },
      ];
      const converted = (client as any).convertToolsToAnthropicFormat(tools);
      expect(converted).toHaveLength(1);
      expect(converted[0]).toEqual({
        name: "search",
        description: "Search the web",
        input_schema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      });
    });

    it("converts multiple tools", () => {
      const client = makeClient();
      const tools = [
        { type: "function", function: { name: "a", description: "A tool", parameters: {} } },
        { type: "function", function: { name: "b", description: "B tool", parameters: {} } },
      ];
      const converted = (client as any).convertToolsToAnthropicFormat(tools);
      expect(converted).toHaveLength(2);
      expect(converted[0].name).toBe("a");
      expect(converted[1].name).toBe("b");
    });

    it("skips non-function tool types", () => {
      const client = makeClient();
      const tools = [
        { type: "retrieval", function: { name: "x" } },
        { type: "function", function: { name: "y", description: "Y", parameters: {} } },
      ];
      const converted = (client as any).convertToolsToAnthropicFormat(tools);
      expect(converted).toHaveLength(1);
      expect(converted[0].name).toBe("y");
    });

    it("uses empty string for missing description", () => {
      const client = makeClient();
      const tools = [
        { type: "function", function: { name: "t", parameters: {} } },
      ];
      const converted = (client as any).convertToolsToAnthropicFormat(tools);
      expect(converted[0].description).toBe("");
    });

    it("uses empty object for missing parameters", () => {
      const client = makeClient();
      const tools = [
        { type: "function", function: { name: "t", description: "d" } },
      ];
      const converted = (client as any).convertToolsToAnthropicFormat(tools);
      expect(converted[0].input_schema).toEqual({});
    });
  });

  // =========================================================================
  // create() — mocked API calls
  // =========================================================================

  describe("create()", () => {
    it("returns a ChatCompletionResult for a basic call", async () => {
      const client = makeClient();
      mockCreate.mockResolvedValueOnce(anthropicResponse());

      const result = await client.create(basicMessages());

      expect(result.message.role).toBe("assistant");
      expect(result.message.content).toBe("Hello back!");
      expect(result.message.source).toBe("llm");
      expect(result.model).toBe("claude-sonnet-4-5");
      expect(result.finishReason).toBe("end_turn");
      expect(result.usage.llmCalls).toBe(1);
      expect(result.usage.tokensInput).toBe(20);
      expect(result.usage.tokensOutput).toBe(10);
    });

    it("extracts system message into separate parameter", async () => {
      const client = makeClient();
      mockCreate.mockResolvedValueOnce(anthropicResponse());

      await client.create(basicMessages());

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.system).toBe("You are helpful.");
      // Messages should not include the system message
      expect(callArgs.messages[0].role).toBe("user");
    });

    it("passes max_tokens defaulting to 4096", async () => {
      const client = makeClient();
      mockCreate.mockResolvedValueOnce(anthropicResponse());

      await client.create(basicMessages());

      expect(mockCreate.mock.calls[0][0].max_tokens).toBe(4096);
    });

    it("passes custom maxTokens", async () => {
      const client = makeClient();
      mockCreate.mockResolvedValueOnce(anthropicResponse());

      await client.create(basicMessages(), { maxTokens: 1024 });

      expect(mockCreate.mock.calls[0][0].max_tokens).toBe(1024);
    });

    it("passes temperature when provided", async () => {
      const client = makeClient();
      mockCreate.mockResolvedValueOnce(anthropicResponse());

      await client.create(basicMessages(), { temperature: 0.5 });

      expect(mockCreate.mock.calls[0][0].temperature).toBe(0.5);
    });

    it("does not include temperature when not provided", async () => {
      const client = makeClient();
      mockCreate.mockResolvedValueOnce(anthropicResponse());

      await client.create(basicMessages());

      expect(mockCreate.mock.calls[0][0].temperature).toBeUndefined();
    });

    it("converts and passes tools", async () => {
      const client = makeClient();
      mockCreate.mockResolvedValueOnce(anthropicResponse());
      const tools = [
        {
          type: "function",
          function: {
            name: "search",
            description: "Search",
            parameters: { type: "object", properties: {} },
          },
        },
      ];

      await client.create(basicMessages(), { tools });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.tools).toHaveLength(1);
      expect(callArgs.tools[0].name).toBe("search");
      expect(callArgs.tools[0].input_schema).toBeDefined();
    });

    it("does not pass tools when array is empty", async () => {
      const client = makeClient();
      mockCreate.mockResolvedValueOnce(anthropicResponse());

      await client.create(basicMessages(), { tools: [] });

      expect(mockCreate.mock.calls[0][0].tools).toBeUndefined();
    });

    it("extracts tool calls from response", async () => {
      const client = makeClient();
      mockCreate.mockResolvedValueOnce(toolUseResponse());

      const result = await client.create(basicMessages());

      expect(result.message.content).toBe("Let me check.");
      expect(result.message.toolCalls).toHaveLength(1);
      expect(result.message.toolCalls![0]).toEqual({
        toolName: "get_weather",
        parameters: { location: "Paris" },
        callId: "toolu_01",
      });
      expect(result.usage.toolCalls).toBe(1);
    });

    it("sets toolCalls to undefined when there are none", async () => {
      const client = makeClient();
      mockCreate.mockResolvedValueOnce(anthropicResponse());

      const result = await client.create(basicMessages());

      expect(result.message.toolCalls).toBeUndefined();
    });

    it("handles multiple tool calls in one response", async () => {
      const client = makeClient();
      mockCreate.mockResolvedValueOnce(
        anthropicResponse({
          content: [
            { type: "tool_use", id: "t1", name: "a", input: { x: 1 } },
            { type: "tool_use", id: "t2", name: "b", input: { y: 2 } },
          ],
        })
      );

      const result = await client.create(basicMessages());

      expect(result.message.toolCalls).toHaveLength(2);
      expect(result.message.toolCalls![0].callId).toBe("t1");
      expect(result.message.toolCalls![1].callId).toBe("t2");
      expect(result.usage.toolCalls).toBe(2);
    });

    it("calculates cost estimate in usage", async () => {
      const client = makeClient({ model: "claude-3-haiku-20240307" });
      mockCreate.mockResolvedValueOnce(
        anthropicResponse({ usage: { input_tokens: 1000, output_tokens: 500 } })
      );

      const result = await client.create(basicMessages());

      // Haiku pricing: input 0.00025/1000, output 0.00125/1000
      const expectedCost = 1000 * (0.00025 / 1000) + 500 * (0.00125 / 1000);
      expect(result.usage.costEstimate).toBeCloseTo(expectedCost, 8);
    });

    it("records durationMs in usage", async () => {
      const client = makeClient();
      mockCreate.mockImplementation(
        () => new Promise((r) => setTimeout(() => r(anthropicResponse()), 50))
      );

      const result = await client.create(basicMessages());

      expect(result.usage.durationMs).toBeGreaterThanOrEqual(40);
    });

    it("handles response with no stop_reason (defaults to 'stop')", async () => {
      const client = makeClient();
      mockCreate.mockResolvedValueOnce(
        anthropicResponse({ stop_reason: null })
      );

      const result = await client.create(basicMessages());

      expect(result.finishReason).toBe("stop");
    });

    it("handles messages without a system message", async () => {
      const client = makeClient();
      mockCreate.mockResolvedValueOnce(anthropicResponse());

      const msgs: Message[] = [
        { role: "user", content: "No system msg", source: "user", timestamp: new Date() },
      ];
      await client.create(msgs);

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.system).toBeUndefined();
      expect(callArgs.messages).toHaveLength(1);
    });
  });

  // =========================================================================
  // create() — structured output
  // =========================================================================

  describe("create() with structured output", () => {
    it("uses beta.messages.create for structured output", async () => {
      const client = makeClient();
      mockBetaCreate.mockResolvedValueOnce(
        anthropicResponse({
          content: [{ type: "text", text: '{"name":"Alice","age":30}' }],
        })
      );

      const schema = {
        type: "object",
        properties: { name: { type: "string" }, age: { type: "number" } },
        required: ["name", "age"],
      };

      await client.create(basicMessages(), { outputSchema: schema });

      expect(mockBetaCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("sends betas and output_format parameters", async () => {
      const client = makeClient();
      mockBetaCreate.mockResolvedValueOnce(
        anthropicResponse({
          content: [{ type: "text", text: '{"x":1}' }],
        })
      );

      const schema = { type: "object", properties: { x: { type: "number" } } };
      await client.create(basicMessages(), { outputSchema: schema });

      const args = mockBetaCreate.mock.calls[0][0];
      expect(args.betas).toEqual(["structured-outputs-2025-11-13"]);
      expect(args.output_format.type).toBe("json_schema");
      expect(args.output_format.schema).toBeDefined();
    });

    it("applies makeSchemaCompatible to the schema", async () => {
      const client = makeClient();
      mockBetaCreate.mockResolvedValueOnce(
        anthropicResponse({
          content: [{ type: "text", text: '{"nested":{"val":"ok"}}' }],
        })
      );

      const schema = {
        type: "object",
        properties: {
          nested: {
            type: "object",
            properties: { val: { type: "string" } },
          },
        },
      };
      await client.create(basicMessages(), { outputSchema: schema });

      const sentSchema = mockBetaCreate.mock.calls[0][0].output_format.schema;
      expect(sentSchema.additionalProperties).toBe(false);
      expect(sentSchema.properties.nested.additionalProperties).toBe(false);
    });

    it("parses structured output from response text", async () => {
      const client = makeClient();
      const payload = { name: "Bob", score: 95 };
      mockBetaCreate.mockResolvedValueOnce(
        anthropicResponse({
          content: [{ type: "text", text: JSON.stringify(payload) }],
        })
      );

      const schema = {
        type: "object",
        properties: { name: { type: "string" }, score: { type: "number" } },
      };
      const result = await client.create(basicMessages(), { outputSchema: schema });

      expect(result.structuredOutput).toEqual(payload);
    });

    it("returns undefined structuredOutput when JSON parse fails", async () => {
      const client = makeClient();
      mockBetaCreate.mockResolvedValueOnce(
        anthropicResponse({
          content: [{ type: "text", text: "not json at all" }],
        })
      );

      const schema = { type: "object", properties: {} };
      const result = await client.create(basicMessages(), { outputSchema: schema });

      expect(result.structuredOutput).toBeUndefined();
    });

    it("returns undefined structuredOutput when content is empty", async () => {
      const client = makeClient();
      mockBetaCreate.mockResolvedValueOnce(
        anthropicResponse({ content: [] })
      );

      const schema = { type: "object", properties: {} };
      const result = await client.create(basicMessages(), { outputSchema: schema });

      expect(result.structuredOutput).toBeUndefined();
    });
  });

  // =========================================================================
  // createStream()
  // =========================================================================

  describe("createStream()", () => {
    it("yields text chunks from content_block_delta events", async () => {
      const stream = makeStreamMock([
        { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } },
        { type: "content_block_delta", delta: { type: "text_delta", text: " world" } },
      ]);
      mockStream.mockReturnValueOnce(stream);

      const client = makeClient();
      const chunks: any[] = [];
      for await (const chunk of client.createStream(basicMessages())) {
        chunks.push(chunk);
      }

      // 2 text chunks + 1 final
      expect(chunks).toHaveLength(3);
      expect(chunks[0].content).toBe("Hello");
      expect(chunks[0].isComplete).toBe(false);
      expect(chunks[1].content).toBe(" world");
      expect(chunks[1].isComplete).toBe(false);
      expect(chunks[2].isComplete).toBe(true);
    });

    it("yields tool call chunks from content_block_start/delta", async () => {
      const stream = makeStreamMock([
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "tool_use", id: "toolu_01", name: "search" },
        },
        {
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: '{"q":' },
        },
        {
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: '"test"}' },
        },
      ]);
      mockStream.mockReturnValueOnce(stream);

      const client = makeClient();
      const chunks: any[] = [];
      for await (const chunk of client.createStream(basicMessages())) {
        chunks.push(chunk);
      }

      // 2 tool delta chunks + 1 final
      expect(chunks).toHaveLength(3);
      expect(chunks[0].toolCallChunk).toBeDefined();
      expect(chunks[0].toolCallChunk.id).toBe("toolu_01");
      expect(chunks[0].toolCallChunk.function.name).toBe("search");
      expect(chunks[1].toolCallChunk.function.arguments).toBe('{"q":"test"}');
    });

    it("yields final chunk with usage", async () => {
      const stream = makeStreamMock(
        [{ type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } }],
        { input_tokens: 100, output_tokens: 50 }
      );
      mockStream.mockReturnValueOnce(stream);

      const client = makeClient();
      const chunks: any[] = [];
      for await (const chunk of client.createStream(basicMessages())) {
        chunks.push(chunk);
      }

      const final = chunks[chunks.length - 1];
      expect(final.isComplete).toBe(true);
      expect(final.usage).toBeDefined();
      expect(final.usage.tokensInput).toBe(100);
      expect(final.usage.tokensOutput).toBe(50);
      expect(final.usage.llmCalls).toBe(1);
    });

    it("extracts system message for stream request", async () => {
      const stream = makeStreamMock([]);
      mockStream.mockReturnValueOnce(stream);

      const client = makeClient();
      for await (const _ of client.createStream(basicMessages())) { /* noop */ }

      const callArgs = mockStream.mock.calls[0][0];
      expect(callArgs.system).toBe("You are helpful.");
      expect(callArgs.messages[0].role).toBe("user");
    });

    it("passes tools to stream request", async () => {
      const stream = makeStreamMock([]);
      mockStream.mockReturnValueOnce(stream);

      const client = makeClient();
      const tools = [
        { type: "function", function: { name: "t", description: "d", parameters: {} } },
      ];
      for await (const _ of client.createStream(basicMessages(), { tools })) { /* noop */ }

      expect(mockStream.mock.calls[0][0].tools).toHaveLength(1);
    });

    it("handles empty stream gracefully", async () => {
      const stream = makeStreamMock([]);
      mockStream.mockReturnValueOnce(stream);

      const client = makeClient();
      const chunks: any[] = [];
      for await (const chunk of client.createStream(basicMessages())) {
        chunks.push(chunk);
      }

      // Only the final chunk
      expect(chunks).toHaveLength(1);
      expect(chunks[0].isComplete).toBe(true);
    });

    it("tracks tool call count in final usage", async () => {
      const stream = makeStreamMock([
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "t1", name: "a" },
        },
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "tool_use", id: "t2", name: "b" },
        },
      ]);
      mockStream.mockReturnValueOnce(stream);

      const client = makeClient();
      const chunks: any[] = [];
      for await (const chunk of client.createStream(basicMessages())) {
        chunks.push(chunk);
      }

      const final = chunks[chunks.length - 1];
      expect(final.usage.toolCalls).toBe(2);
    });

    it("handles messages without a system message in stream", async () => {
      const stream = makeStreamMock([]);
      mockStream.mockReturnValueOnce(stream);

      const client = makeClient();
      const msgs: Message[] = [
        { role: "user", content: "Hi", source: "user", timestamp: new Date() },
      ];
      for await (const _ of client.createStream(msgs)) { /* noop */ }

      const callArgs = mockStream.mock.calls[0][0];
      expect(callArgs.system).toBeUndefined();
    });
  });

  // =========================================================================
  // Cost estimation
  // =========================================================================

  describe("cost estimation", () => {
    it("estimates cost for claude-3-5-sonnet model", () => {
      const client = makeClient({ model: "claude-3-5-sonnet-20241022" });
      const cost = (client as any).estimateCost(1000, 500);
      const expected = 1000 * (0.003 / 1000) + 500 * (0.015 / 1000);
      expect(cost).toBeCloseTo(expected, 8);
    });

    it("estimates cost for claude-3-opus model", () => {
      const client = makeClient({ model: "claude-3-opus-20240229" });
      const cost = (client as any).estimateCost(1000, 500);
      const expected = 1000 * (0.015 / 1000) + 500 * (0.075 / 1000);
      expect(cost).toBeCloseTo(expected, 8);
    });

    it("estimates cost for claude-3-haiku model", () => {
      const client = makeClient({ model: "claude-3-haiku-20240307" });
      const cost = (client as any).estimateCost(1000, 500);
      const expected = 1000 * (0.00025 / 1000) + 500 * (0.00125 / 1000);
      expect(cost).toBeCloseTo(expected, 8);
    });

    it("estimates cost for claude-3-sonnet model", () => {
      const client = makeClient({ model: "claude-3-sonnet-20240229" });
      const cost = (client as any).estimateCost(1000, 500);
      const expected = 1000 * (0.003 / 1000) + 500 * (0.015 / 1000);
      expect(cost).toBeCloseTo(expected, 8);
    });

    it("falls back to sonnet pricing for unknown model", () => {
      const client = makeClient({ model: "claude-4-ultra" });
      const cost = (client as any).estimateCost(1000, 500);
      const expected = 1000 * (0.003 / 1000) + 500 * (0.015 / 1000);
      expect(cost).toBeCloseTo(expected, 8);
    });

    it("returns 0 for 0 tokens", () => {
      const client = makeClient();
      const cost = (client as any).estimateCost(0, 0);
      expect(cost).toBe(0);
    });
  });

  // =========================================================================
  // Error handling
  // =========================================================================

  describe("error handling", () => {
    it("throws AuthenticationError for Anthropic auth errors", async () => {
      const client = makeClient();
      const err = new Error("Invalid API key");
      Object.defineProperty(err, "constructor", {
        value: { name: "AuthenticationError" },
      });
      mockCreate.mockRejectedValueOnce(err);

      await expect(client.create(basicMessages())).rejects.toThrow(AuthenticationError);
    });

    it("includes original message in AuthenticationError", async () => {
      const client = makeClient();
      const err = new Error("Invalid API key");
      Object.defineProperty(err, "constructor", {
        value: { name: "AuthenticationError" },
      });
      mockCreate.mockRejectedValueOnce(err);

      await expect(client.create(basicMessages())).rejects.toThrow(
        /Anthropic authentication failed.*Invalid API key/
      );
    });

    it("throws RateLimitError for rate limit errors", async () => {
      const client = makeClient();
      const err = new Error("Too many requests");
      Object.defineProperty(err, "constructor", {
        value: { name: "RateLimitError" },
      });
      mockCreate.mockRejectedValueOnce(err);

      await expect(client.create(basicMessages())).rejects.toThrow(RateLimitError);
    });

    it("throws BaseChatCompletionError for API errors", async () => {
      const client = makeClient();
      const err = new Error("Server error");
      Object.defineProperty(err, "constructor", {
        value: { name: "APIError" },
      });
      mockCreate.mockRejectedValueOnce(err);

      await expect(client.create(basicMessages())).rejects.toThrow(BaseChatCompletionError);
    });

    it("includes 'Anthropic API error' in API error message", async () => {
      const client = makeClient();
      const err = new Error("500 Internal");
      Object.defineProperty(err, "constructor", {
        value: { name: "APIError" },
      });
      mockCreate.mockRejectedValueOnce(err);

      await expect(client.create(basicMessages())).rejects.toThrow(/Anthropic API error/);
    });

    it("throws BaseChatCompletionError for unexpected errors", async () => {
      const client = makeClient();
      mockCreate.mockRejectedValueOnce(new Error("Network failure"));

      await expect(client.create(basicMessages())).rejects.toThrow(BaseChatCompletionError);
    });

    it("includes 'Unexpected error' for unknown errors", async () => {
      const client = makeClient();
      mockCreate.mockRejectedValueOnce(new Error("Network failure"));

      await expect(client.create(basicMessages())).rejects.toThrow(/Unexpected error/);
    });

    it("does not double-wrap BaseChatCompletionError", async () => {
      const client = makeClient();
      const original = new BaseChatCompletionError("already wrapped");
      mockCreate.mockRejectedValueOnce(original);

      try {
        await client.create(basicMessages());
        expect.fail("should throw");
      } catch (e) {
        expect(e).toBe(original);
      }
    });

    it("handles errors in createStream()", async () => {
      const client = makeClient();
      const err = new Error("stream auth fail");
      Object.defineProperty(err, "constructor", {
        value: { name: "AuthenticationError" },
      });
      mockStream.mockImplementation(() => { throw err; });

      const gen = client.createStream(basicMessages());
      await expect(gen.next()).rejects.toThrow(AuthenticationError);
    });

    it("handles RateLimitError in createStream()", async () => {
      const client = makeClient();
      const err = new Error("too many");
      Object.defineProperty(err, "constructor", {
        value: { name: "RateLimitError" },
      });
      mockStream.mockImplementation(() => { throw err; });

      const gen = client.createStream(basicMessages());
      await expect(gen.next()).rejects.toThrow(RateLimitError);
    });
  });

  // =========================================================================
  // Serialization
  // =========================================================================

  describe("serialization", () => {
    it("toConfig returns model, apiKey, baseUrl, and config", () => {
      const client = makeClient({
        model: "claude-3-opus-20240229",
        apiKey: "sk-123",
        baseUrl: "https://custom.api.com",
      });
      const config = client.toConfig();
      expect(config.model).toBe("claude-3-opus-20240229");
      expect(config.apiKey).toBe("sk-123");
      expect(config.baseUrl).toBe("https://custom.api.com");
    });

    it("toConfig includes undefined baseUrl when not set", () => {
      const client = makeClient();
      const config = client.toConfig();
      expect(config.baseUrl).toBeUndefined();
    });

    it("fromConfig creates a functional client", () => {
      const config = {
        model: "claude-3-haiku-20240307",
        apiKey: "sk-ant-456",
        baseUrl: "https://proxy.example.com",
      };
      const client = AnthropicChatCompletionClient.fromConfig(config);
      expect(client).toBeInstanceOf(AnthropicChatCompletionClient);
      expect(client.model).toBe("claude-3-haiku-20240307");
      expect(client.apiKey).toBe("sk-ant-456");
    });

    it("round-trips through toConfig/fromConfig", () => {
      const original = makeClient({
        model: "claude-3-5-sonnet-20241022",
        apiKey: "sk-round",
        baseUrl: "https://rt.example.com",
      });
      const config = original.toConfig();
      const restored = AnthropicChatCompletionClient.fromConfig(config);
      expect(restored.model).toBe(original.model);
      expect(restored.apiKey).toBe(original.apiKey);
    });

    it("includes extra config in toConfig", () => {
      const client = makeClient();
      const config = client.toConfig();
      expect(config.config).toBeDefined();
    });
  });

  // =========================================================================
  // makeSchemaCompatible (via base class)
  // =========================================================================

  describe("makeSchemaCompatible", () => {
    it("adds additionalProperties: false to object schemas", () => {
      const client = makeClient();
      const schema = { type: "object", properties: { x: { type: "string" } } };
      const result = (client as any).makeSchemaCompatible(schema);
      expect(result.additionalProperties).toBe(false);
    });

    it("recursively processes nested objects", () => {
      const client = makeClient();
      const schema = {
        type: "object",
        properties: {
          inner: {
            type: "object",
            properties: { y: { type: "number" } },
          },
        },
      };
      const result = (client as any).makeSchemaCompatible(schema);
      expect(result.additionalProperties).toBe(false);
      expect(result.properties.inner.additionalProperties).toBe(false);
    });

    it("processes array items", () => {
      const client = makeClient();
      const schema = {
        type: "array",
        items: {
          type: "object",
          properties: { z: { type: "boolean" } },
        },
      };
      const result = (client as any).makeSchemaCompatible(schema);
      expect(result.items.additionalProperties).toBe(false);
    });

    it("does not modify non-object schemas", () => {
      const client = makeClient();
      const schema = { type: "string" };
      const result = (client as any).makeSchemaCompatible(schema);
      expect(result).toEqual({ type: "string" });
      expect(result.additionalProperties).toBeUndefined();
    });

    it("handles deeply nested schemas", () => {
      const client = makeClient();
      const schema = {
        type: "object",
        properties: {
          level1: {
            type: "object",
            properties: {
              level2: {
                type: "array",
                items: {
                  type: "object",
                  properties: { val: { type: "string" } },
                },
              },
            },
          },
        },
      };
      const result = (client as any).makeSchemaCompatible(schema);
      expect(result.additionalProperties).toBe(false);
      expect(result.properties.level1.additionalProperties).toBe(false);
      expect(result.properties.level1.properties.level2.items.additionalProperties).toBe(false);
    });

    it("does not mutate the original schema", () => {
      const client = makeClient();
      const original = { type: "object", properties: { a: { type: "string" } } };
      const copy = JSON.parse(JSON.stringify(original));
      (client as any).makeSchemaCompatible(original);
      expect(original).toEqual(copy);
    });
  });
});
