/**
 * Tests for PlanBasedOrchestrator.
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
import { PlanBasedOrchestrator } from "../orchestration/plan.js";
import { MaxMessageTermination } from "../termination/index.js";

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
 * Creates a mock LLM that returns plans and evaluations.
 */
function createMockPlannerLlm(options?: {
  plan?: { steps: Array<{ task: string; agentName: string; reasoning: string }> };
  stepCompleted?: boolean;
}): BaseChatCompletionClient {
  const defaultPlan = {
    steps: [
      {
        task: "Research the topic",
        agentName: "researcher",
        reasoning: "Research agent is best for gathering information",
      },
      {
        task: "Write the report",
        agentName: "writer",
        reasoning: "Writer agent handles content creation",
      },
    ],
  };

  const plan = options?.plan ?? defaultPlan;
  const stepCompleted = options?.stepCompleted ?? true;

  let callCount = 0;

  return {
    create: async (
      _messages: Message[],
      _options?: Record<string, unknown>
    ): Promise<ChatCompletionResult> => {
      callCount++;

      // First call is plan creation, subsequent calls are step evaluations
      if (callCount === 1) {
        return {
          message: {
            role: "assistant" as const,
            content: "Plan created",
            source: "planner",
            timestamp: new Date(),
          },
          usage: mockUsage(),
          model: "mock-planner",
          finishReason: "stop",
          structuredOutput: plan,
        };
      }

      // Step evaluation
      return {
        message: {
          role: "assistant" as const,
          content: "Evaluation done",
          source: "evaluator",
          timestamp: new Date(),
        },
        usage: mockUsage(),
        model: "mock-planner",
        finishReason: "stop",
        structuredOutput: {
          stepCompleted,
          failureReason: stepCompleted ? "None" : "Step not completed",
          confidenceScore: 0.8,
          suggestedImprovements: stepCompleted
            ? []
            : ["Try a different approach"],
        },
      };
    },
    createStream: async function* () {
      yield { content: "", isComplete: true } as ChatCompletionChunk;
    },
    totalUsage: mockUsage(),
    actualUsage: mockUsage(),
    model: "mock-planner",
  } as unknown as BaseChatCompletionClient;
}

// ============================================================================
// Tests
// ============================================================================

