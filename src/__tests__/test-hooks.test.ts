/**
 * Tests for the deterministic loop hooks system.
 *
 * Tests cover:
 * 1. No hooks - identical behavior to before
 * 2. Start hook injection before first LLM call
 * 3. End hook allows stop when all todos complete
 * 4. End hook resumes loop when todos incomplete
 * 5. Max restarts terminates even with incomplete todos
 * 6. Multiple start hooks chained
 * 7. Custom hooks via base class
 * 8. TerminationCondition composition (.or() and .and())
 * 9. Full trajectory message ordering
 */

import { describe, it, expect } from "vitest";

import {
  BaseStartHook,
  BaseEndHook,
  CompletionCheckHook,
  PlanningHook,
  TerminationCondition,
  MaxRestartsTermination,
  CompositeTermination,
  type LoopContext,
} from "../hooks.js";
import { AgentContext } from "../context.js";
import { Agent } from "../agents/agent.js";
import { BaseChatCompletionClient } from "../llm/base.js";
import type {
  ChatCompletionResult,
  ChatCompletionChunk,
  Usage,
  ToolResult,
  AgentResponse,
} from "../types.js";
import { BaseTool } from "../tools/base.js";
import type {
  Message,
  AssistantMessage,
  UserMessage,
  ToolCallRequest,
} from "../messages.js";

// === Test Fixtures ===

function mockUsage(): Usage {
  return {
    durationMs: 10,
    llmCalls: 1,
    tokensInput: 50,
    tokensOutput: 25,
    toolCalls: 0,
    memoryOperations: 0,
  };
}

class MockClient extends BaseChatCompletionClient {
  responses: AssistantMessage[] = [];
  callCount = 0;
  receivedMessages: Message[][] = [];

  constructor() {
    super("test-model");
  }

  setResponses(responses: AssistantMessage[]) {
    this.responses = [...responses];
  }

  async create(
    messages: Message[],
    _options?: Record<string, unknown>
  ): Promise<ChatCompletionResult> {
    this.callCount++;
    this.receivedMessages.push([...messages]);

    const response: AssistantMessage = this.responses.length
      ? this.responses.shift()!
      : {
          role: "assistant" as const,
          content: "Done",
          source: "mock",
          timestamp: new Date(),
        };

    return {
      message: response,
      model: "test-model",
      finishReason: "stop",
      usage: mockUsage(),
    };
  }

  async *createStream(
    messages: Message[],
    _options?: Record<string, unknown>
  ): AsyncGenerator<ChatCompletionChunk, void, undefined> {
    const result = await this.create(messages);
    yield {
      content: result.message.content || "",
      isComplete: true,
    };
  }
}

class MockTool extends BaseTool {
  callCount = 0;

  constructor(toolName = "mock_tool") {
    super(toolName, `Mock tool: ${toolName}`);
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        input: { type: "string", description: "Input" },
      },
      required: ["input"],
    };
  }

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    this.callCount++;
    return {
      success: true,
      result: `result: ${params.input ?? ""}`,
    };
  }
}

function makeAgent(
  client: MockClient,
  options?: {
    tools?: BaseTool[];
    startHooks?: BaseStartHook[];
    endHooks?: BaseEndHook[];
    maxIterations?: number;
  }
): Agent {
  return new Agent({
    name: "test_agent",
    description: "Test agent",
    instructions: "You are a test assistant.",
    modelClient: client,
    tools: options?.tools ?? [],
    startHooks: options?.startHooks ?? [],
    endHooks: options?.endHooks ?? [],
    maxIterations: options?.maxIterations ?? 10,
  });
}

function makeAssistantMessage(content: string): AssistantMessage {
  return {
    role: "assistant" as const,
    content,
    source: "mock",
    timestamp: new Date(),
  };
}

function toolCallResponse(
  toolName: string,
  args: Record<string, unknown>,
  callId = "call_1"
): AssistantMessage {
  return {
    role: "assistant" as const,
    content: "",
    source: "mock",
    timestamp: new Date(),
    toolCalls: [
      {
        toolName,
        parameters: args,
        callId,
      },
    ],
  };
}

function makeLoopContext(overrides?: Partial<LoopContext>): LoopContext {
  return {
    agentContext: new AgentContext(),
    llmMessages: [],
    agentName: "test",
    iteration: 0,
    restartCount: 0,
    metadata: {},
    ...overrides,
  };
}

