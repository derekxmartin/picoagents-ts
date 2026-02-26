/**
 * Basic tests for the Agent implementation.
 */

import { describe, it, expect } from "vitest";

import { Agent } from "../agents/agent.js";
import type { BaseChatCompletionClient } from "../llm/base.js";
import type {
  AssistantMessage,
  UserMessage,
  SystemMessage,
  Message,
  MultiModalMessage,
} from "../messages.js";
import {
  MultiModalMessageSchema,
  isImage,
  isText,
  isAudio,
  isVideo,
  toBase64,
} from "../messages.js";
import type {
  AgentResponse,
  ChatCompletionResult,
  ChatCompletionChunk,
  Usage,
  AgentEvent,
} from "../types.js";
import { getMessages } from "../types.js";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function mockUsage(): Usage {
  return {
    durationMs: 100,
    llmCalls: 1,
    tokensInput: 50,
    tokensOutput: 25,
    toolCalls: 0,
    memoryOperations: 0,
  };
}

function createMockLlm(
  responses: ChatCompletionResult[]
): BaseChatCompletionClient {
  let callIndex = 0;
  return {
    create: async (_messages: any[]) => {
      const r = responses[callIndex % responses.length];
      callIndex++;
      return r;
    },
    createStream: async function* (_messages: any[]) {
      const r = responses[callIndex % responses.length];
      callIndex++;
      yield {
        content: r.message.content ?? "",
        isComplete: true,
        usage: r.usage,
      } as ChatCompletionChunk;
    },
    totalUsage: mockUsage(),
    actualUsage: mockUsage(),
    model: "mock-model",
    get callCount() {
      return callIndex;
    },
  } as unknown as BaseChatCompletionClient & { callCount: number };
}

function makeResponse(content: string, model = "mock-model"): ChatCompletionResult {
  return {
    message: {
      role: "assistant" as const,
      content,
      source: "mock",
      timestamp: new Date(),
    },
    usage: mockUsage(),
    model,
    finishReason: "stop",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Agent basic tests", () => {
  it("should initialize with correct properties", () => {
    const mockLlm = createMockLlm([makeResponse("Test response")]);

    const agent = new Agent({
      name: "test-agent",
      description: "A test agent for unit tests",
      instructions: "You are a helpful test assistant",
      modelClient: mockLlm,
    });

    expect(agent.name).toBe("test-agent");
    expect(agent.description).toBe("A test agent for unit tests");
    expect(agent.instructions).toBe("You are a helpful test assistant");
    expect(agent.modelClient).toBe(mockLlm);
    expect(agent.tools).toEqual([]);
    expect(agent.memory).toBeUndefined();
    expect(agent.context.messages).toEqual([]);
    expect(agent.maxIterations).toBe(10);
  });

  it("should run and return an AgentResponse with messages", async () => {
    const mockLlm = createMockLlm([makeResponse("Hello! I'm here to help.")]);

    const agent = new Agent({
      name: "test-agent",
      description: "A test agent",
      instructions: "You are helpful",
      modelClient: mockLlm,
    });

    const result = await agent.run("Hello, how are you?");

    expect(result).toBeDefined();
    expect(result.source).toBe("test-agent");
    expect(result.usage).toBeDefined();
    expect(result.context).toBeDefined();

    const messages = getMessages(result);
    expect(messages.length).toBeGreaterThanOrEqual(2); // At least user + assistant

    const userMessages = messages.filter((m) => m.role === "user");
    const assistantMessages = messages.filter((m) => m.role === "assistant");

    expect(userMessages.length).toBeGreaterThanOrEqual(1);
    expect(assistantMessages.length).toBeGreaterThanOrEqual(1);
    expect(assistantMessages[0].content).toBe("Hello! I'm here to help.");
  });

  it("should stream events via runStream", async () => {
    const mockLlm = createMockLlm([makeResponse("Streaming response")]);

    const agent = new Agent({
      name: "test-agent",
      description: "A test agent",
      instructions: "You are helpful",
      modelClient: mockLlm,
    });

    const items: Array<Message | AgentEvent | AgentResponse | ChatCompletionChunk> = [];
    for await (const item of agent.runStream("Test streaming", undefined, undefined, true)) {
      items.push(item);
    }

    expect(items.length).toBeGreaterThan(0);

    // Separate messages, events, and responses
    const messages = items.filter(
      (item): item is Message =>
        typeof item === "object" &&
        item !== null &&
        "role" in item &&
        "content" in item
    );
    const events = items.filter(
      (item): item is AgentEvent =>
        typeof item === "object" &&
        item !== null &&
        "eventType" in item
    );
    const responses = items.filter(
      (item): item is AgentResponse =>
        typeof item === "object" &&
        item !== null &&
        "finishReason" in item &&
        "usage" in item &&
        "source" in item &&
        !("role" in item)
    );

    expect(messages.length).toBeGreaterThanOrEqual(2); // User message + assistant response
    expect(events.length).toBeGreaterThanOrEqual(2); // At least TaskStart + ModelCall/ModelResponse
    expect(responses.length).toBe(1); // Should have final AgentResponse
  });

  it("should handle different task formats", async () => {
    const mockLlm = createMockLlm([makeResponse("Task completed")]);

    const agent = new Agent({
      name: "test-agent",
      description: "A test agent",
      instructions: "You are helpful",
      modelClient: mockLlm,
    });

    // Test with string input
    const result1 = await agent.run("String task");
    expect(result1).toBeDefined();
    expect(result1.context).toBeDefined();

    // Test with UserMessage input
    const userMsg: UserMessage = {
      role: "user",
      content: "UserMessage task",
      source: "user",
      timestamp: new Date(),
    };
    const result2 = await agent.run(userMsg);
    expect(result2).toBeDefined();
    expect(result2.context).toBeDefined();

    // Test with Message[] input
    const messageList: Message[] = [
      {
        role: "system",
        content: "System context",
        source: "system",
        timestamp: new Date(),
      } as SystemMessage,
      {
        role: "user",
        content: "List task",
        source: "user",
        timestamp: new Date(),
      } as UserMessage,
    ];
    const result3 = await agent.run(messageList);
    expect(result3).toBeDefined();
    expect(result3.context).toBeDefined();

    // The mock LLM should have been called 3 times
    expect((mockLlm as any).callCount).toBe(3);
  });

  it("should reset context messages", async () => {
    const mockLlm = createMockLlm([makeResponse("Test response")]);

    const agent = new Agent({
      name: "test-agent",
      description: "A test agent",
      instructions: "You are helpful",
      modelClient: mockLlm,
    });

    // Add some message history
    agent.context.addMessage({
      role: "user",
      content: "Previous message",
      source: "user",
      timestamp: new Date(),
    } as UserMessage);
    agent.context.addMessage({
      role: "assistant",
      content: "Previous response",
      source: "test-agent",
      timestamp: new Date(),
    } as AssistantMessage);

    expect(agent.context.messages.length).toBe(2);

    await agent.reset();

    expect(agent.context.messages.length).toBe(0);
  });

  it("should return correct metadata from getInfo", () => {
    const mockLlm = createMockLlm([makeResponse("Test response")]);
    // Override the model name for this test
    (mockLlm as any).model = "gpt-4";

    const agent = new Agent({
      name: "info-agent",
      description: "Agent for testing info",
      instructions: "You provide information",
      modelClient: mockLlm,
    });

    const info = agent.getInfo();

    expect(info.name).toBe("info-agent");
    expect(info.description).toBe("Agent for testing info");
    expect(info.type).toBe("Agent");
    expect(info.model).toBe("gpt-4");
    expect(info.toolsCount).toBe(0);
    expect(info.hasMemory).toBe(false);
    expect(info.hasMiddlewares).toBe(false);
    expect(info.messageHistoryLength).toBe(0);
  });
});

