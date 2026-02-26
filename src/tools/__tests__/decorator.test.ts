import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createTool } from "../decorator.js";
import { ApprovalMode } from "../base.js";

describe("createTool", () => {
  it("should create a tool from options", async () => {
    const tool = createTool({
      name: "greet",
      description: "Greet someone",
      parametersSchema: z.object({
        name: z.string(),
      }),
      execute: ({ name }) => `Hello, ${name}!`,
    });

    expect(tool.name).toBe("greet");
    expect(tool.description).toBe("Greet someone");
    expect(tool.approvalMode).toBe(ApprovalMode.NEVER);

    const result = await tool.execute({ name: "World" });
    expect(result.success).toBe(true);
    expect(result.result).toBe("Hello, World!");
  });

  it("should support approval mode as string", () => {
    const tool = createTool({
      name: "delete",
      description: "Delete something",
      parametersSchema: z.object({ id: z.string() }),
      execute: ({ id }) => `Deleted ${id}`,
      approvalMode: "always_require",
    });

    expect(tool.approvalMode).toBe(ApprovalMode.ALWAYS);
  });

  it("should support approval mode as enum", () => {
    const tool = createTool({
      name: "safe",
      description: "Safe operation",
      parametersSchema: z.object({}),
      execute: () => "done",
      approvalMode: ApprovalMode.NEVER,
    });

    expect(tool.approvalMode).toBe(ApprovalMode.NEVER);
  });

  it("should generate proper JSON schema", () => {
    const tool = createTool({
      name: "weather",
      description: "Get weather",
      parametersSchema: z.object({
        city: z.string(),
        units: z.enum(["celsius", "fahrenheit"]).optional(),
      }),
      execute: ({ city }) => `Weather in ${city}`,
    });

    const params = tool.parameters as {
      properties: Record<string, Record<string, unknown>>;
      required: string[];
    };

    expect(params.properties.city.type).toBe("string");
    expect(params.properties.units.enum).toEqual([
      "celsius",
      "fahrenheit",
    ]);
    expect(params.required).toContain("city");
    expect(params.required).not.toContain("units");
  });

  it("should handle async execute functions", async () => {
    const tool = createTool({
      name: "async_tool",
      description: "Async tool",
      parametersSchema: z.object({ delay: z.number() }),
      execute: async ({ delay }) => {
        await new Promise((r) => setTimeout(r, delay));
        return "done";
      },
    });

    const result = await tool.execute({ delay: 1 });
    expect(result.success).toBe(true);
    expect(result.result).toBe("done");
  });
});