function getMessages(response: AgentResponse): Message[] {
  return response.context?.messages ?? [];
}

// =============================================================================
// Test 1: No hooks - identical behavior to before
// =============================================================================

describe("TestNoHooks", () => {
  it("simple response without hooks", async () => {
    const client = new MockClient();
    client.setResponses([makeAssistantMessage("Hello world")]);
    const agent = makeAgent(client);

    const result = await agent.run("Hi");

    expect(result).toBeDefined();
    expect(result.finishReason).toBeDefined();
    expect(client.callCount).toBe(1);

    const msgs = getMessages(result);
    const assistantMsgs = msgs.filter((m) => m.role === "assistant");
    expect(assistantMsgs.length).toBeGreaterThanOrEqual(1);
    expect(assistantMsgs[0].content).toBe("Hello world");
  });

  it("tool loop without hooks", async () => {
    const client = new MockClient();
    const tool = new MockTool();
    client.setResponses([
      toolCallResponse("mock_tool", { input: "test" }),
      makeAssistantMessage("Tool result processed"),
    ]);
    const agent = makeAgent(client, { tools: [tool] });

    await agent.run("Use the tool");

    expect(client.callCount).toBe(2);
    expect(tool.callCount).toBe(1);
  });

  it("no hook messages in context without hooks", async () => {
    const client = new MockClient();
    client.setResponses([makeAssistantMessage("Done")]);
    const agent = makeAgent(client);

    const result = await agent.run("Hello");

    const msgs = getMessages(result);
    const hookMsgs = msgs.filter((m) => m.source === "hook");
    expect(hookMsgs.length).toBe(0);
  });
});

// =============================================================================
// Test 2: Start hook injection
// =============================================================================

describe("TestStartHook", () => {
  it("PlanningHook injects message before LLM call", async () => {
    const client = new MockClient();
    client.setResponses([makeAssistantMessage("I'll create a plan")]);
    const agent = makeAgent(client, { startHooks: [new PlanningHook()] });

    await agent.run("Build a website");

    expect(client.callCount).toBe(1);
    const firstCallMessages = client.receivedMessages[0];

    const hookMsgs = firstCallMessages.filter((m) => m.source === "hook");
    expect(hookMsgs.length).toBe(1);
    expect(hookMsgs[0].content.toLowerCase()).toContain("todo");
  });

  it("PlanningHook with custom instruction uses that text", async () => {
    const customText = "ALWAYS think step by step.";
    const client = new MockClient();
    client.setResponses([makeAssistantMessage("OK")]);
    const agent = makeAgent(client, {
      startHooks: [new PlanningHook(customText)],
    });

    await agent.run("Do something");

    const firstCallMessages = client.receivedMessages[0];
    const hookMsgs = firstCallMessages.filter((m) => m.source === "hook");
    expect(hookMsgs.length).toBe(1);
    expect(hookMsgs[0].content).toBe(customText);
  });

  it("start hook returning undefined does not inject", async () => {
    class NullStartHook extends BaseStartHook {
      async onStart(_context: LoopContext): Promise<string | undefined> {
        return undefined;
      }
    }

    const client = new MockClient();
    client.setResponses([makeAssistantMessage("OK")]);
    const agent = makeAgent(client, { startHooks: [new NullStartHook()] });

    await agent.run("Hello");

    const firstCallMessages = client.receivedMessages[0];
    const hookMsgs = firstCallMessages.filter((m) => m.source === "hook");
    expect(hookMsgs.length).toBe(0);
  });
});

// =============================================================================
// Test 3: End hook - all todos complete, should NOT resume
// =============================================================================

describe("TestEndHookAllComplete", () => {
  it("all todos complete allows stop", async () => {
    const allComplete = [
      { content: "Task A", status: "completed", activeForm: "Doing A" },
      { content: "Task B", status: "completed", activeForm: "Doing B" },
    ];

    const client = new MockClient();
    client.setResponses([makeAssistantMessage("All done!")]);

    // Create an end hook that reads from metadata.todos
    const hook = new CompletionCheckHook({ maxRestarts: 2 });
    const agent = makeAgent(client, { endHooks: [hook] });

    // Inject todos into the agent's context metadata via a custom start hook
    class InjectTodosHook extends BaseStartHook {
      async onStart(context: LoopContext): Promise<string | undefined> {
        context.metadata.todos = allComplete;
        return undefined;
      }
    }

    const agentWithTodos = makeAgent(client, {
      startHooks: [new InjectTodosHook()],
      endHooks: [hook],
    });

    const result = await agentWithTodos.run("Do tasks");
    expect(client.callCount).toBe(1);
  });

  it("no todos allows stop", async () => {
    const client = new MockClient();
    client.setResponses([makeAssistantMessage("Done")]);

    // Without any todos in metadata, the hook should allow stop
    const hook = new CompletionCheckHook({ maxRestarts: 2 });
    const agent = makeAgent(client, { endHooks: [hook] });

    await agent.run("Hello");
    expect(client.callCount).toBe(1);
  });
});

