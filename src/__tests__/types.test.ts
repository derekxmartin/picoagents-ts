import { describe, it, expect } from "vitest";
import {
  UsageSchema,
  addUsage,
  ToolResultSchema,
  createEvent,
  type Usage,
  type TaskStartEvent,
  type ToolCallEvent,
} from "../types.js";

describe("Types", () => {
  describe("Usage", () => {
    it("should parse valid usage", () => {
      const usage = UsageSchema.parse({
        durationMs: 1000,
        llmCalls: 2,
        tokensInput: 500,
        tokensOutput: 100,
      });
      expect(usage.durationMs).toBe(1000);
      expect(usage.llmCalls).toBe(2);
      expect(usage.toolCalls).toBe(0); // default
    });

    it("should aggregate two usages", () => {
      const a: Usage = {
        durationMs: 500,
        llmCalls: 1,
        tokensInput: 100,
        tokensOutput: 50,
        toolCalls: 1,
        memoryOperations: 0,
      };
      const b: Usage = {
        durationMs: 800,
        llmCalls: 2,
        tokensInput: 200,
        tokensOutput: 100,
        toolCalls: 3,
        memoryOperations: 1,
        costEstimate: 0.01,
      };
      const sum = addUsage(a, b);
      expect(sum.durationMs).toBe(800); // max
      expect(sum.llmCalls).toBe(3);
      expect(sum.tokensInput).toBe(300);
      expect(sum.toolCalls).toBe(4);
    });
  });

  describe("ToolResult", () => {
    it("should parse a successful result", () => {
      const result = ToolResultSchema.parse({
        success: true,
        result: 42,
      });
      expect(result.success).toBe(true);
      expect(result.result).toBe(42);
      expect(result.error).toBeUndefined();
    });

    it("should parse a failed result with error", () => {
      const result = ToolResultSchema.parse({
        success: false,
        result: null,
        error: "Something went wrong",
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe("Something went wrong");
    });
  });

  describe("Events", () => {
    it("should create a TaskStartEvent", () => {
      const event = createEvent<TaskStartEvent>({
        eventType: "task_start",
        source: "agent",
        task: "Find teletubbies",
      });
      expect(event.eventType).toBe("task_start");
      expect(event.task).toBe("Find teletubbies");
      expect(event.timestamp).toBeInstanceOf(Date);
    });

    it("should create a ToolCallEvent", () => {
      const event = createEvent<ToolCallEvent>({
        eventType: "tool_call",
        source: "agent",
        toolName: "calculator",
        parameters: { expression: "2+2" },
        callId: "call_1",
      });
      expect(event.eventType).toBe("tool_call");
      expect(event.toolName).toBe("calculator");
    });
  });
});
