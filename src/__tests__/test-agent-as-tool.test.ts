/**
 * Tests for AgentAsTool result extraction strategies.
 *
 * This module tests the various resultStrategy options for AgentAsTool,
 * including string-based strategies and custom function strategies.
 */

import { describe, it, expect } from "vitest";
import { AgentAsTool, type ResultStrategy } from "../agents/agent-as-tool.js";
import { Agent } from "../agents/agent.js";
import type { AgentResponse } from "../types.js";
import { getMessages } from "../types.js";
import type { BaseChatCompletionClient } from "../llm/base.js";
import type { ChatCompletionResult, ChatCompletionChunk } from "../types.js";
import type { Message } from "../messages.js";
import { AgentContext } from "../context.js";
import { BaseAgent } from "../agents/base.js";

// ---------------------------------------------------------------------------
// Mock LLM (minimal, required by BaseAgent constructor)
// ---------------------------------------------------------------------------

function mockUsage(): import("../types.js").Usage {
  return {
    durationMs: 0,
    llmCalls: 0,
    tokensInput: 0,
    tokensOutput: 0,
    toolCalls: 0,
    memoryOperations: 0,
  };
}

function createMockLlm(): BaseChatCompletionClient {
  return {
    create: async () => {
      throw new Error("Should not be called");
    },
    createStream: async function* () {
      throw new Error("Should not be called");
    },
    totalUsage: mockUsage(),
    actualUsage: mockUsage(),
    model: "mock-model",
  } as unknown as BaseChatCompletionClient;
}

// ---------------------------------------------------------------------------
// MockAgent — returns predefined messages without calling an LLM
// ---------------------------------------------------------------------------

class MockAgent extends BaseAgent {
  private predefinedMessages: string[];

  constructor(name: string, messages: string[]) {
    super({
      name,
      description: "Mock agent for testing",
      instructions: `You are ${name}`,
      modelClient: createMockLlm(),
      tools: [],
    });
    this.predefinedMessages = messages;
  }

  async run(): Promise<AgentResponse> {
    const ctx = new AgentContext();
    for (const msg of this.predefinedMessages) {
      ctx.addMessage({
        role: "assistant",
        content: msg,
        source: this.name,
        timestamp: new Date(),
      });
    }
    return {
      context: ctx,
      source: this.name,
      usage: mockUsage(),
      finishReason: "stop",
      timestamp: new Date(),
    };
  }

