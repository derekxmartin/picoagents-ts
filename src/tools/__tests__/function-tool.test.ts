import { describe, it, expect } from "vitest";
import { z } from "zod";
import { FunctionTool } from "../function-tool.js";
import { ApprovalMode } from "../base.js";

describe("FunctionTool", () => {
  it("should wrap a sync function", async () => {
    const tool = new FunctionTool({
      func: ({ a, b }: { a: number; b: number }) => a + b,
      parametersSchema: z.object({
        a: z.number(),
        b: z.number(),
      }),
      name: "add",
      description: "Add two numbers",
    });

    expect(tool.name).toBe("add");
    const result = await tool.execute({ a: 2, b: 3 });
    expect(result.success).toBe(true);
    expect(result.result).toBe(5);
  });

  it("should wrap an async function", async () => {
    const tool = new FunctionTool({
      func: async ({ x }: { x: string }) => `Hello, ${x}!`,
      parametersSchema: z.object({
        x: z.string(),
      }),
      name: "greet",
      description: "Greet someone",
    });

    const result = await tool.execute({ x: "World" });
    expect(result.success).toBe(true);
    expect(result.result).toBe("Hello, World!");
  });

  it("should validate parameters with Zod", async () => {
    const tool = new FunctionTool({
      func: ({ n }: { n: number }) => n * 2,
      parametersSchema: z.object({
        n: z.number(),
      }),
      name: "double",
      description: "Double a number",
    });

    // Pass string where number expected
    const result = await tool.execute({ n: "not_a_number" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid parameters");
  });

  it("should handle execution errors gracefully", async () => {
    const tool = new FunctionTool({
      func: () => {
        throw new Error("Boom!");
      },
      parametersSchema: z.object({}),
      name: "explode",
      description: "Always fails",
    });

    const result = await tool.execute({});
    expect(result.success).toBe(false);
    expect(result.error).toBe("Boom!");
    expect(result.metadata).toHaveProperty("exception_type", "Error");
  });

  it("should generate JSON schema from Zod schema", () => {
    const tool = new FunctionTool({
      func: (_: { city: string; units?: string }) => "sunny",
      parametersSchema: z.object({
        city: z.string(),
        units: z.string().optional(),
      }),
      name: "weather",
      description: "Get weather",
    });

    const params = tool.parameters as {
      type: string;
      properties: Record<string, Record<string, unknown>>;
      required: string[];
    };

    expect(params.type).toBe("object");
    expect(params.properties.city.type).toBe("string");
    expect(params.properties.units.type).toBe("string");
    expect(params.required).toContain("city");
    expect(params.required).not.toContain("units");
  });

  it("should handle enum schemas", () => {
    const tool = new FunctionTool({
      func: (_: { direction: string }) => "ok",
      parametersSchema: z.object({
        direction: z.enum(["up", "down", "left", "right"]),
      }),
      name: "move",
      description: "Move in a direction",
    });

    const params = tool.parameters as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(params.properties.direction.enum).toEqual([
      "up",
      "down",
      "left",
      "right",
    ]);
  });

  it("should support approval mode", () => {
    const tool = new FunctionTool({
      func: () => "done",
      parametersSchema: z.object({}),
      name: "dangerous",
      description: "Dangerous operation",
      approvalMode: ApprovalMode.ALWAYS,
    });

    expect(tool.approvalMode).toBe(ApprovalMode.ALWAYS);
  });

  it("should be directly callable via call()", async () => {
    const tool = new FunctionTool({
      func: ({ x }: { x: number }) => x * 10,
      parametersSchema: z.object({ x: z.number() }),
      name: "times10",
      description: "Multiply by 10",
    });

    const result = await tool.call({ x: 5 });
    expect(result).toBe(50);
  });
});
