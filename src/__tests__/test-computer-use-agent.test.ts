/**
 * Tests for ComputerUseAgent — converted from Python test_computer_use_agent.py.
 *
 * Focuses on tests NOT already covered in
 * src/agents/computer-use/__tests__/computer-use.test.ts:
 *   - Agent asTool conversion with schema validation
 *   - ComputerUseAgent asTool and use in a coordinator Agent
 *   - Default description verification
 *
 * NOTE: base.asTool() uses require("./agent-as-tool.js") which does not
 * resolve in vitest, so we construct AgentAsTool directly — the same
 * pattern used in test-agent-as-tool.test.ts.
 */

import { describe, it, expect, vi } from "vitest";
import {
  BaseInterfaceClient,
  type Action,
  type ActionResult,
  type InterfaceState,
  ComputerUseAgent,
} from "../agents/computer-use/index.js";
import { Agent } from "../agents/agent.js";
import { AgentAsTool } from "../agents/agent-as-tool.js";
import type { BaseChatCompletionClient } from "../llm/base.js";

// ---------------------------------------------------------------------------
// Mock interface client
// ---------------------------------------------------------------------------

class MockInterfaceClient extends BaseInterfaceClient {
  async initialize(): Promise<void> {}

  async getState(
    _format?: "text" | "visual" | "hybrid"
  ): Promise<InterfaceState> {
    return {
      url: "https://example.com",
      title: "Test Page",
      content: "Test page content",
      interactiveElements: [
        '<button id="test-button">Click me</button>',
      ],
    };
  }

  async executeAction(action: Action): Promise<ActionResult> {
    return {
      success: true,
      description: `Executed ${action.actionType}`,
    };
  }

  async getScreenshot(): Promise<Buffer> {
    return Buffer.from("mock_screenshot");
  }

  async close(): Promise<void> {}
}

// ---------------------------------------------------------------------------
// Mock model client
// ---------------------------------------------------------------------------

function createMockModelClient(): BaseChatCompletionClient {
  return {
    model: "mock-model",
    create: vi.fn(),
    createStream: vi.fn(),
    totalUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    actualUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  } as unknown as BaseChatCompletionClient;
}

// ---------------------------------------------------------------------------
// Agent asTool schema validation
// ---------------------------------------------------------------------------

describe("Agent asTool schema validation", () => {
  it("should produce a tool with the agent name and description", () => {
    const agent = new Agent({
      name: "test_agent",
      description: "A test agent",
      instructions: "You are a test agent",
      modelClient: createMockModelClient(),
      tools: [],
    });

    const agentTool = new AgentAsTool(agent);

    expect(agentTool.name).toBe("test_agent");
    expect(agentTool.description).toBe("A test agent");
  });

  it("should have a schema with a required 'task' parameter", () => {
    const agent = new Agent({
      name: "test_agent",
      description: "A test agent",
      instructions: "You are a test agent",
      modelClient: createMockModelClient(),
      tools: [],
    });

    const agentTool = new AgentAsTool(agent);
    const schema = agentTool.parameters as Record<string, any>;

    expect(schema.properties).toHaveProperty("task");
    expect(schema.required).toEqual(["task"]);
  });
});

// ---------------------------------------------------------------------------
// ComputerUseAgent asTool and coordinator composition
// ---------------------------------------------------------------------------

describe("ComputerUseAgent asTool", () => {
  it("should convert to a tool with matching name and description containing web/browser/interface", () => {
    const computerAgent = new ComputerUseAgent({
      interfaceClient: new MockInterfaceClient(),
      modelClient: createMockModelClient(),
      maxActions: 1,
    });

    const computerTool = new AgentAsTool(computerAgent);

    expect(computerTool.name).toBe("computer-use-agent");
    expect(computerTool.description.toLowerCase()).toMatch(
      /web|browser|interface/
    );
  });

  it("should be usable as a tool inside a coordinator agent", () => {
    const computerAgent = new ComputerUseAgent({
      interfaceClient: new MockInterfaceClient(),
      modelClient: createMockModelClient(),
      maxActions: 1,
    });

    const computerTool = new AgentAsTool(computerAgent);

    const coordinator = new Agent({
      name: "coordinator",
      description: "Coordinates other agents",
      instructions: "You coordinate tasks",
      modelClient: createMockModelClient(),
      tools: [computerTool],
    });

    expect(coordinator.tools).toHaveLength(1);
    expect(coordinator.tools[0].name).toBe("computer-use-agent");
  });
});

// ---------------------------------------------------------------------------
// ComputerUseAgent default description
// ---------------------------------------------------------------------------

describe("ComputerUseAgent default description", () => {
  it("should have a meaningful default description about web interaction", () => {
    const agent = new ComputerUseAgent({
      interfaceClient: new MockInterfaceClient(),
      modelClient: createMockModelClient(),
    });

    expect(agent.description).toBe(
      "An agent that can interact with web pages using browser automation"
    );
  });
});