describe("MultiModalMessage tests", () => {
  it("should create an image MultiModalMessage with data", () => {
    const testImageData = new Uint8Array([102, 97, 107, 101]); // "fake" in bytes

    const imageMsg = MultiModalMessageSchema.parse({
      content: "What's in this image?",
      role: "user",
      mimeType: "image/png",
      data: testImageData,
      source: "test",
    });

    expect(imageMsg.content).toBe("What's in this image?");
    expect(imageMsg.role).toBe("user");
    expect(imageMsg.mimeType).toBe("image/png");
    expect(imageMsg.data).toEqual(testImageData);
    expect(imageMsg.mediaUrl).toBeUndefined();

    // Test helper functions
    expect(isImage(imageMsg)).toBe(true);
    expect(isText(imageMsg)).toBe(false);
    expect(isAudio(imageMsg)).toBe(false);
    expect(isVideo(imageMsg)).toBe(false);

    // Test base64 conversion
    const base64Str = toBase64(imageMsg);
    expect(typeof base64Str).toBe("string");
    expect(base64Str!.length).toBeGreaterThan(0);
  });

  it("should create a MultiModalMessage with URL instead of data", () => {
    const urlMsg = MultiModalMessageSchema.parse({
      content: "Analyze this image",
      role: "user",
      mimeType: "image/jpeg",
      mediaUrl: "https://example.com/test.jpg",
      source: "test",
    });

    expect(urlMsg.mediaUrl).toBe("https://example.com/test.jpg");
    expect(urlMsg.data).toBeUndefined();
    expect(isImage(urlMsg)).toBe(true);
  });

  it("should fail if both data and mediaUrl are provided", () => {
    expect(() =>
      MultiModalMessageSchema.parse({
        content: "Test",
        role: "user",
        mimeType: "image/png",
        data: new Uint8Array([1, 2, 3]),
        mediaUrl: "https://example.com/test.png",
        source: "test",
      })
    ).toThrow();
  });

  it("should fail if neither data nor mediaUrl are provided", () => {
    expect(() =>
      MultiModalMessageSchema.parse({
        content: "Test",
        role: "user",
        mimeType: "image/png",
        source: "test",
      })
    ).toThrow();
  });
});
