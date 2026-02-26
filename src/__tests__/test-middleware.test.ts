/**
 * Tests for the middleware system.
 */

import { describe, it, expect, vi } from "vitest";
import {
  BaseMiddleware,
  MiddlewareChain,
  LoggingMiddleware,
  RateLimitMiddleware,
  PIIRedactionMiddleware,
  GuardrailMiddleware,
  MetricsMiddleware,
} from "../middleware.js";
import type { MiddlewareContext } from "../middleware.js";
import { AgentContext } from "../context.js";
import { Agent } from "../agents/agent.js";
import type { BaseChatCompletionClient } from "../llm/base.js";
import type {
  ChatCompletionResult,
  ChatCompletionChunk,
  Usage,
  ToolResult,
  AgentEvent,
} from "../types.js";
import type {
  Message,
  AssistantMessage,
  UserMessage,
  ToolCallRequest,
} from "../messages.js";
import { BaseTool } from "../tools/base.js";

// ---------------------------------------------------------------------------
// Mock Helpers
// ---------------------------------------------------------------------------

class MockChatCompletionClient {
  model: string;
  responses: AssistantMessage[] = [];
  callCount = 0;

  constructor(model = "test-model") {
    this.model = model;
  }

  setResponse(content: string, toolCalls?: ToolCallRequest[]): void {
    const message: AssistantMessage = {
      content,
      source: "mock",
      role: "assistant" as const,
      toolCalls: toolCalls ?? undefined,
      timestamp: new Date(),
    };
    this.responses = [message];
  }

  setResponses(responses: AssistantMessage[]): void {
    this.responses = responses;
  }

  async create(
    messages: Message[],
    tools?: Record<string, unknown>[],
    outputFormat?: unknown,
    ...rest: unknown[]
  ): Promise<ChatCompletionResult> {
    this.callCount += 1;

    let response: AssistantMessage;
    if (this.responses.length === 0) {
      response = {
        content: "Test response",
        source: "mock",
        role: "assistant" as const,
        timestamp: new Date(),
      };
    } else if (this.responses.length > 1) {
      response = this.responses.shift()!;
    } else {
      response = this.responses[0];
    }

    return {
      message: response,
      model: "test-model",
      finishReason: "stop",
      usage: {
        durationMs: 100,
        llmCalls: 1,
        tokensInput: 50,
        tokensOutput: 25,
        toolCalls: 0,
        memoryOperations: 0,
      },
    };
  }

  async *createStream(
    messages: Message[],
    tools?: unknown,
    outputFormat?: unknown,
    ...rest: unknown[]
  ): AsyncGenerator<ChatCompletionChunk> {
    yield { content: "Test", isComplete: false };
    yield { content: " response", isComplete: true };
  }
}

class MockTool extends BaseTool {
  private resultValue: string;
  private _parametersSchema: Record<string, unknown>;

  constructor(name = "mock_tool", result = "mock result") {
    super(name, "Mock tool for testing");
    this.resultValue = result;
    this._parametersSchema = { type: "object", properties: {} };
  }

  get parameters(): Record<string, unknown> {
    return this._parametersSchema;
  }

  async execute(
    parameters: Record<string, unknown>
  ): Promise<ToolResult> {
    return {
      success: true,
      result: this.resultValue,
      error: undefined,
      metadata: { tool_name: this.name },
    };
  }
}

// ---------------------------------------------------------------------------
// Test Middleware Implementations
// ---------------------------------------------------------------------------

class MockMiddleware extends BaseMiddleware {
  requestCalls: string[] = [];
  responseCalls: string[] = [];
  errorCalls: Array<[string, string]> = [];

  async *processRequest(
    context: MiddlewareContext
  ): AsyncGenerator<MiddlewareContext | AgentEvent, void, undefined> {
    this.requestCalls.push(context.operation);
    if (context.operation === "model_call" && Array.isArray(context.data)) {
      context.metadata.test_marker = "request_processed";
    }
    yield context;
  }

  async *processResponse(
    context: MiddlewareContext,
    result: unknown
  ): AsyncGenerator<unknown | AgentEvent, void, undefined> {
    this.responseCalls.push(context.operation);
    const r = result as { message?: { content?: string } };
    if (r?.message?.content) {
      yield {
        ...r,
        message: { ...r.message, content: r.message.content + " [test_processed]" },
      };
      return;
    }
    yield result;
  }

  async *processError(
    context: MiddlewareContext,
    error: Error
  ): AsyncGenerator<unknown | AgentEvent, void, undefined> {
    this.errorCalls.push([context.operation, error.constructor.name]);
    throw error;
    yield undefined as never;
  }
}