// =============================================================================
// Test 4: End hook with incomplete todos - verify resume
// =============================================================================

describe("TestEndHookResume", () => {
  it("incomplete todos resume loop", async () => {
    const incompleteTodos = [
      { content: "Task A", status: "completed", activeForm: "Doing A" },
      { content: "Task B", status: "pending", activeForm: "Doing B" },
    ];

    const client = new MockClient();
    client.setResponses([
      makeAssistantMessage("I think I'm done"),
      makeAssistantMessage("Now I'm really done"),
      makeAssistantMessage("Final answer"),
    ]);

    class InjectTodosHook extends BaseStartHook {
      async onStart(context: LoopContext): Promise<string | undefined> {
        context.metadata.todos = incompleteTodos;
        return undefined;
      }
    }

    const hook = new CompletionCheckHook({ maxRestarts: 2 });
    const agent = makeAgent(client, {
      startHooks: [new InjectTodosHook()],
      endHooks: [hook],
    });

    await agent.run("Do tasks");

    // 1 initial + 2 restarts = 3 total
    expect(client.callCount).toBe(3);
  });

  it("resume message contains incomplete task info", async () => {
    const incompleteTodos = [
      {
        content: "Write tests",
        status: "pending",
        activeForm: "Writing tests",
      },
    ];

    const client = new MockClient();
    client.setResponses([
      makeAssistantMessage("Stopping"),
      makeAssistantMessage("OK continuing"),
      makeAssistantMessage("Done now"),
    ]);

    class InjectTodosHook extends BaseStartHook {
      async onStart(context: LoopContext): Promise<string | undefined> {
        context.metadata.todos = incompleteTodos;
        return undefined;
      }
    }

    const hook = new CompletionCheckHook({ maxRestarts: 2 });
    const agent = makeAgent(client, {
      startHooks: [new InjectTodosHook()],
      endHooks: [hook],
    });

    await agent.run("Work");

    // Check that second LLM call received a hook resume message
    const secondCall = client.receivedMessages[1];
    const hookMsgs = secondCall.filter((m) => m.source === "hook");
    expect(hookMsgs.length).toBeGreaterThanOrEqual(1);

    const resumeText = hookMsgs[hookMsgs.length - 1].content;
    expect(resumeText).toContain("Write tests");
    expect(resumeText.toLowerCase()).toContain("incomplete");
  });
});

// =============================================================================
// Test 5: Max restarts exceeded - agent stops
// =============================================================================

describe("TestMaxRestarts", () => {
  it("max restarts terminates even with incomplete todos", async () => {
    const alwaysIncomplete = [
      { content: "Never done", status: "pending", activeForm: "Never doing" },
    ];

    const client = new MockClient();
    client.setResponses([
      makeAssistantMessage("Try 1"),
      makeAssistantMessage("Try 2"),
    ]);

    class InjectTodosHook extends BaseStartHook {
      async onStart(context: LoopContext): Promise<string | undefined> {
        context.metadata.todos = alwaysIncomplete;
        return undefined;
      }
    }

    const hook = new CompletionCheckHook({ maxRestarts: 1 });
    const agent = makeAgent(client, {
      startHooks: [new InjectTodosHook()],
      endHooks: [hook],
    });

    await agent.run("Do the impossible");

    expect(client.callCount).toBe(2);
  });

  it("zero restarts means no resume", async () => {
    const incomplete = [
      { content: "Task", status: "pending", activeForm: "Doing" },
    ];

    const client = new MockClient();
    client.setResponses([makeAssistantMessage("Done")]);

    class InjectTodosHook extends BaseStartHook {
      async onStart(context: LoopContext): Promise<string | undefined> {
        context.metadata.todos = incomplete;
        return undefined;
      }
    }

    const hook = new CompletionCheckHook({ maxRestarts: 0 });
    const agent = makeAgent(client, {
      startHooks: [new InjectTodosHook()],
      endHooks: [hook],
    });

    await agent.run("Work");

    expect(client.callCount).toBe(1);
  });

  it("restarts do not exceed max iterations", async () => {
    const incomplete = [
      {
        content: "Infinite task",
        status: "pending",
        activeForm: "Doing",
      },
    ];

    const client = new MockClient();
    const responses: AssistantMessage[] = [];
    for (let i = 0; i < 20; i++) {
      responses.push(makeAssistantMessage(`Attempt ${i}`));
    }
    client.setResponses(responses);

    class InjectTodosHook extends BaseStartHook {
      async onStart(context: LoopContext): Promise<string | undefined> {
        context.metadata.todos = incomplete;
        return undefined;
      }
    }

    const hook = new CompletionCheckHook({ maxRestarts: 100 });
    const agent = makeAgent(client, {
      startHooks: [new InjectTodosHook()],
      endHooks: [hook],
      maxIterations: 5,
    });

    await agent.run("Work forever");

    expect(client.callCount).toBeLessThanOrEqual(5);
  });
});

