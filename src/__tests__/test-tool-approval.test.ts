/**
 * Tests for tool approval functionality.
 *
 * Converted from Python test files:
 * - tests/test_tool_approval.py
 * - tests/test_tool_approval_simple.py
 *
 * Covers:
 * - ApprovalMode enum values
 * - Tool creation with and without approval modes (FunctionTool, createTool)
 * - AgentContext approval state management (pending requests, responses)
 * - Approval request/response workflow
 * - Rejection handling
 * - Agent integration with approval-required tools
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ApprovalMode } from "../tools/base.js";
import { FunctionTool } from "../tools/function-tool.js";
import { createTool } from "../tools/decorator.js";
import {
  AgentContext,
  createApprovalResponse,
  type ToolApprovalRequest,
  type ToolApprovalResponse,
} from "../context.js";
import type { ToolCallRequest } from "../messages.js";
import {
  needsApproval,
  getApprovalRequests,
  getMessages,
  type AgentResponse,
  type ChatCompletionResult,
  type ChatCompletionChunk,
  type Usage,
} from "../types.js";
import type { AssistantMessage } from "../messages.js";
import { Agent } from "../agents/agent.js";
import type { BaseChatCompletionClient } from "../llm/base.js";

// ============================================================================
// Test Helpers
// ============================================================================

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

/**
 * Mock LLM that returns tool calls on the first call, then a text response.
 */
function createMockLlmWithToolCalls(
  toolCalls: ToolCallRequest[]
): BaseChatCompletionClient {
  let callCount = 0;

  return {
    create: async () => {
      callCount++;

      if (callCount === 1 && toolCalls.length > 0) {
        const message: AssistantMessage = {
          role: "assistant",
          content: "I'll help with that.",
          source: "mock",
          timestamp: new Date(),
          toolCalls,
        };
        return {
          message,
          usage: mockUsage(),
          model: "test-model",
          finishReason: "tool_calls",
        } as ChatCompletionResult;
      }

      const message: AssistantMessage = {
        role: "assistant",
        content: "Task completed successfully.",
        source: "mock",
        timestamp: new Date(),
      };
      return {
        message,
        usage: mockUsage(),
        model: "test-model",
        finishReason: "stop",
      } as ChatCompletionResult;
    },
    createStream: async function* () {
      yield {
        content: "Task completed successfully.",
        isComplete: true,
      } as ChatCompletionChunk;
    },
    totalUsage: mockUsage(),
    actualUsage: mockUsage(),
    model: "test-model",
  } as unknown as BaseChatCompletionClient;
}

function createMockLlm(): BaseChatCompletionClient {
  return createMockLlmWithToolCalls([]);
}

// ============================================================================
// Imports Test (from test_tool_approval_simple.py)
// ============================================================================

describe("Tool approval imports", () => {
  it("should have all necessary imports available", () => {
    expect(AgentContext).toBeDefined();
    expect(ApprovalMode).toBeDefined();
    expect(FunctionTool).toBeDefined();
    expect(createTool).toBeDefined();
    expect(createApprovalResponse).toBeDefined();
  });
});

// ============================================================================
// ApprovalMode Enum Tests
// ============================================================================

describe("ApprovalMode enum", () => {
  it("should have NEVER and ALWAYS values", () => {
    expect(ApprovalMode.NEVER).toBe("never_require");
    expect(ApprovalMode.ALWAYS).toBe("always_require");
  });
});

// ============================================================================
// Tool Creation with Approval Mode (from test_tool_approval_simple.py)
// ============================================================================

