import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { Agent } from "../agent.js";
import { BaseAgent } from "../base.js";
import { AgentAsTool } from "../agent-as-tool.js";
import {
  AgentConfigurationError,
  AgentError,
  AgentExecutionError,
} from "../errors.js";
import { AgentContext } from "../../context.js";
import { BaseChatCompletionClient } from "../../llm/base.js";
import { createTool } from "../../tools/decorator.js";
import { ApprovalMode, BaseTool } from "../../tools/base.js";
import type {
  Message,
  AssistantMessage,
  ToolCallRequest,
} from "../../messages.js";
import type {
  ChatCompletionResult,
  ChatCompletionChunk,
  AgentResponse,
  AgentEvent,
  Usage,
} from "../../types.js";

// ---------------------------------------------------------------------------
// Mock LLM Client
// ---------------------------------------------------------------------------

class MockLLMClient extends BaseChatCompletionClient {
  private responses: ChatCompletionResult[];
  private callIndex = 0;

  constructor(responses: ChatCompletionResult[]) {
    super("mock-model");
    this.responses = responses;
  }

  async create(): Promise<ChatCompletionResult> {
    if (this.callIndex >= this.responses.length) {
      // Return a default stop response
      return {
        message: {
          role: "assistant",
          content: "Done.",
          source: "llm",
          timestamp: new Date(),
        },
        usage: makeUsage(),
        model: "mock-model",
        finishReason: "stop",
      };
    }
    return this.responses[this.callIndex++];
  }

  async *createStream(): AsyncGenerator<ChatCompletionChunk, void, undefined> {
    const result = await this.create();
    yield { content: result.message.content, isComplete: false };
    yield { content: "", isComplete: true, usage: result.usage };
  }
}

function makeUsage(overrides?: Partial<Usage>): Usage {
  return {
    durationMs: 100,
    llmCalls: 1,
    tokensInput: 10,
    tokensOutput: 5,
    toolCalls: 0,
    memoryOperations: 0,
    ...overrides,
  };
}

function makeResponse(
  content: string,
  toolCalls?: ToolCallRequest[]
): ChatCompletionResult {
  return {
    message: {
      role: "assistant",
      content,
      source: "llm",
      timestamp: new Date(),
      toolCalls,
    },
    usage: makeUsage(),
    model: "mock-model",
    finishReason: toolCalls ? "tool_calls" : "stop",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Agent Configuration", () => {
  it("should require name", () => {
    expect(
      () =>
        new Agent({
          name: "",
          description: "test",
          instructions: "test",
          modelClient: new MockLLMClient([]),
        })
    ).toThrow(AgentConfigurationError);
  });

  it("should require description", () => {
    expect(
      () =>
        new Agent({
          name: "test",
          description: "",
          instructions: "test",
          modelClient: new MockLLMClient([]),
        })
    ).toThrow(AgentConfigurationError);
  });

  it("should create valid agent", () => {
    const agent = new Agent({
      name: "test-agent",
      description: "A test agent",
      instructions: "Be helpful",
      modelClient: new MockLLMClient([]),
    });
    expect(agent.name).toBe("test-agent");
    expect(agent.maxIterations).toBe(10);
  });
});

