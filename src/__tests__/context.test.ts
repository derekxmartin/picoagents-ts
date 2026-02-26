import { describe, it, expect } from "vitest";
import { AgentContext, createApprovalResponse } from "../context.js";
import type { ToolCallRequest } from "../messages.js";

describe("AgentContext", () => {
  it("should initialize with defaults", () => {
    const ctx = new AgentContext();
    expect(ctx.messageCount).toBe(0);
    expect(ctx.isEmpty).toBe(true);
    expect(ctx.waitingForApproval).toBe(false);
  });

  it("should initialize with provided messages", () => {
    const ctx = new AgentContext({
      messages: [
        {
          role: "user" as const,
          content: "Hello",
          source: "user",
          timestamp: new Date(),
        },
      ],
      sessionId: "session-123",
    });
    expect(ctx.messageCount).toBe(1);
    expect(ctx.sessionId).toBe("session-123");
  });

  it("should add and retrieve messages", () => {
    const ctx = new AgentContext();
    ctx.addMessage({
      role: "user" as const,
      content: "Hi",
      source: "user",
      timestamp: new Date(),
    });
    ctx.addMessage({
      role: "assistant" as const,
      content: "Hello!",
      source: "agent",
      timestamp: new Date(),
    });

    expect(ctx.messageCount).toBe(2);
    expect(ctx.getLastUserMessage()?.content).toBe("Hi");
    expect(ctx.getLastAssistantMessage()?.content).toBe("Hello!");
  });

  it("should clear messages", () => {
    const ctx = new AgentContext();
    ctx.addMessage({
      role: "user" as const,
      content: "Hi",
      source: "user",
      timestamp: new Date(),
    });
    ctx.clearMessages();
    expect(ctx.isEmpty).toBe(true);
  });

  it("should reset fully", () => {
    const ctx = new AgentContext({
      metadata: { key: "value" },
      sharedState: { x: 1 },
    });
    ctx.addMessage({
      role: "user" as const,
      content: "Hi",
      source: "user",
      timestamp: new Date(),
    });
    ctx.reset();
    expect(ctx.isEmpty).toBe(true);
    expect(Object.keys(ctx.metadata)).toHaveLength(0);
    expect(Object.keys(ctx.sharedState)).toHaveLength(0);
  });

  describe("Approval workflow", () => {
    it("should add and process approval requests", () => {
      const ctx = new AgentContext();
      const toolCall: ToolCallRequest = {
        toolName: "dangerous_tool",
        parameters: { action: "delete" },
        callId: "call_1",
      };

      const request = ctx.addApprovalRequest(toolCall, "dangerous_tool");
      expect(ctx.waitingForApproval).toBe(true);
      expect(request.requestId).toBe("approval_call_1");

      // Approve it
      const response = createApprovalResponse(request, true, "Looks safe");
      ctx.addApprovalResponse(response);
      expect(ctx.waitingForApproval).toBe(false);

      const approved = ctx.getApprovedToolCalls();
      expect(approved).toHaveLength(1);
      expect(approved[0].toolName).toBe("dangerous_tool");
    });

    it("should handle rejections", () => {
      const ctx = new AgentContext();
      const toolCall: ToolCallRequest = {
        toolName: "risky_tool",
        parameters: {},
        callId: "call_2",
      };

      const request = ctx.addApprovalRequest(toolCall, "risky_tool");
      const response = createApprovalResponse(request, false, "Too risky");
      ctx.addApprovalResponse(response);

      const rejected = ctx.getRejectedToolCalls();
      expect(rejected).toHaveLength(1);
      expect(rejected[0][0]).toBe("call_2");
    });
  });

  it("should create from messages (static)", () => {
    const ctx = AgentContext.fromMessages([
      {
        role: "user" as const,
        content: "Hello",
        source: "user",
        timestamp: new Date(),
      },
    ]);
    expect(ctx.messageCount).toBe(1);
  });

  it("should serialize to dict", () => {
    const ctx = new AgentContext({ sessionId: "s1" });
    const dict = ctx.toDict();
    expect(dict.sessionId).toBe("s1");
    expect(Array.isArray(dict.messages)).toBe(true);
  });
});