describe("Tool creation with approval mode", () => {
  it("should create a tool without approval (defaults to NEVER)", () => {
    const simpleTool = createTool({
      name: "simple_tool",
      description: "Simple tool",
      parametersSchema: z.object({
        x: z.number().int().describe("Input number"),
      }),
      execute: ({ x }) => x * 2,
    });

    expect(simpleTool.name).toBe("simple_tool");
    expect(simpleTool.approvalMode).toBe(ApprovalMode.NEVER);
  });

  it("should create a tool with approval mode ALWAYS via createTool", () => {
    const approvalTool = createTool({
      name: "approval_tool",
      description: "Tool that needs approval",
      parametersSchema: z.object({
        x: z.number().int().describe("Input number"),
      }),
      execute: ({ x }) => x * 3,
      approvalMode: "always_require",
    });

    expect(approvalTool.name).toBe("approval_tool");
    expect(approvalTool.approvalMode).toBe(ApprovalMode.ALWAYS);
  });

  it("should create a FunctionTool with approval mode ALWAYS directly", () => {
    const dangerousTool = new FunctionTool({
      name: "dangerous_op",
      description: "A dangerous operation",
      parametersSchema: z.object({
        data: z.string().describe("Data to process"),
      }),
      func: ({ data }) => `Executed: ${data}`,
      approvalMode: ApprovalMode.ALWAYS,
    });

    expect(dangerousTool.approvalMode).toBe(ApprovalMode.ALWAYS);
    expect(dangerousTool.name).toBe("dangerous_op");
  });

  it("should create a FunctionTool with default approval mode NEVER", () => {
    const safeTool = new FunctionTool({
      name: "safe_op",
      description: "A safe operation",
      parametersSchema: z.object({
        input: z.string().describe("Input"),
      }),
      func: ({ input }) => `Result: ${input}`,
    });

    expect(safeTool.approvalMode).toBe(ApprovalMode.NEVER);
  });

  it("should accept ApprovalMode enum value in createTool", () => {
    const tool = createTool({
      name: "enum_tool",
      description: "Tool using enum",
      parametersSchema: z.object({ x: z.string() }),
      execute: ({ x }) => x,
      approvalMode: ApprovalMode.ALWAYS,
    });

    expect(tool.approvalMode).toBe(ApprovalMode.ALWAYS);
  });
});

// ============================================================================
// AgentContext Approval State Management
// (from test_tool_approval_simple.py::test_context_approval_methods
//  and test_tool_approval.py::test_context_approval_state_management)
// ============================================================================