describe("Agent.run()", () => {
  it("should execute simple task and return response", async () => {
    const agent = new Agent({
      name: "assistant",
      description: "A helpful assistant",
      instructions: "Be helpful",
      modelClient: new MockLLMClient([
        makeResponse("Hello! How can I help you?"),
      ]),
    });

    const response = await agent.run("Hi there");
    expect(response.source).toBe("assistant");
    expect(response.finishReason).toBe("stop");
    expect(response.usage.llmCalls).toBe(1);
  });

  it("should execute tool calls", async () => {
    const calcTool = createTool({
      name: "calculator",
      description: "Calculate math",
      parametersSchema: z.object({ expression: z.string() }),
      execute: ({ expression }) => `Result: ${eval(expression)}`,
    });

    const agent = new Agent({
      name: "math-agent",
      description: "Does math",
      instructions: "Use calculator for math",
      modelClient: new MockLLMClient([
        makeResponse("", [
          {
            toolName: "calculator",
            parameters: { expression: "2 + 3" },
            callId: "call_1",
          },
        ]),
        makeResponse("The answer is 5."),
      ]),
      tools: [calcTool],
    });

    const response = await agent.run("What is 2 + 3?");
    expect(response.finishReason).toBe("stop");
    expect(response.usage.llmCalls).toBe(2);
  });

  it("should handle tool not found gracefully", async () => {
    const agent = new Agent({
      name: "agent",
      description: "An agent",
      instructions: "Be helpful",
      modelClient: new MockLLMClient([
        makeResponse("", [
          {
            toolName: "nonexistent",
            parameters: {},
            callId: "call_1",
          },
        ]),
        makeResponse("Sorry, that tool wasn't available."),
      ]),
    });

    const response = await agent.run("Do something");
    expect(response.finishReason).toBe("stop");
  });

  it("should respect max_iterations", async () => {
    // Create an agent that always calls tools (infinite loop without limit)
    const echoTool = createTool({
      name: "echo",
      description: "Echo back",
      parametersSchema: z.object({ text: z.string() }),
      execute: ({ text }) => text,
    });

    const responses: ChatCompletionResult[] = Array.from(
      { length: 20 },
      () =>
        makeResponse("", [
          {
            toolName: "echo",
            parameters: { text: "loop" },
            callId: `call_${Math.random()}`,
          },
        ])
    );

    const agent = new Agent({
      name: "looper",
      description: "Loops forever",
      instructions: "Keep echoing",
      modelClient: new MockLLMClient(responses),
      tools: [echoTool],
      maxIterations: 3,
    });

    const response = await agent.run("Start looping");
    expect(response.finishReason).toBe("max_iterations");
  });
});

describe("Agent.runStream()", () => {
  it("should yield messages and final response", async () => {
    const agent = new Agent({
      name: "streamer",
      description: "Streaming agent",
      instructions: "Stream responses",
      modelClient: new MockLLMClient([
        makeResponse("Hello from stream!"),
      ]),
    });

    const items: Array<Message | AgentEvent | AgentResponse | ChatCompletionChunk> = [];
    for await (const item of agent.runStream("Test")) {
      items.push(item);
    }

    // Should have: user message, assistant message, agent response
    expect(items.length).toBeGreaterThanOrEqual(3);

    // Last item should be AgentResponse
    const last = items[items.length - 1] as AgentResponse;
    expect(last.finishReason).toBe("stop");
  });

  it("should yield verbose events when requested", async () => {
    const agent = new Agent({
      name: "verbose-agent",
      description: "Verbose agent",
      instructions: "Be verbose",
      modelClient: new MockLLMClient([
        makeResponse("Response"),
      ]),
    });

    const items: Array<Message | AgentEvent | AgentResponse | ChatCompletionChunk> = [];
    for await (const item of agent.runStream(
      "Test",
      undefined,
      undefined,
      true
    )) {
      items.push(item);
    }

    const events = items.filter(
      (i) => typeof i === "object" && i !== null && "eventType" in i
    );
    expect(events.length).toBeGreaterThan(0);
  });
});

describe("Agent.getInfo()", () => {
  it("should return agent information", () => {
    const agent = new Agent({
      name: "info-agent",
      description: "Info test",
      instructions: "Get info",
      modelClient: new MockLLMClient([]),
      tools: [
        createTool({
          name: "tool1",
          description: "Tool 1",
          parametersSchema: z.object({}),
          execute: () => "done",
        }),
      ],
    });

    const info = agent.getInfo();
    expect(info.name).toBe("info-agent");
    expect(info.toolsCount).toBe(1);
    expect(info.hasMemory).toBe(false);
  });
});

describe("Agent.reset()", () => {
  it("should clear context", async () => {
    const agent = new Agent({
      name: "reset-agent",
      description: "Reset test",
      instructions: "Reset me",
      modelClient: new MockLLMClient([makeResponse("Hi")]),
    });

    await agent.run("test");
    expect(agent.context.messageCount).toBe(0); // context is restored after run

    await agent.reset();
    expect(agent.context.messageCount).toBe(0);
  });
});

