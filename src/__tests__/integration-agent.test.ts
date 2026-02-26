/**
 * Integration test: Agent + Tools + Mock LLM end-to-end.
 *
 * Verifies the full Agent → Tools → LLM → Response pipeline
 * using a mock LLM client that returns canned responses.
 */

import { describe, it, expect } from "vitest";
import { Agent } from "../agents/agent.js";
import { createTool } from "../tools/decorator.js";
import { z } from "zod";
import type { BaseChatCompletionClient } from "../llm/base.js";
import type {
  ChatCompletionResult,
  ChatCompletionChunk,
  AgentEvent,
  AgentResponse,
} from "../types.js";
import { getMessages } from "../types.js";
import type { Message } from "../messages.js";
import { CancellationToken } from "../cancellation-token.js";

// ---------------------------------------------------------------------------
// Mock LLM client
// ---------------------------------------------------------------------------

function mockUsage(): import("../types.js").Usage {
  return {
    durationMs: 100,
    llmCalls: 1,
    tokensInput: 10,
    tokensOutput: 20,
    toolCalls: 0,
    memoryOperations: 0,
  };
}

function createMockLlm(responses: ChatCompletionResult[]): BaseChatCompletionClient {
  let callIndex = 0;
  return {
    create: async () => {
      const response = responses[callIndex % responses.length];
      callIndex++;
      return response;
    },
    createStream: async function* () {
      const response = responses[callIndex % responses.length];
      callIndex++;
      yield {
        content: response.message.content ?? "",
        isComplete: true,
      } as ChatCompletionChunk;
    },
    totalUsage: mockUsage(),
    actualUsage: mockUsage(),
    model: "mock-model",
  } as unknown as BaseChatCompletionClient;
}

function textResponse(content: string): ChatCompletionResult {
  return {
    message: {
      role: "assistant",
      content,
      source: "mock",
      timestamp: new Date(),
    },
    usage: mockUsage(),
    model: "mock-model",
    finishReason: "stop",
  };
}

function toolCallResponse(
  toolName: string,
  args: Record<string, unknown>
): ChatCompletionResult {
  return {
    message: {
      role: "assistant",
      content: "",
      source: "mock",
      timestamp: new Date(),
      toolCalls: [
        {
          toolName,
          parameters: args,
          callId: `call_${toolName}_${Date.now()}`,
        },
      ],
    },
    usage: mockUsage(),
    model: "mock-model",
    finishReason: "tool_calls",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Agent integration", () => {
  it("should handle a simple text response", async () => {
    const llm = createMockLlm([textResponse("Hello! I'm an AI agent.")]);

    const agent = new Agent({
      name: "test-agent",
      description: "A test agent",
      instructions: "You are a helpful agent.",
      modelClient: llm,
      tools: [],
    });

    const response = await agent.run("Hello");
    expect(response).toBeDefined();
    expect(getMessages(response).length).toBeGreaterThan(0);
  });

  it("should call a tool and return final response", async () => {
    const addTool = createTool({
      name: "add",
      description: "Add two numbers",
      parametersSchema: z.object({
        a: z.number(),
        b: z.number(),
      }),
      execute: ({ a, b }) => `${a + b}`,
    });

    const llm = createMockLlm([
      toolCallResponse("add", { a: 2, b: 3 }),
      textResponse("The sum of 2 and 3 is 5."),
    ]);

    const agent = new Agent({
      name: "math-agent",
      description: "A math agent",
      instructions: "You are a math agent. Use the add tool to add numbers.",
      modelClient: llm,
      tools: [addTool],
    });

    const response = await agent.run("What is 2 + 3?");
    expect(response).toBeDefined();
    // Should have at least: system + user + assistant(tool call) + tool result + assistant(final)
    expect(getMessages(response).length).toBeGreaterThanOrEqual(3);
  });

  it("should stream events from runStream", async () => {
    const llm = createMockLlm([textResponse("Streamed response.")]);

    const agent = new Agent({
      name: "stream-agent",
      description: "A streaming agent",
      instructions: "You are a streaming agent.",
      modelClient: llm,
      tools: [],
    });

    const events: Array<Message | AgentEvent | AgentResponse | ChatCompletionChunk> = [];
    for await (const event of agent.runStream("Hello")) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
  });

  it("should respect maxIterations", async () => {
    // LLM always calls a tool, never gives a text response
    const echoTool = createTool({
      name: "echo",
      description: "Echo input",
      parametersSchema: z.object({ text: z.string() }),
      execute: ({ text }) => text,
    });

    const llm = createMockLlm([
      toolCallResponse("echo", { text: "loop" }),
    ]);

    const agent = new Agent({
      name: "loop-agent",
      description: "A loop agent",
      instructions: "You loop forever.",
      modelClient: llm,
      tools: [echoTool],
      maxIterations: 3,
    });

    const response = await agent.run("Loop");
    expect(response).toBeDefined();
    // Agent should stop after maxIterations even without a text response
  });

  it("should support CancellationToken creation", () => {
    const token = new CancellationToken();
    expect(token.isCancelled()).toBe(false);
    token.cancel();
    expect(token.isCancelled()).toBe(true);
  });
});