describe("AgentContext approval state management", () => {
  it("should track pending approval requests", () => {
    const context = new AgentContext();

    const toolCall: ToolCallRequest = {
      callId: "call_1",
      toolName: "delete_file",
      parameters: { path: "/tmp/test.txt" },
    };

    const approvalReq = context.addApprovalRequest(toolCall, "delete_file");

    expect(context.waitingForApproval).toBe(true);
    expect(context.pendingApprovalRequests).toHaveLength(1);
    expect(context.pendingToolCalls.get("call_1")).toEqual(toolCall);

    // Check approval request structure
    expect(approvalReq.toolName).toBe("delete_file");
    expect(approvalReq.toolCallId).toBe("call_1");
    expect(approvalReq.parameters).toEqual({ path: "/tmp/test.txt" });
    expect(approvalReq.requestId).toBe("approval_call_1");
  });

  it("should handle approval response and clear pending state", () => {
    const context = new AgentContext();

    const toolCall: ToolCallRequest = {
      callId: "call_1",
      toolName: "delete_file",
      parameters: { path: "/tmp/test.txt" },
    };

    const approvalReq = context.addApprovalRequest(toolCall, "delete_file");

    // Create and add approval response (approved)
    const approvalResp = createApprovalResponse(approvalReq, true);
    context.addApprovalResponse(approvalResp);

    // Should no longer be waiting
    expect(context.waitingForApproval).toBe(false);
    expect(context.pendingApprovalRequests).toHaveLength(0);

    // Get approved tool calls
    const approved = context.getApprovedToolCalls();
    expect(approved).toHaveLength(1);
    expect(approved[0]).toEqual(toolCall);

    // After getting approved calls, should be cleared
    expect(context.approvalResponses.size).toBe(0);
    expect(context.pendingToolCalls.size).toBe(0);
  });

  it("should handle rejected approvals correctly", () => {
    const context = new AgentContext();

    const toolCall: ToolCallRequest = {
      callId: "call_1",
      toolName: "delete_file",
      parameters: { path: "/tmp/test.txt" },
    };

    const approvalReq = context.addApprovalRequest(toolCall, "delete_file");

    // Reject it
    const approvalResp = createApprovalResponse(approvalReq, false);
    context.addApprovalResponse(approvalResp);

    // Should have no approved calls
    const approved = context.getApprovedToolCalls();
    expect(approved).toHaveLength(0);

    // Should have rejected calls
    const rejected = context.getRejectedToolCalls();
    expect(rejected).toHaveLength(1);
    expect(rejected[0][0]).toBe("call_1");
    expect(rejected[0][1]).toEqual(toolCall);
  });

  it("should handle multiple approval requests", () => {
    const context = new AgentContext();

    const toolCall1: ToolCallRequest = {
      callId: "call_1",
      toolName: "delete_file",
      parameters: { path: "/tmp/a.txt" },
    };
    const toolCall2: ToolCallRequest = {
      callId: "call_2",
      toolName: "delete_file",
      parameters: { path: "/tmp/b.txt" },
    };

    context.addApprovalRequest(toolCall1, "delete_file");
    context.addApprovalRequest(toolCall2, "delete_file");

    expect(context.waitingForApproval).toBe(true);
    expect(context.pendingApprovalRequests).toHaveLength(2);
    expect(context.pendingToolCalls.size).toBe(2);
  });

  it("should support getApprovalResponse lookup by toolCallId", () => {
    const context = new AgentContext();

    const toolCall: ToolCallRequest = {
      callId: "call_1",
      toolName: "test_tool",
      parameters: { x: 1 },
    };

    const approvalReq = context.addApprovalRequest(toolCall, "test_tool");
    const approvalResp = createApprovalResponse(approvalReq, true);
    context.addApprovalResponse(approvalResp);

    const fetched = context.getApprovalResponse("call_1");
    expect(fetched).toBeDefined();
    expect(fetched!.approved).toBe(true);
    expect(fetched!.toolCallId).toBe("call_1");
  });
});

// ============================================================================
// createApprovalResponse helper
// ============================================================================

describe("createApprovalResponse helper", () => {
  it("should create an approval response from a request", () => {
    const request: ToolApprovalRequest = {
      requestId: "approval_call_1",
      toolCallId: "call_1",
      toolName: "delete_file",
      parameters: { path: "/tmp/test.txt" },
      originalToolCall: {
        toolName: "delete_file",
        parameters: { path: "/tmp/test.txt" },
        callId: "call_1",
      },
    };

    const response = createApprovalResponse(request, true, "Looks safe");
    expect(response.requestId).toBe("approval_call_1");
    expect(response.toolCallId).toBe("call_1");
    expect(response.approved).toBe(true);
    expect(response.reason).toBe("Looks safe");
  });

  it("should create a rejection response", () => {
    const request: ToolApprovalRequest = {
      requestId: "approval_call_2",
      toolCallId: "call_2",
      toolName: "dangerous_op",
      parameters: { data: "sensitive" },
      originalToolCall: {
        toolName: "dangerous_op",
        parameters: { data: "sensitive" },
        callId: "call_2",
      },
    };

    const response = createApprovalResponse(request, false, "Too risky");
    expect(response.approved).toBe(false);
    expect(response.reason).toBe("Too risky");
  });
});

// ============================================================================
// AgentResponse approval helpers (from test_tool_approval_simple.py)
// ============================================================================

