import { describe, it, expect } from "vitest";
import {
  SystemMessageSchema,
  UserMessageSchema,
  AssistantMessageSchema,
  ToolMessageSchema,
  ToolCallRequestSchema,
  formatMessage,
  type SystemMessage,
  type AssistantMessage,
} from "../messages.js";

describe("Messages", () => {
  describe("SystemMessage", () => {
    it("should parse a valid system message", () => {
      const msg = SystemMessageSchema.parse({
        content: "You are a helpful assistant",
        source: "system",
      });
      expect(msg.role).toBe("system");
      expect(msg.content).toBe("You are a helpful assistant");
      expect(msg.source).toBe("system");
      expect(msg.timestamp).toBeInstanceOf(Date);
    });

    it("should reject missing content", () => {
      expect(() =>
        SystemMessageSchema.parse({ source: "system" })
      ).toThrow();
    });
  });

  describe("UserMessage", () => {
    it("should parse with optional name", () => {
      const msg = UserMessageSchema.parse({
        content: "Hello",
        source: "user",
        name: "Alice",
      });
      expect(msg.role).toBe("user");
      expect(msg.name).toBe("Alice");
    });

    it("should parse without name", () => {
      const msg = UserMessageSchema.parse({
        content: "Hello",
        source: "user",
      });
      expect(msg.name).toBeUndefined();
    });
  });

  describe("AssistantMessage", () => {
    it("should parse with tool calls", () => {
      const msg = AssistantMessageSchema.parse({
        content: "",
        source: "agent",
        toolCalls: [
          {
            toolName: "calculator",
            parameters: { expression: "2+2" },
            callId: "call_1",
          },
        ],
      });
      expect(msg.role).toBe("assistant");
      expect(msg.toolCalls).toHaveLength(1);
      expect(msg.toolCalls![0].toolName).toBe("calculator");
    });

    it("should parse without tool calls", () => {
      const msg = AssistantMessageSchema.parse({
        content: "Hello!",
        source: "agent",
      });
      expect(msg.toolCalls).toBeUndefined();
    });
  });

  describe("ToolMessage", () => {
    it("should parse a successful tool result", () => {
      const msg = ToolMessageSchema.parse({
        content: "4",
        source: "calculator",
        toolCallId: "call_1",
        toolName: "calculator",
        success: true,
      });
      expect(msg.role).toBe("tool");
      expect(msg.success).toBe(true);
      expect(msg.error).toBeUndefined();
    });

    it("should parse a failed tool result", () => {
      const msg = ToolMessageSchema.parse({
        content: "Error",
        source: "calculator",
        toolCallId: "call_1",
        toolName: "calculator",
        success: false,
        error: "Division by zero",
      });
      expect(msg.success).toBe(false);
      expect(msg.error).toBe("Division by zero");
    });
  });

  describe("ToolCallRequest", () => {
    it("should parse valid request", () => {
      const req = ToolCallRequestSchema.parse({
        toolName: "search",
        parameters: { query: "hello" },
        callId: "abc123",
      });
      expect(req.toolName).toBe("search");
      expect(req.parameters.query).toBe("hello");
    });
  });

  describe("formatMessage", () => {
    it("should format a simple message", () => {
      const msg: SystemMessage = {
        role: "system",
        content: "Hello",
        source: "sys",
        timestamp: new Date("2024-01-01T12:00:00Z"),
      };
      const formatted = formatMessage(msg);
      expect(formatted).toContain("[sys]");
      expect(formatted).toContain("Hello");
    });

    it("should format assistant with tool calls", () => {
      const msg: AssistantMessage = {
        role: "assistant",
        content: "",
        source: "agent",
        timestamp: new Date("2024-01-01T12:00:00Z"),
        toolCalls: [
          { toolName: "calc", parameters: { x: 1 }, callId: "c1" },
        ],
      };
      const formatted = formatMessage(msg);
      expect(formatted).toContain("calling tools");
      expect(formatted).toContain("calc");
    });
  });
});