// =============================================================================
// Test 6: Multiple start hooks chained
// =============================================================================

describe("TestMultipleStartHooks", () => {
  it("two start hooks both inject their messages", async () => {
    class HookA extends BaseStartHook {
      async onStart(_context: LoopContext): Promise<string | undefined> {
        return "HOOK_A_INJECTION";
      }
    }

    class HookB extends BaseStartHook {
      async onStart(_context: LoopContext): Promise<string | undefined> {
        return "HOOK_B_INJECTION";
      }
    }

    const client = new MockClient();
    client.setResponses([makeAssistantMessage("OK")]);
    const agent = makeAgent(client, {
      startHooks: [new HookA(), new HookB()],
    });

    await agent.run("Test");

    const firstCall = client.receivedMessages[0];
    const hookMsgs = firstCall.filter((m) => m.source === "hook");
    expect(hookMsgs.length).toBe(2);
    expect(hookMsgs[0].content).toBe("HOOK_A_INJECTION");
    expect(hookMsgs[1].content).toBe("HOOK_B_INJECTION");
  });

  it("undefined-returning hook does not prevent others from injecting", async () => {
    class NullHook extends BaseStartHook {
      async onStart(_context: LoopContext): Promise<string | undefined> {
        return undefined;
      }
    }

    class InjectHook extends BaseStartHook {
      async onStart(_context: LoopContext): Promise<string | undefined> {
        return "INJECTED";
      }
    }

    const client = new MockClient();
    client.setResponses([makeAssistantMessage("OK")]);
    const agent = makeAgent(client, {
      startHooks: [new NullHook(), new InjectHook()],
    });

    await agent.run("Test");

    const firstCall = client.receivedMessages[0];
    const hookMsgs = firstCall.filter((m) => m.source === "hook");
    expect(hookMsgs.length).toBe(1);
    expect(hookMsgs[0].content).toBe("INJECTED");
  });
});

// =============================================================================
// Test 7: Custom hooks - base class extensibility
// =============================================================================

describe("TestCustomHooks", () => {
  it("custom start hook can use loop context metadata", async () => {
    const callLog: string[] = [];

    class LoggingStartHook extends BaseStartHook {
      async onStart(context: LoopContext): Promise<string | undefined> {
        callLog.push(`start:${context.agentName}`);
        context.metadata.started = true;
        return "Custom start instruction";
      }
    }

    const client = new MockClient();
    client.setResponses([makeAssistantMessage("OK")]);
    const agent = makeAgent(client, {
      startHooks: [new LoggingStartHook()],
    });

    await agent.run("Test");

    expect(callLog).toEqual(["start:test_agent"]);
  });

  it("custom end hook can decide whether to resume based on context", async () => {
    let resumeCount = 0;

    class CountingEndHook extends BaseEndHook {
      async onEnd(context: LoopContext): Promise<string | undefined> {
        if (context.restartCount < 2) {
          resumeCount++;
          return `Keep going (restart ${context.restartCount})`;
        }
        return undefined;
      }
    }

    const client = new MockClient();
    client.setResponses([
      makeAssistantMessage("Try 1"),
      makeAssistantMessage("Try 2"),
      makeAssistantMessage("Try 3"),
    ]);
    const agent = makeAgent(client, { endHooks: [new CountingEndHook()] });

    await agent.run("Work");

    expect(resumeCount).toBe(2);
    expect(client.callCount).toBe(3);
  });

  it("first end hook returning non-undefined wins", async () => {
    const hookCalls: string[] = [];

    class HookA extends BaseEndHook {
      async onEnd(_context: LoopContext): Promise<string | undefined> {
        hookCalls.push("A");
        return "Resume from A";
      }
    }

    class HookB extends BaseEndHook {
      async onEnd(_context: LoopContext): Promise<string | undefined> {
        hookCalls.push("B");
        return "Resume from B";
      }
    }

    const client = new MockClient();
    client.setResponses([
      makeAssistantMessage("First"),
      makeAssistantMessage("Second"),
      makeAssistantMessage("Third"),
    ]);

    const agent = makeAgent(client, {
      endHooks: [new HookA(), new HookB()],
      maxIterations: 3,
    });

    await agent.run("Test");

    // Hook B should never be called because A always returns non-undefined first
    expect(hookCalls.every((h) => h === "A")).toBe(true);
    expect(hookCalls).not.toContain("B");
  });
});