describe("AgentAsTool", () => {
  it("should wrap agent as a tool", async () => {
    const innerAgent = new Agent({
      name: "inner",
      description: "Inner agent for processing",
      instructions: "Process data",
      modelClient: new MockLLMClient([
        makeResponse("Processed result"),
      ]),
    });

    const tool = new AgentAsTool(innerAgent);
    expect(tool.name).toBe("inner");
    expect(tool.description).toBe("Inner agent for processing");

    const result = await tool.execute({ task: "Process this" });
    expect(result.success).toBe(true);
    expect(result.result).toBe("Processed result");
  });

  it("should support 'all' result strategy", () => {
    const innerAgent = new Agent({
      name: "inner",
      description: "Inner agent",
      instructions: "Do stuff",
      modelClient: new MockLLMClient([]),
    });

    const tool = new AgentAsTool(innerAgent, "task", "all");
    const messages: Message[] = [
      { role: "user", content: "Hello", source: "user", timestamp: new Date() },
      { role: "assistant", content: "Hi", source: "inner", timestamp: new Date() },
    ];
    expect(tool.extractResult(messages)).toBe("Hello\nHi");
  });

  it("should support 'last:N' result strategy", () => {
    const innerAgent = new Agent({
      name: "inner",
      description: "Inner agent",
      instructions: "Do stuff",
      modelClient: new MockLLMClient([]),
    });

    const tool = new AgentAsTool(innerAgent, "task", "last:2");
    const messages: Message[] = [
      { role: "user", content: "A", source: "user", timestamp: new Date() },
      { role: "assistant", content: "B", source: "inner", timestamp: new Date() },
      { role: "assistant", content: "C", source: "inner", timestamp: new Date() },
    ];
    expect(tool.extractResult(messages)).toBe("B\nC");
  });

  it("should support callable result strategy", () => {
    const innerAgent = new Agent({
      name: "inner",
      description: "Inner agent",
      instructions: "Do stuff",
      modelClient: new MockLLMClient([]),
    });

    const tool = new AgentAsTool(
      innerAgent,
      "task",
      (msgs) =>
        msgs
          .filter((m) => m.role === "assistant")
          .map((m) => m.content)
          .join(" | ")
    );

    const messages: Message[] = [
      { role: "user", content: "Q", source: "user", timestamp: new Date() },
      { role: "assistant", content: "A1", source: "inner", timestamp: new Date() },
      { role: "assistant", content: "A2", source: "inner", timestamp: new Date() },
    ];
    expect(tool.extractResult(messages)).toBe("A1 | A2");
  });

  it("should have proper parameter schema", () => {
    const innerAgent = new Agent({
      name: "inner",
      description: "Inner agent",
      instructions: "Do stuff",
      modelClient: new MockLLMClient([]),
    });

    const tool = new AgentAsTool(innerAgent, "query");
    const params = tool.parameters as {
      properties: Record<string, Record<string, unknown>>;
      required: string[];
    };
    expect(params.properties.query).toBeDefined();
    expect(params.required).toContain("query");
  });

  it("should reject invalid result strategy", () => {
    const innerAgent = new Agent({
      name: "inner",
      description: "Inner agent",
      instructions: "Do stuff",
      modelClient: new MockLLMClient([]),
    });

    expect(() => new AgentAsTool(innerAgent, "task", "invalid")).toThrow();
  });
});

describe("Error classes", () => {
  it("AgentError includes agent name", () => {
    const err = new AgentError("something failed", "my-agent");
    expect(err.toString()).toContain("my-agent");
    expect(err.agentName).toBe("my-agent");
  });

  it("AgentConfigurationError is an AgentError", () => {
    const err = new AgentConfigurationError("bad config");
    expect(err).toBeInstanceOf(AgentError);
  });

  it("AgentExecutionError is an AgentError", () => {
    const err = new AgentExecutionError("failed");
    expect(err).toBeInstanceOf(AgentError);
  });
});
