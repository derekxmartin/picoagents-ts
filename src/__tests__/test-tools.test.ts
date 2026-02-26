/**
 * Comprehensive tests for picoagents-ts tool system.
 *
 * Covers:
 * - Tool creation with FunctionTool and createTool
 * - Custom BaseTool subclass
 * - Tool finding by name
 * - Tools for LLM format
 * - ThinkTool functionality
 * - Tool versioning
 * - Core tools factory
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { Agent } from "../agents/agent.js";
import { BaseTool } from "../tools/base.js";
import { FunctionTool } from "../tools/function-tool.js";
import { createTool } from "../tools/decorator.js";
import { createCoreTools, ThinkTool } from "../tools/core-tools.js";
import type { BaseChatCompletionClient } from "../llm/base.js";
import type {
  ChatCompletionResult,
  ChatCompletionChunk,
  Usage,
  ToolResult,
} from "../types.js";
import type { AssistantMessage } from "../messages.js";

// ============================================================================
// Mock Classes and Test Helpers
// ============================================================================

function mockUsage(): Usage {
  return {
    durationMs: 100,
    llmCalls: 1,
    tokensInput: 10,
    tokensOutput: 20,
    toolCalls: 0,
    memoryOperations: 0,
  };
}

function createMockLlm(
  responses?: ChatCompletionResult[]
): BaseChatCompletionClient {
  const defaultResponses: ChatCompletionResult[] = [
    {
      message: {
        role: "assistant",
        content: "Test response",
        source: "mock",
        timestamp: new Date(),
      } as AssistantMessage,
      usage: mockUsage(),
      model: "mock-model",
      finishReason: "stop",
    },
  ];
  const resps = responses ?? defaultResponses;
  let callIndex = 0;
  return {
    create: async () => {
      const r = resps[callIndex % resps.length];
      callIndex++;
      return r;
    },
    createStream: async function* () {
      const r = resps[callIndex % resps.length];
      callIndex++;
      yield {
        content: r.message.content ?? "",
        isComplete: true,
      } as ChatCompletionChunk;
    },
    totalUsage: mockUsage(),
    actualUsage: mockUsage(),
    model: "mock-model",
  } as unknown as BaseChatCompletionClient;
}

// Simple FunctionTool instances used across tests
const simpleTool = new FunctionTool({
  name: "simple_function",
  description: "A simple test function",
  parametersSchema: z.object({
    text: z.string().describe("Text to process"),
  }),
  func: ({ text }) => `Processed: ${text}`,
});

const mathTool = new FunctionTool({
  name: "math_function",
  description: "Add two numbers",
  parametersSchema: z.object({
    a: z.number().int().describe("First number"),
    b: z.number().int().describe("Second number"),
  }),
  func: ({ a, b }) => a + b,
});

// Custom BaseTool subclass for testing
class CustomTool extends BaseTool {
  constructor() {
    super("custom_tool", "A custom tool for testing");
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        message: { type: "string", description: "Message to process" },
      },
      required: ["message"],
    };
  }

  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    return {
      success: true,
      result: `Custom tool processed: ${parameters.message ?? ""}`,
      metadata: { tool_name: this.name },
    };
  }
}

// ============================================================================
// Tool Wrapping and Management Tests
// ============================================================================

describe("Tool wrapping and management", () => {
  it("should accept FunctionTool instances in agent tools", () => {
    const client = createMockLlm();

    const agent = new Agent({
      name: "test-agent",
      description: "Test agent",
      instructions: "You are helpful",
      modelClient: client,
      tools: [simpleTool],
    });

    expect(agent.tools).toHaveLength(1);
    expect(agent.tools[0]).toBeInstanceOf(FunctionTool);
    expect(agent.tools[0].name).toBe("simple_function");
  });

  it("should support mixed tool types (FunctionTool and custom BaseTool)", () => {
    const client = createMockLlm();
    const customTool = new CustomTool();

    const agent = new Agent({
      name: "mixed-agent",
      description: "Agent with mixed tools",
      instructions: "You are helpful",
      modelClient: client,
      tools: [simpleTool, mathTool, customTool],
    });

    // Check all tools are present
    expect(agent.tools).toHaveLength(3);

    // Check types
    expect(agent.tools[0]).toBeInstanceOf(FunctionTool);
    expect(agent.tools[1]).toBeInstanceOf(FunctionTool);
    expect(agent.tools[2]).toBeInstanceOf(CustomTool);

    // Check names
    const toolNames = agent.tools.map((tool) => tool.name);
    expect(toolNames).toContain("simple_function");
    expect(toolNames).toContain("math_function");
    expect(toolNames).toContain("custom_tool");
  });
});

// ============================================================================
// Tool Finding Tests
// ============================================================================

describe("Tool finding", () => {
  it("should find tools by name", () => {
    const client = createMockLlm();

    const agent = new Agent({
      name: "finder-agent",
      description: "Test agent",
      instructions: "You are helpful",
      modelClient: client,
      tools: [simpleTool, mathTool],
    });

    // Test finding existing tools
    const tool1 = agent.findTool("simple_function");
    expect(tool1).toBeDefined();
    expect(tool1!.name).toBe("simple_function");

    const tool2 = agent.findTool("math_function");
    expect(tool2).toBeDefined();
    expect(tool2!.name).toBe("math_function");

    // Test finding non-existent tool
    const tool3 = agent.findTool("nonexistent_tool");
    expect(tool3).toBeUndefined();
  });
});

// ============================================================================
// Tools for LLM Format Tests
// ============================================================================

describe("Tools for LLM format", () => {
  it("should convert tools to OpenAI format", () => {
    const client = createMockLlm();

    const agent = new Agent({
      name: "llm-agent",
      description: "Test agent",
      instructions: "You are helpful",
      modelClient: client,
      tools: [simpleTool],
    });

    const llmTools = agent.getToolsForLlm();

    // Should have one tool
    expect(llmTools).toHaveLength(1);

    // Check OpenAI format
    const toolDef = llmTools[0] as Record<string, unknown>;
    expect(toolDef.type).toBe("function");
    expect(toolDef).toHaveProperty("function");

    const fn = toolDef.function as Record<string, unknown>;
    expect(fn.name).toBe("simple_function");
    expect(fn).toHaveProperty("description");
    expect(fn).toHaveProperty("parameters");
  });
});

// ============================================================================
// ThinkTool Tests
// ============================================================================

describe("ThinkTool", () => {
  it("should have correct properties", () => {
    const think = new ThinkTool();

    expect(think.name).toBe("think");
    expect(think.description.toLowerCase()).toContain("pause and think");

    const params = think.parameters as {
      properties: Record<string, unknown>;
    };
    expect(params.properties).toHaveProperty("thought");
  });

  it("should execute and record reasoning", async () => {
    const think = new ThinkTool();

    const result = await think.execute({
      thought: "I need to analyze these results carefully.",
    });

    expect(result.success).toBe(true);
    expect(result.result as string).toContain("Reasoning recorded");
    expect(result.metadata.tool_name).toBe("think");
  });

  it("should be included in core tools", () => {
    const tools = createCoreTools();
    const toolNames = tools.map((t) => t.name);

    expect(toolNames).toContain("think");
    // ThinkTool should be first (most important for complex reasoning)
    expect(tools[0].name).toBe("think");
  });
});

// ============================================================================
// Tool Versioning Tests
// ============================================================================

describe("Tool versioning", () => {
  it("should support default version (1.0.0) without appending to name", () => {
    class VersionedTool extends BaseTool {
      constructor(version = "1.0.0") {
        super("test_tool", "Test tool with versioning", version);
      }

      get parameters(): Record<string, unknown> {
        return { type: "object", properties: {} };
      }

      async execute(
        _parameters: Record<string, unknown>
      ): Promise<ToolResult> {
        return { success: true, result: "ok", metadata: {} };
      }
    }

    const toolV1 = new VersionedTool();
    expect(toolV1.version).toBe("1.0.0");

    const llmFormat = toolV1.toLlmFormat() as {
      function: { name: string };
    };
    // Default version (1.0.0) should not be appended to name
    expect(llmFormat.function.name).toBe("test_tool");
  });

  it("should append non-default version to name in LLM format", () => {
    class VersionedTool extends BaseTool {
      constructor(version = "1.0.0") {
        super("test_tool", "Test tool with versioning", version);
      }

      get parameters(): Record<string, unknown> {
        return { type: "object", properties: {} };
      }

      async execute(
        _parameters: Record<string, unknown>
      ): Promise<ToolResult> {
        return { success: true, result: "ok", metadata: {} };
      }
    }

    const toolV2 = new VersionedTool("2.0.0");
    expect(toolV2.version).toBe("2.0.0");

    const llmFormatV2 = toolV2.toLlmFormat() as {
      function: { name: string };
    };
    // Non-default versions should be appended
    expect(llmFormatV2.function.name).toBe("test_tool_v2.0.0");
  });

  it("should support versioning in FunctionTool", () => {
    const tool = new FunctionTool({
      name: "my_function",
      description: "Double the input",
      parametersSchema: z.object({
        x: z.number().int().describe("Input number"),
      }),
      func: ({ x }) => x * 2,
      version: "2.1.0",
    });

    expect(tool.version).toBe("2.1.0");

    const llmFormat = tool.toLlmFormat() as {
      function: { name: string };
    };
    expect(llmFormat.function.name).toBe("my_function_v2.1.0");
  });
});

// ============================================================================
// FunctionTool Execution Tests
// ============================================================================

describe("FunctionTool execution", () => {
  it("should execute a simple function tool", async () => {
    const result = await simpleTool.execute({ text: "hello" });

    expect(result.success).toBe(true);
    expect(result.result).toBe("Processed: hello");
    expect(result.metadata.tool_name).toBe("simple_function");
  });

  it("should execute a math function tool", async () => {
    const result = await mathTool.execute({ a: 3, b: 5 });

    expect(result.success).toBe(true);
    expect(result.result).toBe(8);
    expect(result.metadata.tool_name).toBe("math_function");
  });

  it("should return error for invalid parameters", async () => {
    const result = await simpleTool.execute({
      wrong_param: "hello",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error!).toContain("Invalid parameters");
  });
});

// ============================================================================
// Custom BaseTool Tests
// ============================================================================

describe("Custom BaseTool subclass", () => {
  it("should execute custom tool", async () => {
    const customTool = new CustomTool();

    const result = await customTool.execute({ message: "Hello" });

    expect(result.success).toBe(true);
    expect(result.result).toBe("Custom tool processed: Hello");
    expect(result.metadata.tool_name).toBe("custom_tool");
  });

  it("should have correct parameters schema", () => {
    const customTool = new CustomTool();

    const params = customTool.parameters as {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
    };

    expect(params.type).toBe("object");
    expect(params.properties).toHaveProperty("message");
    expect(params.required).toContain("message");
  });

  it("should convert to LLM format", () => {
    const customTool = new CustomTool();

    const llmFormat = customTool.toLlmFormat() as {
      type: string;
      function: { name: string; description: string; parameters: unknown };
    };

    expect(llmFormat.type).toBe("function");
    expect(llmFormat.function.name).toBe("custom_tool");
    expect(llmFormat.function.description).toBe(
      "A custom tool for testing"
    );
  });
});

// ============================================================================
// createTool Tests
// ============================================================================

describe("createTool factory", () => {
  it("should create a FunctionTool via createTool", () => {
    const weatherTool = createTool({
      name: "get_weather",
      description: "Get the weather for a city",
      parametersSchema: z.object({
        city: z.string().describe("City name"),
        unit: z
          .enum(["celsius", "fahrenheit"])
          .optional()
          .describe("Temperature unit"),
      }),
      execute: ({ city, unit }) =>
        `Weather in ${city}: 72 ${unit ?? "celsius"}`,
    });

    expect(weatherTool).toBeInstanceOf(FunctionTool);
    expect(weatherTool.name).toBe("get_weather");
    expect(weatherTool.description).toBe("Get the weather for a city");
  });

  it("should execute a tool created with createTool", async () => {
    const greetTool = createTool({
      name: "greet",
      description: "Greet someone",
      parametersSchema: z.object({
        name: z.string().describe("Person's name"),
      }),
      execute: ({ name }) => `Hello, ${name}!`,
    });

    const result = await greetTool.execute({ name: "World" });

    expect(result.success).toBe(true);
    expect(result.result).toBe("Hello, World!");
  });

  it("should support versioning via createTool", () => {
    const tool = createTool({
      name: "versioned_tool",
      description: "A versioned tool",
      parametersSchema: z.object({
        input: z.string(),
      }),
      execute: ({ input }) => input,
      version: "3.0.0",
    });

    expect(tool.version).toBe("3.0.0");

    const llmFormat = tool.toLlmFormat() as {
      function: { name: string };
    };
    expect(llmFormat.function.name).toBe("versioned_tool_v3.0.0");
  });
});

// ============================================================================
// Enum Validation Tests
// ============================================================================

describe("Enum validation with Zod", () => {
  it("should include enum constraint in parameters schema", () => {
    const weatherTool = new FunctionTool({
      name: "weather",
      description: "Get weather",
      parametersSchema: z.object({
        location: z.string().describe("Location"),
        unit: z
          .enum(["celsius", "fahrenheit"])
          .describe("Temperature unit"),
      }),
      func: ({ location, unit }) =>
        `Weather in ${location}: 72 ${unit}`,
    });

    const schema = weatherTool.parameters as {
      properties: Record<string, { enum?: string[] }>;
    };

    expect(schema.properties).toHaveProperty("unit");

    const unitSchema = schema.properties.unit;
    if (unitSchema.enum) {
      expect(new Set(unitSchema.enum)).toEqual(
        new Set(["celsius", "fahrenheit"])
      );
    }
  });
});

// ============================================================================
// Core Tools Factory Tests
// ============================================================================

describe("Core tools factory", () => {
  it("should return an array of core tools", () => {
    const tools = createCoreTools();

    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool).toBeInstanceOf(BaseTool);
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
    }
  });

  it("should include ThinkTool as first core tool", () => {
    const tools = createCoreTools();

    expect(tools[0]).toBeInstanceOf(ThinkTool);
    expect(tools[0].name).toBe("think");
  });

  it("should produce valid LLM format for all core tools", () => {
    const tools = createCoreTools();

    for (const tool of tools) {
      const fmt = tool.toLlmFormat() as {
        type: string;
        function: {
          name: string;
          description: string;
          parameters: unknown;
        };
      };

      expect(fmt.type).toBe("function");
      expect(fmt.function.name).toBeTruthy();
      expect(fmt.function.description).toBeTruthy();
      expect(fmt.function.parameters).toBeDefined();
    }
  });
});