class BlockingMiddleware extends BaseMiddleware {
  private blockOperations: string[];

  constructor(blockOperations?: string[]) {
    super();
    this.blockOperations = blockOperations ?? [];
  }

  async *processRequest(
    context: MiddlewareContext
  ): AsyncGenerator<MiddlewareContext | AgentEvent, void, undefined> {
    if (this.blockOperations.includes(context.operation)) {
      throw new Error(`Operation ${context.operation} blocked by middleware`);
    }
    yield context;
  }

  async *processResponse(
    _context: MiddlewareContext,
    result: unknown
  ): AsyncGenerator<unknown | AgentEvent, void, undefined> {
    yield result;
  }

  async *processError(
    _context: MiddlewareContext,
    error: Error
  ): AsyncGenerator<unknown | AgentEvent, void, undefined> {
    throw error;
    yield undefined as never;
  }
}

// ---------------------------------------------------------------------------
// Helper to consume async generator and get last value
// ---------------------------------------------------------------------------

async function collectLast<T>(gen: AsyncGenerator<T>): Promise<T | undefined> {
  let last: T | undefined;
  for await (const item of gen) {
    last = item;
  }
  return last;
}

async function consumeAll<T>(gen: AsyncGenerator<T>): Promise<void> {
  for await (const _item of gen) {
    // just consume
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function createMockAgent() {
  const client = new MockChatCompletionClient();
  const context = new AgentContext();
  const agent = new Agent({
    name: "test_agent",
    description: "Test agent",
    instructions: "Test instructions",
    modelClient: client as unknown as BaseChatCompletionClient,
    context,
  });
  return { agent, client, context };
}

describe("TestMiddlewareChain", () => {
  it("test_empty_chain", async () => {
    const chain = new MiddlewareChain([]);
    const context = new AgentContext();

    async function mockFunc(data: unknown) {
      return "test_result";
    }

    const result = await collectLast(
      chain.executeStream("test_op", "test_agent", context, "test_data", mockFunc)
    );

    expect(result).toBe("test_result");
  });

  it("test_single_middleware", async () => {
    const testMiddleware = new MockMiddleware();
    const chain = new MiddlewareChain([testMiddleware]);
    const context = new AgentContext();

    async function mockFunc(data: unknown) {
      return "test_result";
    }

    const result = await collectLast(
      chain.executeStream("test_op", "test_agent", context, "test_data", mockFunc)
    );

    expect(result).toBe("test_result");
    expect(testMiddleware.requestCalls).toEqual(["test_op"]);
    expect(testMiddleware.responseCalls).toEqual(["test_op"]);
    expect(testMiddleware.errorCalls).toEqual([]);
  });

  it("test_multiple_middleware_order", async () => {
    const middleware1 = new MockMiddleware();
    const middleware2 = new MockMiddleware();
    const chain = new MiddlewareChain([middleware1, middleware2]);
    const context = new AgentContext();

    async function mockFunc(data: unknown) {
      return "test_result";
    }

    await consumeAll(
      chain.executeStream("test_op", "test_agent", context, "test_data", mockFunc)
    );

    // Request processing: forward order
    expect(middleware1.requestCalls).toEqual(["test_op"]);
    expect(middleware2.requestCalls).toEqual(["test_op"]);

    // Response processing: reverse order
    expect(middleware1.responseCalls).toEqual(["test_op"]);
    expect(middleware2.responseCalls).toEqual(["test_op"]);
  });

  it("test_middleware_blocking", async () => {
    const blockingMiddleware = new BlockingMiddleware(["blocked_op"]);
    const chain = new MiddlewareChain([blockingMiddleware]);
    const context = new AgentContext();

    async function mockFunc(data: unknown) {
      return "should_not_execute";
    }

    await expect(async () => {
      await consumeAll(
        chain.executeStream("blocked_op", "test_agent", context, "test_data", mockFunc)
      );
    }).rejects.toThrow("Operation blocked_op blocked");
  });

  it("test_error_handling", async () => {
    const testMiddleware = new MockMiddleware();
    const chain = new MiddlewareChain([testMiddleware]);
    const context = new AgentContext();

    async function failingFunc(data: unknown): Promise<unknown> {
      throw new Error("Test error");
    }

    await expect(async () => {
      await consumeAll(
        chain.executeStream("test_op", "test_agent", context, "test_data", failingFunc)
      );
    }).rejects.toThrow("Test error");

    expect(testMiddleware.errorCalls).toEqual([["test_op", "Error"]]);
  });
});

describe("TestAgentMiddlewareIntegration", () => {
  it("test_middleware_chain_wrapping_model_call", async () => {
    // Test middleware chain wrapping a simulated model call
    // (The TS Agent doesn't wire middleware into its run() loop directly,
    //  so we test the chain in isolation with a model_call operation.)
    const testMiddleware = new MockMiddleware();
    const chain = new MiddlewareChain([testMiddleware]);
    const context = new AgentContext();

    async function simulatedModelCall(data: unknown) {
      return { message: { role: "assistant", content: "Test response" }, model: "mock" };
    }

    let result: unknown = null;
    for await (const item of chain.executeStream(
      "model_call", "test_agent", context, ["messages"], simulatedModelCall
    )) {
      result = item;
    }

    expect(testMiddleware.requestCalls).toContain("model_call");
    expect(testMiddleware.responseCalls).toContain("model_call");
    expect(testMiddleware.requestCalls.length).toBeGreaterThan(0);
    expect(testMiddleware.responseCalls.length).toBeGreaterThan(0);
  });

  it("test_middleware_chain_wrapping_tool_call", async () => {
    // Test middleware chain wrapping a simulated tool call
    const testMiddleware = new MockMiddleware();
    const chain = new MiddlewareChain([testMiddleware]);
    const context = new AgentContext();

    async function simulatedToolCall(data: unknown) {
      return { success: true, result: "tool output" };
    }

    let result: unknown = null;
    for await (const item of chain.executeStream(
      "tool_call", "test_agent", context, { toolName: "mock_tool" }, simulatedToolCall
    )) {
      result = item;
    }

    expect(testMiddleware.requestCalls).toContain("tool_call");
    expect(testMiddleware.responseCalls).toContain("tool_call");
  });
});

describe("TestBuiltInMiddleware", () => {
  it("test_logging_middleware", async () => {
    const logMessages: string[] = [];
    const logFn = (msg: string) => logMessages.push(msg);
    const loggingMiddleware = new LoggingMiddleware(logFn);

    const context: MiddlewareContext = {
      operation: "test_op",
      agentName: "test_agent",
      agentContext: new AgentContext(),
      data: "test_data",
      metadata: {},
    };

    // Test request logging
    let resultContext: MiddlewareContext | undefined;
    for await (const item of loggingMiddleware.processRequest(context)) {
      if (
        typeof item === "object" &&
        item !== null &&
        "operation" in item
      ) {
        resultContext = item as MiddlewareContext;
      }
    }
    expect(logMessages.some((m) => m.includes("Starting test_op"))).toBe(true);

    // Test response logging
    for await (const _item of loggingMiddleware.processResponse(
      resultContext!,
      "test_result"
    )) {
      // consume
    }
    expect(logMessages.some((m) => m.includes("Completed test_op"))).toBe(true);
  });

  it("test_rate_limit_middleware", async () => {
    const rateLimiter = new RateLimitMiddleware(2);
    const context: MiddlewareContext = {
      operation: "test_op",
      agentName: "test_agent",
      agentContext: new AgentContext(),
      data: "test_data",
      metadata: {},
    };

    // First two calls should be fast
    const startTime = Date.now();
    for await (const _item of rateLimiter.processRequest(context)) {
      // consume
    }
    for await (const _item of rateLimiter.processRequest(context)) {
      // consume
    }
    const fastDuration = Date.now() - startTime;

    // The calls should complete quickly
    expect(fastDuration).toBeLessThan(2000);
  });

  it("test_pii_redaction_middleware", async () => {
    const piiMiddleware = new PIIRedactionMiddleware();

    const message: UserMessage = {
      content: "My email is john.doe@example.com and SSN is 123-45-6789",
      source: "user",
      role: "user" as const,
      timestamp: new Date(),
    };

    const context: MiddlewareContext = {
      operation: "model_call",
      agentName: "test_agent",
      agentContext: new AgentContext(),
      data: [message],
      metadata: {},
    };

    let processedContext: MiddlewareContext | undefined;
    for await (const item of piiMiddleware.processRequest(context)) {
      if (
        typeof item === "object" &&
        item !== null &&
        "operation" in item
      ) {
        processedContext = item as MiddlewareContext;
      }
    }

    const processedMessage = (processedContext!.data as Array<{ content: string }>)[0];

    expect(processedMessage.content).toContain("[EMAIL-REDACTED]");
    expect(processedMessage.content).toContain("[SSN-REDACTED]");
    expect(processedMessage.content).not.toContain("john.doe@example.com");
    expect(processedMessage.content).not.toContain("123-45-6789");
  });

  it("test_metrics_middleware", async () => {
    const metricsMiddleware = new MetricsMiddleware();

    const context: MiddlewareContext = {
      operation: "model_call",
      agentName: "test_agent",
      agentContext: new AgentContext(),
      data: "test_data",
      metadata: {},
    };

    // Process request
    for await (const _item of metricsMiddleware.processRequest(context)) {
      // consume
    }

    // Simulate some processing time
    await new Promise((r) => setTimeout(r, 10));

    // Process response
    for await (const _item of metricsMiddleware.processResponse(
      context,
      "test_result"
    )) {
      // consume
    }

    const metrics = metricsMiddleware.getMetrics() as Record<string, unknown>;

    expect(metrics.totalOperations).toBe(1);
    expect(
      (metrics.operationsByType as Record<string, number>).model_call
    ).toBe(1);
    expect(metrics.totalDuration).toBeGreaterThan(0);
    expect(metrics.averageDuration).toBeGreaterThan(0);
  });

  it("test_guardrail_middleware_blocked_tool", async () => {
    const guardrail = new GuardrailMiddleware(
      ["dangerous_tool"],
      ["rm -rf"]
    );

    const toolCall: ToolCallRequest = {
      toolName: "dangerous_tool",
      parameters: {},
      callId: "test_call",
    };

    const context: MiddlewareContext = {
      operation: "tool_call",
      agentName: "test_agent",
      agentContext: new AgentContext(),
      data: toolCall,
      metadata: {},
    };

    await expect(async () => {
      for await (const _item of guardrail.processRequest(context)) {
        // consume
      }
    }).rejects.toThrow("blocked by guardrails");
  });

  it("test_guardrail_middleware_blocked_pattern", async () => {
    const guardrail = new GuardrailMiddleware(
      ["dangerous_tool"],
      ["rm -rf"]
    );

    const message: UserMessage = {
      content: "Please run: rm -rf /",
      source: "user",
      role: "user" as const,
      timestamp: new Date(),
    };

    const context: MiddlewareContext = {
      operation: "model_call",
      agentName: "test_agent",
      agentContext: new AgentContext(),
      data: [message],
      metadata: {},
    };

    await expect(async () => {
      for await (const _item of guardrail.processRequest(context)) {
        // consume
      }
    }).rejects.toThrow("blocked pattern");
  });
});

describe("TestAgentContext", () => {
  it("test_context_creation", () => {
    const context = new AgentContext();

    expect(context.messageCount).toBe(0);
    expect(context.isEmpty).toBe(true);
    expect(Array.isArray(context.messages)).toBe(true);
    expect(typeof context.metadata).toBe("object");
    expect(typeof context.sharedState).toBe("object");
  });

  it("test_context_with_data", () => {
    const context = new AgentContext({
      metadata: { user_id: "123" },
      sessionId: "session456",
    });

    expect(context.metadata.user_id).toBe("123");
    expect(context.sessionId).toBe("session456");
  });

  it("test_add_message", () => {
    const context = new AgentContext();
    const message: UserMessage = {
      content: "Test",
      source: "user",
      role: "user" as const,
      timestamp: new Date(),
    };

    context.addMessage(message);

    expect(context.messageCount).toBe(1);
    expect(context.isEmpty).toBe(false);
    expect(context.messages[0]).toBe(message);
  });

  it("test_get_last_messages", () => {
    const context = new AgentContext();

    const userMsg: UserMessage = {
      content: "User message",
      source: "user",
      role: "user" as const,
      timestamp: new Date(),
    };
    const assistantMsg: AssistantMessage = {
      content: "Assistant message",
      source: "assistant",
      role: "assistant" as const,
      timestamp: new Date(),
    };

    context.addMessage(userMsg);
    context.addMessage(assistantMsg);

    expect(context.getLastUserMessage()).toBe(userMsg);
    expect(context.getLastAssistantMessage()).toBe(assistantMsg);
  });

  it("test_context_reset", () => {
    const context = new AgentContext({
      metadata: { key: "value" },
      sharedState: { state: "data" },
    });

    context.addMessage({
      content: "Test",
      source: "user",
      role: "user" as const,
      timestamp: new Date(),
    } as UserMessage);

    context.reset();

    expect(context.messageCount).toBe(0);
    expect(Object.keys(context.metadata).length).toBe(0);
    expect(Object.keys(context.sharedState).length).toBe(0);
  });

  it("test_from_messages", () => {
    const messages: Message[] = [
      {
        content: "Test 1",
        source: "user",
        role: "user" as const,
        timestamp: new Date(),
      } as UserMessage,
      {
        content: "Test 2",
        source: "assistant",
        role: "assistant" as const,
        timestamp: new Date(),
      } as AssistantMessage,
    ];

    const context = AgentContext.fromMessages(messages);

    expect(context.messageCount).toBe(2);
    expect(context.messages).toEqual(messages);
  });
});
