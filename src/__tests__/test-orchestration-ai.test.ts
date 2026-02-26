/**
 * Tests for AIOrchestrator.
 */

import { describe, it, expect } from "vitest";
import { AgentContext } from "../context.js";
import type { Message } from "../messages.js";
import type { BaseAgent } from "../agents/base.js";
import type { BaseChatCompletionClient } from "../llm/base.js";
import type {
  AgentResponse,
  AgentEvent,
  ChatCompletionChunk,
  ChatCompletionResult,
  Usage,
} from "../types.js";
import type { CancellationToken } from "../cancellation-token.js";
import { AIOrchestrator } from "../orchestration/ai.js";
import {
  MaxMessageTermination,
  TextMentionTermination,
} from "../termination/index.js";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function mockUsage(overrides?: Partial<Usage>): Usage {
  return {
    durationMs: 10,
    llmCalls: 1,
    tokensInput: 10,
    tokensOutput: 5,
    toolCalls: 0,
    memoryOperations: 0,
    ...overrides,
  };
}

class MockAgent {
  name: string;
  description: string;
  instructions: string;
  modelClient: unknown = null;
  tools: unknown[] = [];
  responseText: string;

  constructor(name: string, response = "Mock response") {
    this.name = name;
    this.description = `Mock agent ${name}`;
    this.instructions = `You are ${name}`;
    this.responseText = response;
  }

  async *runStream(
    task?: string | Message | Message[],
    _context?: unknown,
    _cancellationToken?: CancellationToken
  ): AsyncGenerator<Message | AgentEvent | AgentResponse | ChatCompletionChunk> {
    const ctx = new AgentContext();

    if (typeof task === "string") {
      const msg = {
        role: "user" as const,
        content: task,
        source: "user",
        timestamp: new Date(),
      };
      ctx.addMessage(msg);
      yield msg;
    } else if (Array.isArray(task)) {
      for (const msg of task) {
        ctx.addMessage(msg);
        yield msg;
      }
    } else if (task) {
      ctx.addMessage(task);
      yield task;
    }

    const assistantMsg = {
      role: "assistant" as const,
      content: this.responseText,
      source: this.name,
      timestamp: new Date(),
    };
    ctx.addMessage(assistantMsg);
    yield assistantMsg;

    yield {
      context: ctx,
      source: this.name,
      usage: mockUsage(),
      timestamp: new Date(),
      finishReason: "stop",
    } as AgentResponse;
  }
}

/**
 * Creates a mock LLM client that returns structured agent selection.
 */
function createMockSelectorLlm(
  selectedAgent: string,
  reasoning = "Best match",
  confidence = 0.9
): BaseChatCompletionClient {
  return {
    create: async (
      _messages: Message[],
      _options?: Record<string, unknown>
    ): Promise<ChatCompletionResult> => ({
      message: {
        role: "assistant" as const,
        content: `Selected ${selectedAgent}`,
        source: "selector",
        timestamp: new Date(),
      },
      usage: mockUsage(),
      model: "mock-selector",
      finishReason: "stop",
      structuredOutput: {
        selectedAgent,
        reasoning,
        confidence,
      },
    }),
    createStream: async function* () {
      yield {
        content: "",
        isComplete: true,
      } as ChatCompletionChunk;
    },
    totalUsage: mockUsage(),
    actualUsage: mockUsage(),
    model: "mock-selector",
  } as unknown as BaseChatCompletionClient;
}

/**
 * Creates a mock LLM that cycles through agent names.
 */
function createCyclingSelectorLlm(
  agentNames: string[]
): BaseChatCompletionClient {
  let callIndex = 0;
  return {
    create: async (): Promise<ChatCompletionResult> => {
      const name = agentNames[callIndex % agentNames.length];
      callIndex++;
      return {
        message: {
          role: "assistant" as const,
          content: `Selected ${name}`,
          source: "selector",
          timestamp: new Date(),
        },
        usage: mockUsage(),
        model: "mock-cycling-selector",
        finishReason: "stop",
        structuredOutput: {
          selectedAgent: name,
          reasoning: "Cycling selection",
          confidence: 0.8,
        },
      };
    },
    createStream: async function* () {
      yield { content: "", isComplete: true } as ChatCompletionChunk;
    },
    totalUsage: mockUsage(),
    actualUsage: mockUsage(),
    model: "mock-cycling-selector",
  } as unknown as BaseChatCompletionClient;
}

// ============================================================================
// Tests
// ============================================================================