// =============================================================================
// Test 8: TerminationCondition composition
// =============================================================================

describe("TestTerminationConditions", () => {
  it("MaxRestartsTermination terminates at the threshold", () => {
    const ctx = makeLoopContext();
    const cond = new MaxRestartsTermination(3);

    ctx.restartCount = 0;
    expect(cond.shouldTerminate(ctx)).toBe(false);

    ctx.restartCount = 2;
    expect(cond.shouldTerminate(ctx)).toBe(false);

    ctx.restartCount = 3;
    expect(cond.shouldTerminate(ctx)).toBe(true);

    ctx.restartCount = 5;
    expect(cond.shouldTerminate(ctx)).toBe(true);
  });

  it("OR composition terminates if either is true", () => {
    const ctx = makeLoopContext();

    class AlwaysTerminate extends TerminationCondition {
      shouldTerminate(_context: LoopContext): boolean {
        return true;
      }
    }

    class NeverTerminate extends TerminationCondition {
      shouldTerminate(_context: LoopContext): boolean {
        return false;
      }
    }

    expect(
      new AlwaysTerminate().or(new NeverTerminate()).shouldTerminate(ctx)
    ).toBe(true);
    expect(
      new NeverTerminate().or(new NeverTerminate()).shouldTerminate(ctx)
    ).toBe(false);
    expect(
      new NeverTerminate().or(new AlwaysTerminate()).shouldTerminate(ctx)
    ).toBe(true);
  });

  it("AND composition terminates only if both are true", () => {
    const ctx = makeLoopContext();

    class AlwaysTerminate extends TerminationCondition {
      shouldTerminate(_context: LoopContext): boolean {
        return true;
      }
    }

    class NeverTerminate extends TerminationCondition {
      shouldTerminate(_context: LoopContext): boolean {
        return false;
      }
    }

    expect(
      new AlwaysTerminate().and(new NeverTerminate()).shouldTerminate(ctx)
    ).toBe(false);
    expect(
      new AlwaysTerminate().and(new AlwaysTerminate()).shouldTerminate(ctx)
    ).toBe(true);
  });

  it("chained OR works correctly", () => {
    const ctx = makeLoopContext();

    const cond = new MaxRestartsTermination(5)
      .or(new MaxRestartsTermination(3))
      .or(new MaxRestartsTermination(10));

    ctx.restartCount = 2;
    expect(cond.shouldTerminate(ctx)).toBe(false);

    ctx.restartCount = 3;
    expect(cond.shouldTerminate(ctx)).toBe(true);

    ctx.restartCount = 5;
    expect(cond.shouldTerminate(ctx)).toBe(true);
  });

  it("mixed AND/OR preserves grouping", () => {
    const ctx = makeLoopContext();

    class NeverTerminate extends TerminationCondition {
      shouldTerminate(_context: LoopContext): boolean {
        return false;
      }
    }

    // (Never & MaxRestarts(2)) | MaxRestarts(5)
    // restart_count=3: (False & True) | False = False | False = False
    // restart_count=5: (False & True) | True = False | True = True
    const cond = new NeverTerminate()
      .and(new MaxRestartsTermination(2))
      .or(new MaxRestartsTermination(5));

    ctx.restartCount = 3;
    expect(cond.shouldTerminate(ctx)).toBe(false);

    ctx.restartCount = 5;
    expect(cond.shouldTerminate(ctx)).toBe(true);
  });

  it("CompositeTermination reset propagates to children", () => {
    const resetCalled: string[] = [];

    class TrackingCondition extends TerminationCondition {
      trackName: string;
      constructor(name: string) {
        super();
        this.trackName = name;
      }

      shouldTerminate(_context: LoopContext): boolean {
        return false;
      }

      override reset(): void {
        resetCalled.push(this.trackName);
      }
    }

    const cond = new TrackingCondition("a").or(new TrackingCondition("b"));
    cond.reset();

    expect(resetCalled).toContain("a");
    expect(resetCalled).toContain("b");
  });
});