describe("AgentResponse approval helpers", () => {
  it("should report needsApproval=false when no pending approvals", () => {
    const context = new AgentContext();
    const response: AgentResponse = {
      context,
      source: "test_agent",
      usage: mockUsage(),
      finishReason: "stop",
      timestamp: new Date(),
    };

    expect(needsApproval(response)).toBe(false);
    expect(getApprovalRequests(response)).toEqual([]);
    expect(getMessages(response)).toEqual([]);
  });

  it("should report needsApproval=true when there are pending approvals", () => {
    const context = new AgentContext();

    const toolCall: ToolCallRequest = {
      callId: "call_1",
      toolName: "delete_file",
      parameters: { path: "/tmp/test.txt" },
    };
    context.addApprovalRequest(toolCall, "delete_file");

    const response: AgentResponse = {
      context,
      source: "test_agent",
      usage: mockUsage(),
      finishReason: "approval_needed",
      timestamp: new Date(),
    };

    expect(needsApproval(response)).toBe(true);
    expect(getApprovalRequests(response)).toHaveLength(1);
    expect(getApprovalRequests(response)[0].toolName).toBe("delete_file");
  });
});

// ============================================================================
// Agent Integration: Tool without approval executes immediately
// (from test_tool_approval.py::test_tool_without_approval)
// ============================================================================

describe("Agent tool execution without approval", () => {
  it("should execute a tool without approval immediately", async () => {
    const getWeather = createTool({
      name: "get_weather",
      description: "Get weather for a city",
      parametersSchema: z.object({
        city: z.string().describe("City name"),
      }),
      execute: ({ city }) => `Sunny in ${city}`,
    });

    const client = createMockLlmWithToolCalls([
      {
        callId: "call_1",
        toolName: "get_weather",
        parameters: { city: "Seattle" },
      },
    ]);

    const agent = new Agent({
      name: "test_agent",
      description: "Test agent",
      instructions: "You are helpful",
      modelClient: client,
      tools: [getWeather],
    });

    const response = await agent.run("What's the weather in Seattle?");

    const messages = getMessages(response);
    expect(messages.length).toBeGreaterThan(0);
    expect(needsApproval(response)).toBe(false);
    expect(response.finishReason).not.toBe("approval_needed");

    // Check for tool message with result
    const toolMessages = messages.filter((m) => m.role === "tool");
    expect(toolMessages.length).toBe(1);
    expect(toolMessages[0].content).toContain("Sunny in Seattle");
  });
});

// ============================================================================
// Agent Integration: Tool with approval pauses for approval
// (from test_tool_approval.py::test_tool_with_approval_required)
// ============================================================================

describe("Agent tool execution with approval required", () => {
  it("should pause for approval when tool requires it", async () => {
    const deleteFile = createTool({
      name: "delete_file",
      description: "Delete a file",
      parametersSchema: z.object({
        path: z.string().describe("File path"),
      }),
      execute: ({ path }) => `Deleted ${path}`,
      approvalMode: "always_require",
    });

    const client = createMockLlmWithToolCalls([
      {
        callId: "call_1",
        toolName: "delete_file",
        parameters: { path: "/tmp/test.txt" },
      },
    ]);

    const agent = new Agent({
      name: "test_agent",
      description: "Test agent",
      instructions: "You are helpful",
      modelClient: client,
      tools: [deleteFile],
    });

    const response = await agent.run("Delete /tmp/test.txt");

    // Should need approval
    expect(needsApproval(response)).toBe(true);
    expect(response.finishReason).toBe("approval_needed");

    const approvalRequests = getApprovalRequests(response);
    expect(approvalRequests).toHaveLength(1);
    expect(approvalRequests[0].toolName).toBe("delete_file");
    expect(approvalRequests[0].parameters).toEqual({
      path: "/tmp/test.txt",
    });
    expect(approvalRequests[0].toolCallId).toBe("call_1");

    // Tool should NOT have executed yet
    const messages = getMessages(response);
    const toolMessages = messages.filter((m) => m.role === "tool");
    expect(toolMessages).toHaveLength(0);
  });
});

// ============================================================================
// Context-level approval flow (approved)
// (from test_tool_approval.py::test_approval_flow_approved)
//
// Note: The TS agent's pause/resume mechanism requires the LLM to re-issue
// tool calls on resume. We test the context-level approval workflow here,
// and the first-run pause behavior in the agent integration tests above.
// ============================================================================