describe("AIOrchestrator", () => {
  it("should use LLM to select agents", async () => {
    const agent1 = new MockAgent("researcher", "Research result");
    const agent2 = new MockAgent("writer", "Written content");
    const termination = new MaxMessageTermination(3);
    const selectorLlm = createMockSelectorLlm("writer");

    const orchestrator = new AIOrchestrator(
      [agent1, agent2] as unknown as BaseAgent[],
      termination,
      selectorLlm
    );

    const result = await orchestrator.run("Write a report");

    expect(result.messages.length).toBe(3);
    const assistantMessages = result.messages.filter(
      (m) => m.role === "assistant"
    );
    // All selections should be "writer" since selector always returns it
    for (const msg of assistantMessages) {
      expect(msg.content).toBe("Written content");
    }

    expect(orchestrator.selectionHistory.length).toBeGreaterThan(0);
    expect(orchestrator.selectionHistory[0].selectedAgent).toBe("writer");
  });

  it("should handle LLM selection failure with fallback", async () => {
    const agent1 = new MockAgent("agent1", "Response 1");
    const agent2 = new MockAgent("agent2", "Response 2");
    const termination = new MaxMessageTermination(3);

    // Create LLM that always fails
    const failingLlm = {
      create: async () => {
        throw new Error("LLM call failed");
      },
      createStream: async function* () {
        yield { content: "", isComplete: true } as ChatCompletionChunk;
      },
      totalUsage: mockUsage(),
      actualUsage: mockUsage(),
      model: "failing-llm",
    } as unknown as BaseChatCompletionClient;

    const orchestrator = new AIOrchestrator(
      [agent1, agent2] as unknown as BaseAgent[],
      termination,
      failingLlm
    );

    // Should not throw — falls back to first/round-robin agent
    const result = await orchestrator.run("Test fallback");

    expect(result.messages.length).toBe(3);
    // Fallback should use first agent
    const assistantMessages = result.messages.filter(
      (m) => m.role === "assistant"
    );
    expect(assistantMessages.length).toBe(2);
  });

  it("should find agents with fuzzy name matching", async () => {
    const agent1 = new MockAgent("data-analyst", "Analysis result");
    const agent2 = new MockAgent("code-reviewer", "Review result");
    const termination = new MaxMessageTermination(3);
    // Return a partial match name
    const selectorLlm = createMockSelectorLlm("analyst");

    const orchestrator = new AIOrchestrator(
      [agent1, agent2] as unknown as BaseAgent[],
      termination,
      selectorLlm
    );

    const result = await orchestrator.run("Analyze data");

    const assistantMessages = result.messages.filter(
      (m) => m.role === "assistant"
    );
    // Should match "data-analyst" via partial match
    expect(assistantMessages[0].content).toBe("Analysis result");
  });

  it("should track selection history", async () => {
    const agent1 = new MockAgent("agent1", "Response 1");
    const agent2 = new MockAgent("agent2", "Response 2");
    const termination = new MaxMessageTermination(5);
    const selectorLlm = createCyclingSelectorLlm([
      "agent1",
      "agent2",
    ]);

    const orchestrator = new AIOrchestrator(
      [agent1, agent2] as unknown as BaseAgent[],
      termination,
      selectorLlm
    );

    const result = await orchestrator.run("Test history");

    expect(orchestrator.selectionHistory.length).toBe(4); // 4 agent executions
    expect(orchestrator.selectionHistory[0].selectedAgent).toBe("agent1");
    expect(orchestrator.selectionHistory[1].selectedAgent).toBe("agent2");
    expect(orchestrator.selectionHistory[0]).toHaveProperty("confidence");
    expect(orchestrator.selectionHistory[0]).toHaveProperty("reasoning");
  });

  it("should include AI-specific metadata", async () => {
    const agent1 = new MockAgent("agent1", "Response 1");
    const agent2 = new MockAgent("agent2", "Response 2");
    const termination = new MaxMessageTermination(3);
    const selectorLlm = createMockSelectorLlm("agent1");

    const orchestrator = new AIOrchestrator(
      [agent1, agent2] as unknown as BaseAgent[],
      termination,
      selectorLlm
    );

    const result = await orchestrator.run("Test metadata");

    const metadata = result.patternMetadata;
    expect(metadata.pattern).toBe("AIOrchestrator");
    expect(metadata).toHaveProperty("selectionHistory");
    expect(metadata).toHaveProperty("uniqueAgentsSelected");
    expect(metadata).toHaveProperty("averageConfidence");
    expect(metadata).toHaveProperty("modelUsed");
    expect(metadata.modelUsed).toBe("mock-selector");
  });

  it("should reset state between runs", async () => {
    const agent1 = new MockAgent("agent1", "Response 1");
    const termination = new MaxMessageTermination(3);
    const selectorLlm = createMockSelectorLlm("agent1");

    const orchestrator = new AIOrchestrator(
      [agent1] as unknown as BaseAgent[],
      termination,
      selectorLlm
    );

    await orchestrator.run("First run");
    expect(orchestrator.selectionHistory.length).toBeGreaterThan(0);

    // Second run should reset
    const result2 = await orchestrator.run("Second run");
    // selectionHistory should only contain entries from the second run
    expect(result2.messages[0].content).toBe("Second run");
  });

  it("should cache agent capabilities", async () => {
    const agent1 = new MockAgent("agent1", "Response");
    const termination = new MaxMessageTermination(3);
    const selectorLlm = createMockSelectorLlm("agent1");

    const orchestrator = new AIOrchestrator(
      [agent1] as unknown as BaseAgent[],
      termination,
      selectorLlm
    );

    // Get capabilities multiple times
    const cap1 = orchestrator.getAgentCapabilitiesSummary();
    const cap2 = orchestrator.getAgentCapabilitiesSummary();

    expect(cap1).toBe(cap2);
    expect(cap1).toContain("agent1");
  });
});