// =============================================================================
// Test 9: Full trajectory inspection - message ordering
// =============================================================================

describe("TestTrajectory", () => {
  it("start hook message appears before LLM call in messages", async () => {
    const client = new MockClient();
    client.setResponses([makeAssistantMessage("Response")]);
    const agent = makeAgent(client, {
      startHooks: [new PlanningHook("PLAN FIRST")],
    });

    await agent.run("Task");

    // The first LLM call should contain: SystemMessage, UserMessage("Task"), UserMessage(hook)
    const firstCall = client.receivedMessages[0];

    let userTaskIdx: number | undefined;
    let hookIdx: number | undefined;
    for (let i = 0; i < firstCall.length; i++) {
      const m = firstCall[i];
      if (m.role === "user" && m.content === "Task") {
        userTaskIdx = i;
      }
      if (m.role === "user" && m.source === "hook") {
        hookIdx = i;
      }
    }

    expect(userTaskIdx).toBeDefined();
    expect(hookIdx).toBeDefined();
    // Hook should come after the user task (appended to end of messages)
    expect(hookIdx!).toBeGreaterThan(userTaskIdx!);
  });

  it("end hook resume message visible in subsequent call", async () => {
    const incomplete = [
      { content: "Task", status: "pending", activeForm: "Doing" },
    ];

    const client = new MockClient();
    client.setResponses([
      makeAssistantMessage("First attempt"),
      makeAssistantMessage("After resume"),
    ]);

    class InjectTodosHook extends BaseStartHook {
      async onStart(context: LoopContext): Promise<string | undefined> {
        context.metadata.todos = incomplete;
        return undefined;
      }
    }

    const hook = new CompletionCheckHook({ maxRestarts: 1 });
    const agent = makeAgent(client, {
      startHooks: [new InjectTodosHook()],
      endHooks: [hook],
    });

    await agent.run("Work");

    expect(client.callCount).toBe(2);

    // Second call should contain the resume hook message
    const secondCall = client.receivedMessages[1];
    const hookMsgs = secondCall.filter((m) => m.source === "hook");
    expect(hookMsgs.length).toBeGreaterThanOrEqual(1);
    expect(hookMsgs[hookMsgs.length - 1].content).toContain("Task");
  });

  it("start hooks and end hooks work together", async () => {
    const incomplete = [
      { content: "Task A", status: "pending", activeForm: "Doing A" },
    ];

    const client = new MockClient();
    client.setResponses([
      makeAssistantMessage("Starting"),
      makeAssistantMessage("Resumed"),
      makeAssistantMessage("Final"),
    ]);

    class InjectTodosHook extends BaseStartHook {
      async onStart(context: LoopContext): Promise<string | undefined> {
        context.metadata.todos = incomplete;
        return undefined;
      }
    }

    const agent = makeAgent(client, {
      startHooks: [
        new InjectTodosHook(),
        new PlanningHook("CREATE PLAN"),
      ],
      endHooks: [new CompletionCheckHook({ maxRestarts: 2 })],
    });

    await agent.run("Build something");

    // 1 initial + 2 restarts = 3
    expect(client.callCount).toBe(3);

    // First call should have the start hook
    const firstCall = client.receivedMessages[0];
    const startHooks = firstCall.filter((m) => m.source === "hook");
    expect(startHooks.length).toBe(1); // Only PlanningHook injects; InjectTodosHook returns undefined
    expect(startHooks[0].content).toBe("CREATE PLAN");

    // Subsequent calls should have end hook resume messages
    const secondCall = client.receivedMessages[1];
    const endHooks = secondCall.filter((m) => m.source === "hook");
    // Should have the start hook message + 1 resume message
    expect(endHooks.length).toBeGreaterThanOrEqual(2);
  });

  it("tool calls with end hook - end hooks trigger only when no tool calls", async () => {
    const incomplete = [
      { content: "Use tool", status: "pending", activeForm: "Using tool" },
    ];

    const tool = new MockTool();
    const client = new MockClient();
    client.setResponses([
      toolCallResponse("mock_tool", { input: "data" }),
      makeAssistantMessage("Done with tool"),
      makeAssistantMessage("Really done"),
    ]);

    class InjectTodosHook extends BaseStartHook {
      async onStart(context: LoopContext): Promise<string | undefined> {
        context.metadata.todos = incomplete;
        return undefined;
      }
    }

    const agent = makeAgent(client, {
      tools: [tool],
      startHooks: [new InjectTodosHook()],
      endHooks: [new CompletionCheckHook({ maxRestarts: 1 })],
    });

    await agent.run("Use tool then stop");

    expect(tool.callCount).toBe(1);
    expect(client.callCount).toBe(3);
  });

  it("messages accumulate across restarts", async () => {
    const incomplete = [
      { content: "Work", status: "pending", activeForm: "Working" },
    ];

    const client = new MockClient();
    client.setResponses([
      makeAssistantMessage("First"),
      makeAssistantMessage("Second"),
      makeAssistantMessage("Third"),
    ]);

    class InjectTodosHook extends BaseStartHook {
      async onStart(context: LoopContext): Promise<string | undefined> {
        context.metadata.todos = incomplete;
        return undefined;
      }
    }

    const agent = makeAgent(client, {
      startHooks: [new InjectTodosHook()],
      endHooks: [new CompletionCheckHook({ maxRestarts: 2 })],
    });

    await agent.run("Go");

    expect(client.callCount).toBe(3);

    // Each subsequent call should have MORE messages (accumulated)
    const len1 = client.receivedMessages[0].length;
    const len2 = client.receivedMessages[1].length;
    const len3 = client.receivedMessages[2].length;

    expect(len2).toBeGreaterThan(len1);
    expect(len3).toBeGreaterThan(len2);
  });
});