describe("Context-level approval flow - approved", () => {
  it("should track approval grant and provide approved tool calls", () => {
    const context = new AgentContext();

    const toolCall: ToolCallRequest = {
      callId: "call_1",
      toolName: "delete_file",
      parameters: { path: "/tmp/test.txt" },
    };

    // Simulate agent adding approval request
    const approvalReq = context.addApprovalRequest(toolCall, "delete_file");
    expect(context.waitingForApproval).toBe(true);

    // User approves
    const approvalResp = createApprovalResponse(approvalReq, true);
    context.addApprovalResponse(approvalResp);

    // No longer waiting
    expect(context.waitingForApproval).toBe(false);

    // Can retrieve the approval response by tool call ID
    const fetched = context.getApprovalResponse("call_1");
    expect(fetched).toBeDefined();
    expect(fetched!.approved).toBe(true);

    // Get approved tool calls (consumes them)
    const approved = context.getApprovedToolCalls();
    expect(approved).toHaveLength(1);
    expect(approved[0].toolName).toBe("delete_file");
    expect(approved[0].parameters).toEqual({ path: "/tmp/test.txt" });

    // State is cleared after retrieval
    expect(context.approvalResponses.size).toBe(0);
    expect(context.pendingToolCalls.size).toBe(0);
  });
});

// ============================================================================
// Context-level approval flow (rejected)
// (from test_tool_approval.py::test_approval_flow_rejected)
//
// Note: The TS agent's pause/resume mechanism requires the LLM to re-issue
// tool calls on resume. We test the context-level rejection workflow here.
// ============================================================================

describe("Context-level approval flow - rejected", () => {
  it("should track rejection and provide rejected tool calls", () => {
    const context = new AgentContext();

    const toolCall: ToolCallRequest = {
      callId: "call_1",
      toolName: "delete_file",
      parameters: { path: "/tmp/test.txt" },
    };

    // Simulate agent adding approval request
    const approvalReq = context.addApprovalRequest(toolCall, "delete_file");
    expect(context.waitingForApproval).toBe(true);

    // User rejects
    const approvalResp = createApprovalResponse(approvalReq, false, "Too risky");
    context.addApprovalResponse(approvalResp);

    // No longer waiting
    expect(context.waitingForApproval).toBe(false);

    // Should have no approved calls
    const approved = context.getApprovedToolCalls();
    expect(approved).toHaveLength(0);

    // Should have rejected calls
    const rejected = context.getRejectedToolCalls();
    expect(rejected).toHaveLength(1);
    expect(rejected[0][0]).toBe("call_1");
    expect(rejected[0][1].toolName).toBe("delete_file");
    expect(rejected[0][1].parameters).toEqual({ path: "/tmp/test.txt" });
  });
});

// ============================================================================
// Agent Integration: FunctionTool with approval mode
// (from test_tool_approval.py::test_approval_with_function_tool)
// ============================================================================

describe("FunctionTool with approval in agent", () => {
  it("should require approval when FunctionTool has ApprovalMode.ALWAYS", async () => {
    const dangerousTool = new FunctionTool({
      name: "dangerous_op",
      description: "A dangerous operation",
      parametersSchema: z.object({
        data: z.string().describe("Data to process"),
      }),
      func: ({ data }) => `Executed: ${data}`,
      approvalMode: ApprovalMode.ALWAYS,
    });

    expect(dangerousTool.approvalMode).toBe(ApprovalMode.ALWAYS);

    const client = createMockLlmWithToolCalls([
      {
        callId: "call_1",
        toolName: "dangerous_op",
        parameters: { data: "important" },
      },
    ]);

    const agent = new Agent({
      name: "test_agent",
      description: "Test agent",
      instructions: "You are helpful",
      modelClient: client,
      tools: [dangerousTool],
    });

    const response = await agent.run("Execute dangerous operation");
    expect(needsApproval(response)).toBe(true);
    expect(getApprovalRequests(response)[0].toolName).toBe("dangerous_op");
  });
});

// ============================================================================
// Agent Integration: Mixed approval tools
// (from test_tool_approval.py::test_mixed_approval_tools)
// ============================================================================