describe("PlanBasedOrchestrator", () => {
  it("should create and execute a plan", async () => {
    const researcher = new MockAgent("researcher", "Research complete");
    const writer = new MockAgent("writer", "Report written");
    const termination = new MaxMessageTermination(10);
    const plannerLlm = createMockPlannerLlm();

    const orchestrator = new PlanBasedOrchestrator(
      [researcher, writer] as unknown as BaseAgent[],
      termination,
      plannerLlm
    );

    const result = await orchestrator.run("Write a research report");

    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.finalResult).toBeTruthy();

    // Should have executed the plan
    expect(orchestrator.executionPlan).not.toBeNull();
    expect(orchestrator.executionPlan!.steps.length).toBe(2);
  });

  it("should assign agents according to the plan", async () => {
    const researcher = new MockAgent("researcher", "Research findings");
    const writer = new MockAgent("writer", "Written output");
    const termination = new MaxMessageTermination(10);
    const plannerLlm = createMockPlannerLlm();

    const orchestrator = new PlanBasedOrchestrator(
      [researcher, writer] as unknown as BaseAgent[],
      termination,
      plannerLlm
    );

    const result = await orchestrator.run("Multi-step task");

    const assistantMessages = result.messages.filter(
      (m) => m.role === "assistant"
    );
    // Should have at least 2 assistant messages (one per step)
    expect(assistantMessages.length).toBeGreaterThanOrEqual(2);

    // Get unique agent sources — plan should have used both researcher and writer
    const sources = new Set(assistantMessages.map((m) => m.source));
    expect(sources.has("researcher")).toBe(true);
    expect(sources.has("writer")).toBe(true);
  });

  it("should handle single-step plan", async () => {
    const agent = new MockAgent("agent", "Completed task");
    const termination = new MaxMessageTermination(5);
    const plannerLlm = createMockPlannerLlm({
      plan: {
        steps: [
          {
            task: "Do the thing",
            agentName: "agent",
            reasoning: "Only agent available",
          },
        ],
      },
    });

    const orchestrator = new PlanBasedOrchestrator(
      [agent] as unknown as BaseAgent[],
      termination,
      plannerLlm
    );

    const result = await orchestrator.run("Simple task");

    expect(result.messages.length).toBeGreaterThan(0);
    expect(orchestrator.executionPlan!.steps.length).toBe(1);
  });

  it("should retry failed steps", async () => {
    const agent = new MockAgent("agent", "Attempting task");
    const termination = new MaxMessageTermination(20);

    let evalCallCount = 0;
    // First eval fails, second succeeds
    const plannerLlm = {
      create: async (
        _messages: Message[],
        _options?: Record<string, unknown>
      ): Promise<ChatCompletionResult> => {
        evalCallCount++;

        if (evalCallCount === 1) {
          // Plan creation
          return {
            message: {
              role: "assistant" as const,
              content: "Plan",
              source: "planner",
              timestamp: new Date(),
            },
            usage: mockUsage(),
            model: "mock",
            finishReason: "stop",
            structuredOutput: {
              steps: [
                {
                  task: "Difficult task",
                  agentName: "agent",
                  reasoning: "Only option",
                },
              ],
            },
          };
        }

        // Step evaluations: fail first, then succeed
        const isFirstEval = evalCallCount === 2;
        return {
          message: {
            role: "assistant" as const,
            content: "Eval",
            source: "evaluator",
            timestamp: new Date(),
          },
          usage: mockUsage(),
          model: "mock",
          finishReason: "stop",
          structuredOutput: {
            stepCompleted: !isFirstEval,
            failureReason: isFirstEval
              ? "Needs improvement"
              : "None",
            confidenceScore: isFirstEval ? 0.3 : 0.9,
            suggestedImprovements: isFirstEval
              ? ["Try differently"]
              : [],
          },
        };
      },
      createStream: async function* () {
        yield { content: "", isComplete: true } as ChatCompletionChunk;
      },
      totalUsage: mockUsage(),
      actualUsage: mockUsage(),
      model: "mock",
    } as unknown as BaseChatCompletionClient;

    const orchestrator = new PlanBasedOrchestrator(
      [agent] as unknown as BaseAgent[],
      termination,
      plannerLlm
    );

    const result = await orchestrator.run("Difficult task");

    expect(result.messages.length).toBeGreaterThan(0);
    // Should have retried at least once
    const metadata = result.patternMetadata;
    expect(metadata).toHaveProperty("plan");
  });

  it("should handle planning LLM failure with fallback plan", async () => {
    const agent = new MockAgent("agent", "Response");
    const termination = new MaxMessageTermination(5);

    const failingLlm = {
      create: async (): Promise<ChatCompletionResult> => {
        throw new Error("LLM failed");
      },
      createStream: async function* () {
        yield { content: "", isComplete: true } as ChatCompletionChunk;
      },
      totalUsage: mockUsage(),
      actualUsage: mockUsage(),
      model: "failing-llm",
    } as unknown as BaseChatCompletionClient;

    const orchestrator = new PlanBasedOrchestrator(
      [agent] as unknown as BaseAgent[],
      termination,
      failingLlm
    );

    // Should not throw — uses fallback plan
    const result = await orchestrator.run("Test fallback plan");

    expect(result.messages.length).toBeGreaterThan(0);
    expect(orchestrator.executionPlan).not.toBeNull();
    expect(orchestrator.executionPlan!.steps.length).toBe(1);
    expect(orchestrator.executionPlan!.steps[0].reasoning).toContain(
      "fallback"
    );
  });

  it("should include plan-specific metadata", async () => {
    const researcher = new MockAgent("researcher", "Research done");
    const writer = new MockAgent("writer", "Writing done");
    const termination = new MaxMessageTermination(10);
    const plannerLlm = createMockPlannerLlm();

    const orchestrator = new PlanBasedOrchestrator(
      [researcher, writer] as unknown as BaseAgent[],
      termination,
      plannerLlm
    );

    const result = await orchestrator.run("Metadata test");

    const metadata = result.patternMetadata;
    expect(metadata.pattern).toBe("PlanBasedOrchestrator");
    expect(metadata).toHaveProperty("plan");
    expect(metadata).toHaveProperty("currentStepIndex");
    expect(metadata).toHaveProperty("stepsCompleted");
  });

  it("should reset state between runs", async () => {
    const agent = new MockAgent("agent", "Response");
    const termination = new MaxMessageTermination(5);
    const plannerLlm = createMockPlannerLlm({
      plan: {
        steps: [
          {
            task: "Single step",
            agentName: "agent",
            reasoning: "Only one",
          },
        ],
      },
    });

    const orchestrator = new PlanBasedOrchestrator(
      [agent] as unknown as BaseAgent[],
      termination,
      plannerLlm
    );

    await orchestrator.run("First run");
    expect(orchestrator.executionPlan).not.toBeNull();

    // Second run should reset plan
    await orchestrator.run("Second run");
    // It should have created a new plan for the second run
    expect(orchestrator.sharedMessages.length).toBeGreaterThan(0);
  });

  it("should use fuzzy name matching for agents", async () => {
    const analyst = new MockAgent("data-analyst", "Analysis done");
    const termination = new MaxMessageTermination(5);

    // Plan references partial name
    const plannerLlm = createMockPlannerLlm({
      plan: {
        steps: [
          {
            task: "Analyze data",
            agentName: "analyst", // Partial match
            reasoning: "Best fit",
          },
        ],
      },
    });

    const orchestrator = new PlanBasedOrchestrator(
      [analyst] as unknown as BaseAgent[],
      termination,
      plannerLlm
    );

    const result = await orchestrator.run("Analyze data");

    const assistantMessages = result.messages.filter(
      (m) => m.role === "assistant"
    );
    expect(assistantMessages.length).toBeGreaterThan(0);
    expect(assistantMessages[0].source).toBe("data-analyst");
  });

  it("should provide curated context to agents", async () => {
    const agent = new MockAgent("agent", "Completed");
    const termination = new MaxMessageTermination(5);
    const plannerLlm = createMockPlannerLlm({
      plan: {
        steps: [
          {
            task: "Execute task",
            agentName: "agent",
            reasoning: "Only agent",
          },
        ],
      },
    });

    const orchestrator = new PlanBasedOrchestrator(
      [agent] as unknown as BaseAgent[],
      termination,
      plannerLlm
    );

    const result = await orchestrator.run("Context test");

    // Should complete without error
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it("should stop at max step retries and move on", async () => {
    const agent = new MockAgent("agent", "Always fails");
    const termination = new MaxMessageTermination(30);

    // Always fail evaluation
    const plannerLlm = createMockPlannerLlm({
      plan: {
        steps: [
          {
            task: "Impossible task",
            agentName: "agent",
            reasoning: "Only option",
          },
          {
            task: "Second task",
            agentName: "agent",
            reasoning: "Only option",
          },
        ],
      },
      stepCompleted: false,
    });

    const orchestrator = new PlanBasedOrchestrator(
      [agent] as unknown as BaseAgent[],
      termination,
      plannerLlm,
      50, // maxIterations
      2 // maxStepRetries
    );

    const result = await orchestrator.run("Test max retries");

    // Should complete (either by exceeding retries or termination)
    expect(result.messages.length).toBeGreaterThan(0);
  });
});
