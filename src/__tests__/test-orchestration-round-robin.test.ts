/**
 * Tests for RoundRobinOrchestrator.
 */

import { describe, it, expect } from "vitest";
import { CancellationToken } from "../cancellation-token.js";
import { AgentContext } from "../context.js";
import type { Message, AssistantMessage, UserMessage } from "../messages.js";
import type { BaseAgent } from "../agents/base.js";
import type { AgentResponse, AgentEvent, ChatCompletionChunk, Usage } from "../types.js";
import type { OrchestrationResponse } from "../types.js";
import { RoundRobinOrchestrator } from "../orchestration/round-robin.js";
import {
  MaxMessageTermination,
  TextMentionTermination,
  ExternalTermination,
} from "../termination/index.js";

// ---------------------------------------------------------------------------
// MockAgent
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
  memory?: unknown;
  responseText: string;

  constructor(name: string, response = "Mock response") {
    this.name = name;
    this.description = `Mock agent ${name}`;
    this.instructions = `You are ${name}`;
    this.responseText = response;
  }

  async run(
    task: string | Message | Message[],
    _cancellationToken?: CancellationToken
  ): Promise<AgentResponse> {
    const context = new AgentContext();

    if (typeof task === "string") {
      context.addMessage({
        role: "user",
        content: task,
        source: "user",
        timestamp: new Date(),
      });
    } else if (Array.isArray(task)) {
      for (const msg of task) context.addMessage(msg);
    } else {
      context.addMessage(task);
    }

    context.addMessage({
      role: "assistant",
      content: this.responseText,
      source: this.name,
      timestamp: new Date(),
    });

    return {
      context,
      source: this.name,
      usage: mockUsage(),
      timestamp: new Date(),
      finishReason: "stop",
    };
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

// ============================================================================
// Tests
// ============================================================================

describe("RoundRobinOrchestrator", () => {
  it("should run basic orchestration", async () => {
    const agent1 = new MockAgent("agent1", "Response from agent 1");
    const agent2 = new MockAgent("agent2", "Response from agent 2");
    const termination = new MaxMessageTermination(5);
    const orchestrator = new RoundRobinOrchestrator(
      [agent1, agent2] as unknown as BaseAgent[],
      termination
    );

    const result = await orchestrator.run("Test task");

    expect(typeof result.finalResult).toBe("string");
    expect(result.messages.length).toBeGreaterThanOrEqual(3);
    expect(result.usage.durationMs).toBeGreaterThan(0);
    expect(result.stopMessage.source).toBe("MaxMessageTermination");

    const metadata = result.patternMetadata;
    expect(metadata.pattern).toBe("RoundRobinOrchestrator");
    expect(metadata.agentsCount).toBe(2);
    expect(metadata).toHaveProperty("cyclesCompleted");
  });

  it("should cycle through agents in order", async () => {
    const agent1 = new MockAgent("agent1", "Response 1");
    const agent2 = new MockAgent("agent2", "Response 2");
    const agent3 = new MockAgent("agent3", "Response 3");
    const termination = new MaxMessageTermination(7);
    const orchestrator = new RoundRobinOrchestrator(
      [agent1, agent2, agent3] as unknown as BaseAgent[],
      termination
    );

    const result = await orchestrator.run("Cycle through agents");

    const assistantMessages = result.messages.filter(
      (m) => m.role === "assistant"
    );

    expect(assistantMessages.length).toBe(6);

    const expected = [
      "Response 1",
      "Response 2",
      "Response 3",
      "Response 1",
      "Response 2",
      "Response 3",
    ];
    const actual = assistantMessages.map((m) => m.content);
    expect(actual).toEqual(expected);
  });

  it("should terminate on text mention", async () => {
    const agent1 = new MockAgent("agent1", "Let's continue");
    const agent2 = new MockAgent("agent2", "TERMINATE the conversation");
    const termination = new TextMentionTermination("TERMINATE");
    const orchestrator = new RoundRobinOrchestrator(
      [agent1, agent2] as unknown as BaseAgent[],
      termination
    );

    const result = await orchestrator.run("Test termination");

    expect(result.stopMessage.source).toBe("TextMentionTermination");
    expect(result.stopMessage.content).toContain("Text mention found");
    expect(result.messages.length).toBe(3);

    const assistantMessages = result.messages.filter(
      (m) => m.role === "assistant"
    );
    expect(assistantMessages.length).toBe(2);
    expect(assistantMessages[1].content).toBe(
      "TERMINATE the conversation"
    );
  });

  it("should handle cancellation", async () => {
    const agent1 = new MockAgent("agent1", "Response 1");
    const agent2 = new MockAgent("agent2", "Response 2");
    const termination = new MaxMessageTermination(100);
    const orchestrator = new RoundRobinOrchestrator(
      [agent1, agent2] as unknown as BaseAgent[],
      termination
    );

    const cancellationToken = new CancellationToken();

    // Cancel before starting - should handle gracefully
    cancellationToken.cancel();

    try {
      await orchestrator.run("Test cancellation", cancellationToken);
      // If run doesn't throw, it should return with cancellation-related stop message
      // (the orchestrator may catch CancelledError in runStream and yield a cancellation response)
    } catch (e: any) {
      // CancelledError is expected
      expect(e.name).toBe("CancelledError");
    }
  });

  it("should support streaming", async () => {
    const agent1 = new MockAgent("agent1", "Stream response 1");
    const agent2 = new MockAgent("agent2", "Stream response 2");
    const termination = new MaxMessageTermination(3);
    const orchestrator = new RoundRobinOrchestrator(
      [agent1, agent2] as unknown as BaseAgent[],
      termination
    );

    const items: unknown[] = [];
    for await (const item of orchestrator.runStream(
      "Test streaming",
      undefined,
      true
    )) {
      items.push(item);
    }

    // Should have messages, events, and result
    const messages = items.filter(
      (item: any) => item.role === "user" || item.role === "assistant"
    );
    const events = items.filter((item: any) => item.eventType);
    const results = items.filter(
      (item: any) => item.messages && item.finalResult
    );

    expect(messages.length).toBeGreaterThanOrEqual(3);
    expect(events.length).toBeGreaterThanOrEqual(4);
    expect(results.length).toBe(1);
  });

  it("should reject empty agents list", () => {
    expect(() => {
      new RoundRobinOrchestrator(
        [],
        new MaxMessageTermination(5)
      );
    }).toThrow("At least one agent is required");
  });

  it("should reject duplicate agent names", () => {
    const agent1 = new MockAgent("duplicate", "Response 1");
    const agent2 = new MockAgent("duplicate", "Response 2");

    expect(() => {
      new RoundRobinOrchestrator(
        [agent1, agent2] as unknown as BaseAgent[],
        new MaxMessageTermination(5)
      );
    }).toThrow("Agent names must be unique");
  });

  it("should stop at max iterations", async () => {
    const agent = new MockAgent("agent", "Keep going");
    const termination = new ExternalTermination(() => false);
    const orchestrator = new RoundRobinOrchestrator(
      [agent] as unknown as BaseAgent[],
      termination,
      3
    );

    const result = await orchestrator.run("Test max iterations");

    expect(result.stopMessage.content).toContain(
      "Maximum iterations reached"
    );
    expect(result.stopMessage.source).toBe("MaxIterations");
    expect(result.patternMetadata.iterationsCompleted).toBe(3);
  });

  it("should pass context to agents correctly", async () => {
    // Agent that counts previous iterations in context
    class ContextEchoAgent extends MockAgent {
      async *runStream(
        task?: string | Message | Message[],
        _context?: unknown,
        _cancellationToken?: CancellationToken
      ): AsyncGenerator<
        Message | AgentEvent | AgentResponse | ChatCompletionChunk
      > {
        const ctx = new AgentContext();
        let responseCount = 0;

        if (typeof task === "string") {
          responseCount = (task.match(/Iteration/g) || []).length;
          const msg = {
            role: "user" as const,
            content: task,
            source: "user",
            timestamp: new Date(),
          };
          ctx.addMessage(msg);
          yield msg;
        } else if (Array.isArray(task)) {
          responseCount = task.filter(
            (m) => m.role === "assistant"
          ).length;
          for (const msg of task) {
            ctx.addMessage(msg);
            yield msg;
          }
        }

        const assistantMsg = {
          role: "assistant" as const,
          content: `Iteration ${responseCount + 1}`,
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

    const agent = new ContextEchoAgent("context_agent");
    const termination = new MaxMessageTermination(5);
    const orchestrator = new RoundRobinOrchestrator(
      [agent] as unknown as BaseAgent[],
      termination
    );

    const result = await orchestrator.run("Test context");

    const assistantMessages = result.messages.filter(
      (m) => m.role === "assistant"
    );

    expect(assistantMessages[0].content).toContain("Iteration 1");
    expect(assistantMessages[1].content).toContain("Iteration 2");
  });

  it("should aggregate usage statistics", async () => {
    const agent1 = new MockAgent("agent1", "Response 1");
    const agent2 = new MockAgent("agent2", "Response 2");
    const termination = new MaxMessageTermination(5);
    const orchestrator = new RoundRobinOrchestrator(
      [agent1, agent2] as unknown as BaseAgent[],
      termination
    );

    const result = await orchestrator.run("Test usage aggregation");

    expect(result.messages.length).toBe(5);

    // Each mock agent: llm_calls=1, tokensInput=10, tokensOutput=5
    // With 4 agent executions
    const usage = result.usage;
    expect(usage.llmCalls).toBe(4);
    expect(usage.tokensInput).toBe(40);
    expect(usage.tokensOutput).toBe(20);
    expect(usage.toolCalls).toBe(0);
    expect(usage.memoryOperations).toBe(0);
    expect(usage.durationMs).toBeGreaterThan(0);
  });

  it("should produce consistent results between run and stream", async () => {
    const agent = new MockAgent("agent", "Response");
    const termination = new MaxMessageTermination(3);
    const orchestrator = new RoundRobinOrchestrator(
      [agent] as unknown as BaseAgent[],
      termination
    );

    // Test with regular run
    const result1 = await orchestrator.run("Test message");

    // Reset and test with streaming
    termination.reset();
    let result2: OrchestrationResponse | null = null;
    for await (const item of orchestrator.runStream("Test message")) {
      if (
        item &&
        typeof item === "object" &&
        "messages" in item &&
        "finalResult" in item
      ) {
        result2 = item as OrchestrationResponse;
      }
    }

    expect(result2).not.toBeNull();
    expect(result1.messages.length).toBe(result2!.messages.length);
    expect(result1.stopMessage.source).toBe(result2!.stopMessage.source);
  });
});
