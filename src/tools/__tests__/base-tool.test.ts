import { describe, it, expect } from "vitest";
import { BaseTool, ApprovalMode } from "../base.js";
import type { ToolResult } from "../../types.js";

// Concrete test tool
class EchoTool extends BaseTool {
  constructor() {
    super("echo", "Echoes back the input");
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        message: { type: "string", description: "Message to echo" },
      },
      required: ["message"],
    };
  }

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    return {
      success: true,
      result: params.message,
      metadata: {},
    };
  }
}

describe("BaseTool", () => {
  it("should initialize with name and description", () => {
    const tool = new EchoTool();
    expect(tool.name).toBe("echo");
    expect(tool.description).toBe("Echoes back the input");
    expect(tool.version).toBe("1.0.0");
    expect(tool.approvalMode).toBe(ApprovalMode.NEVER);
  });

  it("should validate required parameters", () => {
    const tool = new EchoTool();
    expect(tool.validateParameters({ message: "hello" })).toBe(true);
    expect(tool.validateParameters({})).toBe(false);
  });

  it("should validate parameter types", () => {
    const tool = new EchoTool();
    expect(tool.validateParameters({ message: "hello" })).toBe(true);
    expect(tool.validateParameters({ message: 42 })).toBe(false);
  });

  it("should convert to LLM format", () => {
    const tool = new EchoTool();
    const format = tool.toLlmFormat();
    expect(format).toEqual({
      type: "function",
      function: {
        name: "echo",
        description: "Echoes back the input",
        parameters: tool.parameters,
      },
    });
  });

  it("should include version in name when not 1.0.0", () => {
    const tool = new (class extends BaseTool {
      constructor() {
        super("echo", "test", "2.0.0");
      }
      get parameters() {
        return { type: "object", properties: {} };
      }
      async execute() {
        return { success: true, result: null, metadata: {} };
      }
    })();

    const format = tool.toLlmFormat();
    expect((format.function as Record<string, unknown>).name).toBe("echo_v2.0.0");
  });

  it("should execute and return result", async () => {
    const tool = new EchoTool();
    const result = await tool.execute({ message: "hello" });
    expect(result.success).toBe(true);
    expect(result.result).toBe("hello");
  });

  it("should support streaming (default wraps execute)", async () => {
    const tool = new EchoTool();
    expect(tool.supportsStreaming()).toBe(false);

    const results: unknown[] = [];
    for await (const item of tool.executeStream({ message: "hi" })) {
      results.push(item);
    }
    expect(results).toHaveLength(1);
    expect((results[0] as ToolResult).success).toBe(true);
  });

  it("should have a toString", () => {
    const tool = new EchoTool();
    expect(tool.toString()).toBe("EchoTool(name='echo')");
  });
});