describe("Agent with mixed approval tools", () => {
  it("should execute no-approval tools and pause for approval-required tools", async () => {
    const getWeather = createTool({
      name: "get_weather",
      description: "Get weather for a city",
      parametersSchema: z.object({
        city: z.string().describe("City name"),
      }),
      execute: ({ city }) => `Sunny in ${city}`,
    });

    const deleteFile = createTool({
      name: "delete_file",
      description: "Delete a file",
      parametersSchema: z.object({
        path: z.string().describe("File path"),
      }),
      execute: ({ path }) => `Deleted ${path}`,
      approvalMode: "always_require",
    });

    const client = createMockLlmWithToolCalls([
      {
        callId: "call_1",
        toolName: "get_weather",
        parameters: { city: "Seattle" },
      },
      {
        callId: "call_2",
        toolName: "delete_file",
        parameters: { path: "/tmp/test.txt" },
      },
    ]);

    const agent = new Agent({
      name: "test_agent",
      description: "Test agent",
      instructions: "You are helpful",
      modelClient: client,
      tools: [getWeather, deleteFile],
    });

    const response = await agent.run(
      "Check weather in Seattle and delete /tmp/test.txt"
    );

    // Should need approval for delete_file
    expect(needsApproval(response)).toBe(true);
    const approvalRequests = getApprovalRequests(response);
    expect(approvalRequests).toHaveLength(1);
    expect(approvalRequests[0].toolName).toBe("delete_file");

    // get_weather should have executed (tool message present)
    const messages = getMessages(response);
    const toolMessages = messages.filter((m) => m.role === "tool");
    const weatherMsgs = toolMessages.filter((m) =>
      m.content.includes("Sunny")
    );
    expect(weatherMsgs).toHaveLength(1);

    // delete_file should NOT have executed yet
    const deleteMsgs = toolMessages.filter((m) =>
      m.content.includes("Deleted")
    );
    expect(deleteMsgs).toHaveLength(0);
  });
});

// ============================================================================
// Streaming: ToolApprovalEvent emission
// (from test_tool_approval.py::test_approval_event_emission)
// ============================================================================

describe("Approval event emission via streaming", () => {
  it("should emit tool_approval event when approval is needed", async () => {
    const deleteFile = createTool({
      name: "delete_file",
      description: "Delete a file",
      parametersSchema: z.object({
        path: z.string().describe("File path"),
      }),
      execute: ({ path }) => `Deleted ${path}`,
      approvalMode: "always_require",
    });

    const client = createMockLlmWithToolCalls([
      {
        callId: "call_1",
        toolName: "delete_file",
        parameters: { path: "/tmp/test.txt" },
      },
    ]);

    const agent = new Agent({
      name: "test_agent",
      description: "Test agent",
      instructions: "You are helpful",
      modelClient: client,
      tools: [deleteFile],
    });

    // Collect events from streaming
    const events: Array<{ eventType?: string; [key: string]: unknown }> = [];
    let finalResponse: AgentResponse | undefined;

    for await (const item of agent.runStream("Delete /tmp/test.txt")) {
      if (
        typeof item === "object" &&
        item !== null &&
        "finishReason" in item &&
        "usage" in item
      ) {
        finalResponse = item as AgentResponse;
      } else if (
        typeof item === "object" &&
        item !== null &&
        "eventType" in item
      ) {
        events.push(item as { eventType: string });
      }
    }

    // Should have emitted a tool_approval event
    const approvalEvents = events.filter(
      (e) => e.eventType === "tool_approval"
    );
    expect(approvalEvents).toHaveLength(1);

    const approvalEvent = approvalEvents[0] as {
      eventType: string;
      approvalRequest: ToolApprovalRequest;
    };
    expect(approvalEvent.approvalRequest.toolName).toBe("delete_file");

    // Final response should indicate approval needed
    expect(finalResponse).toBeDefined();
    expect(finalResponse!.finishReason).toBe("approval_needed");
  });
});