// =============================================================================
// Test: LoopContext unit tests
// =============================================================================

describe("TestLoopContext", () => {
  it("default values", () => {
    const ctx = makeLoopContext();
    expect(ctx.iteration).toBe(0);
    expect(ctx.restartCount).toBe(0);
    expect(ctx.metadata).toEqual({});
  });

  it("metadata isolation between contexts", () => {
    const ctx1 = makeLoopContext({ agentName: "test1" });
    const ctx2 = makeLoopContext({ agentName: "test2" });

    ctx1.metadata.key = "value1";
    expect(ctx2.metadata).not.toHaveProperty("key");
  });
});

// =============================================================================
// Test: CompletionCheckHook directly (unit test)
// =============================================================================

describe("TestCompletionCheckHookUnit", () => {
  it("returns undefined when termination condition says stop", async () => {
    const hook = new CompletionCheckHook({ maxRestarts: 0 });
    const ctx = makeLoopContext({ restartCount: 0 });
    ctx.metadata.todos = [{ status: "pending", content: "X" }];

    const result = await hook.onEnd(ctx);

    expect(result).toBeUndefined();
  });

  it("returns resume message with completion stats", async () => {
    const hook = new CompletionCheckHook({ maxRestarts: 5 });
    const ctx = makeLoopContext({ restartCount: 0 });

    ctx.metadata.todos = [
      { content: "A", status: "completed" },
      { content: "B", status: "pending" },
      { content: "C", status: "in_progress" },
    ];

    const result = await hook.onEnd(ctx);

    expect(result).toBeDefined();
    expect(result!).toContain("1/3 completed");
    expect(result!).toContain("B");
    expect(result!).toContain("C");
  });

  it("uses custom termination condition", async () => {
    class AlwaysTerminate extends TerminationCondition {
      shouldTerminate(_context: LoopContext): boolean {
        return true;
      }
    }

    const hook = new CompletionCheckHook({
      termination: new AlwaysTerminate(),
    });
    const ctx = makeLoopContext({ restartCount: 0 });
    ctx.metadata.todos = [{ status: "pending", content: "X" }];

    const result = await hook.onEnd(ctx);

    expect(result).toBeUndefined();
  });
});
