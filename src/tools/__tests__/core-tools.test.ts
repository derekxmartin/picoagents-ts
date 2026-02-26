import { describe, it, expect } from "vitest";
import {
  ThinkTool,
  CalculatorTool,
  DateTimeTool,
  JSONParserTool,
  RegexTool,
  TaskStatusTool,
  createCoreTools,
} from "../core-tools.js";

describe("Core Tools", () => {
  describe("ThinkTool", () => {
    it("should record reasoning", async () => {
      const tool = new ThinkTool();
      const result = await tool.execute({
        thought: "I should try approach B",
      });
      expect(result.success).toBe(true);
      expect(result.result).toContain("Reasoning recorded");
    });

    it("should truncate long thoughts", async () => {
      const tool = new ThinkTool();
      const result = await tool.execute({
        thought: "x".repeat(200),
      });
      expect(result.result as string).toContain("...");
    });
  });

  describe("CalculatorTool", () => {
    it("should evaluate basic arithmetic", async () => {
      const tool = new CalculatorTool();
      const result = await tool.execute({ expression: "2 + 3 * 4" });
      expect(result.success).toBe(true);
      expect(result.result).toBe("14");
    });

    it("should support math functions", async () => {
      const tool = new CalculatorTool();
      const result = await tool.execute({ expression: "sqrt(16)" });
      expect(result.success).toBe(true);
      expect(result.result).toBe("4");
    });

    it("should support constants", async () => {
      const tool = new CalculatorTool();
      const result = await tool.execute({ expression: "pi" });
      expect(result.success).toBe(true);
      expect(parseFloat(result.result as string)).toBeCloseTo(Math.PI);
    });

    it("should handle invalid expressions", async () => {
      const tool = new CalculatorTool();
      const result = await tool.execute({ expression: "invalid()" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to evaluate");
    });
  });

  describe("DateTimeTool", () => {
    it("should get current time", async () => {
      const tool = new DateTimeTool();
      const result = await tool.execute({ operation: "now" });
      expect(result.success).toBe(true);
      expect(result.result as string).toMatch(/\d{4}-\d{2}-\d{2}T/);
    });

    it("should parse ISO datetime", async () => {
      const tool = new DateTimeTool();
      const result = await tool.execute({
        operation: "parse",
        value: "2024-01-15T10:30:00Z",
      });
      expect(result.success).toBe(true);
      expect(result.result as string).toContain("2024");
    });

    it("should fail on missing value for parse", async () => {
      const tool = new DateTimeTool();
      const result = await tool.execute({ operation: "parse" });
      expect(result.success).toBe(false);
    });
  });

  describe("JSONParserTool", () => {
    it("should parse valid JSON", async () => {
      const tool = new JSONParserTool();
      const result = await tool.execute({
        json_string: '{"name": "Alice", "age": 30}',
      });
      expect(result.success).toBe(true);
      expect(result.result).toEqual({ name: "Alice", age: 30 });
    });

    it("should extract with path", async () => {
      const tool = new JSONParserTool();
      const result = await tool.execute({
        json_string: '{"user": {"name": "Bob"}}',
        path: "user.name",
      });
      expect(result.success).toBe(true);
      expect(result.result).toBe("Bob");
    });

    it("should handle invalid JSON", async () => {
      const tool = new JSONParserTool();
      const result = await tool.execute({ json_string: "not json" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid JSON");
    });
  });

  describe("RegexTool", () => {
    it("should search for pattern", async () => {
      const tool = new RegexTool();
      const result = await tool.execute({
        operation: "search",
        pattern: "\\d+",
        text: "abc 123 def",
      });
      expect(result.success).toBe(true);
      expect(result.result).toBe("123");
    });

    it("should find all matches", async () => {
      const tool = new RegexTool();
      const result = await tool.execute({
        operation: "findall",
        pattern: "\\d+",
        text: "a1 b2 c3",
      });
      expect(result.success).toBe(true);
      expect(result.result).toEqual(["1", "2", "3"]);
    });

    it("should replace", async () => {
      const tool = new RegexTool();
      const result = await tool.execute({
        operation: "replace",
        pattern: "\\d+",
        text: "a1 b2 c3",
        replacement: "#",
      });
      expect(result.success).toBe(true);
      expect(result.result).toBe("a# b# c#");
    });

    it("should support case-insensitive flag", async () => {
      const tool = new RegexTool();
      const result = await tool.execute({
        operation: "search",
        pattern: "hello",
        text: "HELLO world",
        flags: "i",
      });
      expect(result.success).toBe(true);
      expect(result.result).toBe("HELLO");
    });
  });

  describe("TaskStatusTool", () => {
    it("should format complete status", async () => {
      const tool = new TaskStatusTool();
      const result = await tool.execute({
        status: "complete",
        rationale: "All requirements met",
        requirements_met: ["Req 1", "Req 2"],
      });
      expect(result.success).toBe(true);
      expect(result.result as string).toContain("COMPLETE");
      expect(result.result as string).toContain("All requirements met");
    });

    it("should format incomplete status", async () => {
      const tool = new TaskStatusTool();
      const result = await tool.execute({
        status: "incomplete",
        rationale: "Need more info",
        requirements_pending: ["Missing data"],
      });
      expect(result.success).toBe(true);
      expect(result.result as string).toContain("INCOMPLETE");
    });
  });

  describe("createCoreTools", () => {
    it("should return all 6 core tools", () => {
      const tools = createCoreTools();
      expect(tools).toHaveLength(6);
      const names = tools.map((t) => t.name);
      expect(names).toContain("think");
      expect(names).toContain("calculator");
      expect(names).toContain("datetime");
      expect(names).toContain("json_parser");
      expect(names).toContain("regex");
      expect(names).toContain("task_status");
    });
  });
});