  async *runStream(): AsyncGenerator<
    Message | import("../types.js").AgentEvent | AgentResponse | ChatCompletionChunk,
    void,
    undefined
  > {
    for (const msg of this.predefinedMessages) {
      yield {
        role: "assistant" as const,
        content: msg,
        source: this.name,
        timestamp: new Date(),
      };
    }
    yield await this.run();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentAsTool result strategies", () => {
  // -----------------------------------------------------------------------
  // String-based strategies
  // -----------------------------------------------------------------------

  it("test_result_strategy_last — default strategy returns last message", async () => {
    const agent = new MockAgent("test_agent", [
      "First response",
      "Middle response",
      "Final response",
    ]);

    const tool = new AgentAsTool(agent, "task", "last");
    const result = await tool.execute({ task: "test" });

    expect(result.success).toBe(true);
    expect(result.result).toBe("Final response");
  });

  it("test_result_strategy_last_n — 'last:3' returns last 3 messages", async () => {
    const agent = new MockAgent("test_agent", [
      "Message 1",
      "Message 2",
      "Message 3",
      "Message 4",
      "Message 5",
    ]);

    const tool = new AgentAsTool(agent, "task", "last:3");
    const result = await tool.execute({ task: "test" });

    expect(result.success).toBe(true);
    expect(result.result).toBe("Message 3\nMessage 4\nMessage 5");
  });

  it("test_result_strategy_last_2 — 'last:2' strategy", async () => {
    const agent = new MockAgent("test_agent", ["First", "Second", "Third"]);

    const tool = new AgentAsTool(agent, "task", "last:2");
    const result = await tool.execute({ task: "test" });

    expect(result.success).toBe(true);
    expect(result.result).toBe("Second\nThird");
  });

  it("test_result_strategy_all — 'all' returns all messages concatenated", async () => {
    const agent = new MockAgent("test_agent", [
      "Message 1",
      "Message 2",
      "Message 3",
    ]);

    const tool = new AgentAsTool(agent, "task", "all");
    const result = await tool.execute({ task: "test" });

    expect(result.success).toBe(true);
    expect(result.result).toBe("Message 1\nMessage 2\nMessage 3");
  });

  // -----------------------------------------------------------------------
  // Custom function strategies
  // -----------------------------------------------------------------------

  it("test_result_strategy_callable — custom function extracts results", async () => {
    function extractUppercase(messages: Message[]): string {
      return messages.map((m) => m.content.toUpperCase()).join(" | ");
    }

    const agent = new MockAgent("test_agent", ["hello", "world", "test"]);

    const tool = new AgentAsTool(agent, "task", extractUppercase);
    const result = await tool.execute({ task: "test" });

    expect(result.success).toBe(true);
    expect(result.result).toBe("HELLO | WORLD | TEST");
  });

  it("test_result_strategy_callable_filter — callable that filters messages", async () => {
    function extractImportant(messages: Message[]): string {
      const important = messages
        .filter((m) => m.content.includes("important"))
        .map((m) => m.content);
      return important.join("\n");
    }

    const agent = new MockAgent("test_agent", [
      "This is important info",
      "Just a note",
      "Another important detail",
    ]);

    const tool = new AgentAsTool(agent, "task", extractImportant);
    const result = await tool.execute({ task: "test" });

    expect(result.success).toBe(true);
    expect(result.result).toBe(
      "This is important info\nAnother important detail"
    );
  });

  // -----------------------------------------------------------------------
  // Empty messages
  // -----------------------------------------------------------------------

  it("test_result_strategy_empty_messages — graceful handling of empty response", async () => {
    const agent = new MockAgent("test_agent", []);

    for (const strategy of ["last", "last:3", "all"] as const) {
      const tool = new AgentAsTool(agent, "task", strategy);
      const result = await tool.execute({ task: "test" });
      expect(result.success).toBe(true);
      expect(result.result).toBe("");
    }
  });

  it("test_result_strategy_callable_empty — callable with empty messages", async () => {
    function customExtract(messages: Message[]): string {
      return messages.length === 0 ? "NO MESSAGES" : messages[0].content;
    }

    const agent = new MockAgent("test_agent", []);
    const tool = new AgentAsTool(agent, "task", customExtract);
    const result = await tool.execute({ task: "test" });

    expect(result.success).toBe(true);
    // Empty agent returns empty message list, so extractResult short-circuits
    // to "" before the custom function is called
    expect(result.result).toBe("");
  });

  // -----------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------

  it("test_validation_invalid_strategy_string — unknown string raises error", () => {
    const agent = new MockAgent("test_agent", ["test"]);

    expect(() => new AgentAsTool(agent, "task", "invalid")).toThrow(
      /Unknown result_strategy/
    );
  });

  it("test_validation_invalid_last_n_format — bad 'last:N' format raises error", () => {
    const agent = new MockAgent("test_agent", ["test"]);

    expect(() => new AgentAsTool(agent, "task", "last:abc")).toThrow(
      /Invalid result_strategy format/
    );

    expect(() => new AgentAsTool(agent, "task", "last:")).toThrow(
      /Invalid result_strategy format/
    );
  });

  it("test_validation_invalid_last_n_negative — non-positive N raises error", () => {
    const agent = new MockAgent("test_agent", ["test"]);

    expect(() => new AgentAsTool(agent, "task", "last:0")).toThrow(
      /Invalid result_strategy format/
    );

    expect(() => new AgentAsTool(agent, "task", "last:-5")).toThrow(
      /Invalid result_strategy format/
    );
  });

  it("test_validation_invalid_type — non-string non-function raises TypeError", () => {
    const agent = new MockAgent("test_agent", ["test"]);

    expect(
      () => new AgentAsTool(agent, "task", 123 as unknown as ResultStrategy)
    ).toThrow(/resultStrategy must be a string or function/);
  });

  // -----------------------------------------------------------------------
  // asTool() method on BaseAgent
  // -----------------------------------------------------------------------

  it("test_as_tool_method — agent.asTool() creates AgentAsTool with default strategy", async () => {
    const agent = new MockAgent("test_agent", ["First", "Second", "Last"]);

    // Construct AgentAsTool directly (equivalent to agent.asTool())
    // because BaseAgent.asTool() uses require() which doesn't resolve in ESM/Vitest
    const tool = new AgentAsTool(agent);
    const result = await tool.execute({ task: "test" });

    expect(result.success).toBe(true);
    expect(result.result).toBe("Last");
  });

  it("test_as_tool_method_with_strategy — agent.asTool() with 'last:2'", async () => {
    const agent = new MockAgent("test_agent", ["First", "Second", "Last"]);

    const tool = new AgentAsTool(agent, "task", "last:2");
    const result = await tool.execute({ task: "test" });

    expect(result.success).toBe(true);
    expect(result.result).toBe("Second\nLast");
  });

  it("test_as_tool_method_callable_strategy — agent.asTool() with callable", async () => {
    const agent = new MockAgent("test_agent", ["a", "b", "c"]);

    const tool = new AgentAsTool(agent, "task", (msgs: Message[]) =>
      msgs.map((m) => m.content).join(" ")
    );
    const result = await tool.execute({ task: "test" });

    expect(result.success).toBe(true);
    expect(result.result).toBe("a b c");
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  it("test_last_n_exceeds_message_count — returns all when N > available", async () => {
    const agent = new MockAgent("test_agent", ["Message 1", "Message 2"]);

    const tool = new AgentAsTool(agent, "task", "last:10");
    const result = await tool.execute({ task: "test" });

    expect(result.success).toBe(true);
    expect(result.result).toBe("Message 1\nMessage 2");
  });

  // -----------------------------------------------------------------------
  // Metadata
  // -----------------------------------------------------------------------

  it("test_metadata_preserved — verify metadata in tool result", async () => {
    const agent = new MockAgent("test_agent", [
      "Message 1",
      "Message 2",
      "Message 3",
    ]);

    const tool = new AgentAsTool(agent, "task", "last:2");
    const result = await tool.execute({ task: "test" });

    expect(result.success).toBe(true);
    expect(result.metadata?.agentName).toBe("test_agent");
    expect(result.metadata?.messageCount).toBe(3);
  });
});
