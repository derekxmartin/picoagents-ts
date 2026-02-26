import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ActionType,
  BaseInterfaceClient,
  type Action,
  type ActionResult,
  type InterfaceState,
} from "../interface-clients.js";
import {
  InterfaceRepresentation,
  PlanningStrategy,
  createDOMFilter,
  createInterfaceConfig,
} from "../planning-models.js";
import { createPlaywrightTools } from "../playwright-tools.js";
import { ComputerUseAgent } from "../computer-use-agent.js";
import type { BaseChatCompletionClient } from "../../../llm/base.js";
import type { ChatCompletionResult } from "../../../types.js";
import type { Message } from "../../../messages.js";

// ---------------------------------------------------------------------------
// Mock interface client
// ---------------------------------------------------------------------------

class MockInterfaceClient extends BaseInterfaceClient {
  initialized = false;
  closed = false;
  actions: Action[] = [];

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async getState(
    _format?: "text" | "visual" | "hybrid"
  ): Promise<InterfaceState> {
    return {
      url: "https://example.com",
      title: "Example",
      content: "Hello World\nSome content here",
      interactiveElements: [
        '<button id="btn1">Click me</button>',
        '<input type="text" id="search">',
      ],
    };
  }

  async executeAction(action: Action): Promise<ActionResult> {
    this.actions.push(action);
    return {
      success: true,
      description: `Executed ${action.actionType}`,
    };
  }

  async getScreenshot(): Promise<Buffer> {
    return Buffer.from("fake-screenshot-data");
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

// ---------------------------------------------------------------------------
// ActionType
// ---------------------------------------------------------------------------

describe("ActionType", () => {
  it("should have expected action types", () => {
    expect(ActionType.CLICK).toBe("click");
    expect(ActionType.TYPE).toBe("type");
    expect(ActionType.NAVIGATE).toBe("navigate");
    expect(ActionType.SCROLL).toBe("scroll");
    expect(ActionType.PRESS).toBe("press");
    expect(ActionType.HOVER).toBe("hover");
    expect(ActionType.SELECT).toBe("select");
    expect(ActionType.SCREENSHOT).toBe("screenshot");
  });
});

// ---------------------------------------------------------------------------
// BaseInterfaceClient (via mock)
// ---------------------------------------------------------------------------

describe("MockInterfaceClient", () => {
  let client: MockInterfaceClient;

  beforeEach(() => {
    client = new MockInterfaceClient();
  });

  it("should initialize", async () => {
    await client.initialize();
    expect(client.initialized).toBe(true);
  });

  it("should return page state", async () => {
    const state = await client.getState("text");
    expect(state.url).toBe("https://example.com");
    expect(state.title).toBe("Example");
    expect(state.interactiveElements.length).toBe(2);
  });

  it("should execute actions", async () => {
    const result = await client.executeAction({
      actionType: ActionType.CLICK,
      selector: "#btn1",
    });
    expect(result.success).toBe(true);
    expect(client.actions).toHaveLength(1);
  });

  it("should get screenshot", async () => {
    const screenshot = await client.getScreenshot();
    expect(Buffer.isBuffer(screenshot)).toBe(true);
  });

  it("should close", async () => {
    await client.close();
    expect(client.closed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Planning models
// ---------------------------------------------------------------------------

describe("Planning models", () => {
  it("InterfaceRepresentation has expected values", () => {
    expect(InterfaceRepresentation.TEXT).toBe("text");
    expect(InterfaceRepresentation.VISUAL).toBe("visual");
    expect(InterfaceRepresentation.HYBRID).toBe("hybrid");
  });

  it("PlanningStrategy has expected values", () => {
    expect(PlanningStrategy.IMPLICIT).toBe("implicit");
    expect(PlanningStrategy.EXPLICIT).toBe("explicit");
    expect(PlanningStrategy.AUTO).toBe("auto");
  });

  it("createDOMFilter returns defaults", () => {
    const filter = createDOMFilter();
    expect(filter.maxTextLength).toBe(2000);
    expect(filter.includeHidden).toBe(false);
    expect(filter.interactiveOnly).toBe(false);
    expect(filter.excludeTags).toContain("script");
  });

  it("createDOMFilter accepts overrides", () => {
    const filter = createDOMFilter({ maxTextLength: 500, includeHidden: true });
    expect(filter.maxTextLength).toBe(500);
    expect(filter.includeHidden).toBe(true);
  });

  it("createInterfaceConfig returns defaults", () => {
    const config = createInterfaceConfig();
    expect(config.representation).toBe("hybrid");
    expect(config.includeScreenshot).toBe(true);
  });

  it("createInterfaceConfig accepts overrides", () => {
    const config = createInterfaceConfig({
      representation: InterfaceRepresentation.TEXT,
      includeScreenshot: false,
    });
    expect(config.representation).toBe("text");
    expect(config.includeScreenshot).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Playwright tools (with mock client)
// ---------------------------------------------------------------------------

describe("Playwright tools", () => {
  let client: MockInterfaceClient;

  beforeEach(() => {
    client = new MockInterfaceClient();
  });

  it("createPlaywrightTools returns 8 tools", () => {
    const tools = createPlaywrightTools(client);
    expect(tools).toHaveLength(8);
    const names = tools.map((t) => t.name);
    expect(names).toContain("navigate");
    expect(names).toContain("click");
    expect(names).toContain("type_text");
    expect(names).toContain("select_option");
    expect(names).toContain("press_key");
    expect(names).toContain("hover");
    expect(names).toContain("scroll");
    expect(names).toContain("observe_page");
  });

  it("navigate tool calls client.executeAction", async () => {
    const tools = createPlaywrightTools(client);
    const navTool = tools.find((t) => t.name === "navigate")!;
    const result = await navTool.execute({ url: "https://test.com" });
    expect(client.actions).toHaveLength(1);
    expect(client.actions[0].actionType).toBe(ActionType.NAVIGATE);
    expect((result as any).result).toContain("Executed");
  });

  it("click tool calls client.executeAction", async () => {
    const tools = createPlaywrightTools(client);
    const clickTool = tools.find((t) => t.name === "click")!;
    const result = await clickTool.execute({ selector: "#btn1" });
    expect(client.actions).toHaveLength(1);
    expect(client.actions[0].actionType).toBe(ActionType.CLICK);
    expect((result as any).result).toContain("Executed");
  });

  it("type_text tool calls client.executeAction", async () => {
    const tools = createPlaywrightTools(client);
    const typeTool = tools.find((t) => t.name === "type_text")!;
    const result = await typeTool.execute({
      selector: "#search",
      text: "hello",
    });
    expect(client.actions).toHaveLength(1);
    expect(client.actions[0].actionType).toBe(ActionType.TYPE);
    expect(client.actions[0].value).toBe("hello");
  });

  it("observe_page tool returns page state", async () => {
    const tools = createPlaywrightTools(client);
    const observeTool = tools.find((t) => t.name === "observe_page")!;
    const result = await observeTool.execute({});
    expect((result as any).result).toContain("https://example.com");
    expect((result as any).result).toContain("Example");
  });

  it("scroll tool calls client.executeAction", async () => {
    const tools = createPlaywrightTools(client);
    const scrollTool = tools.find((t) => t.name === "scroll")!;
    const result = await scrollTool.execute({ direction: "down" });
    expect(client.actions).toHaveLength(1);
    expect(client.actions[0].actionType).toBe(ActionType.SCROLL);
    expect(client.actions[0].value).toBe("down");
  });
});

// ---------------------------------------------------------------------------
// ComputerUseAgent (basic construction)
// ---------------------------------------------------------------------------

describe("ComputerUseAgent", () => {
  it("should construct with mock client", () => {
    const client = new MockInterfaceClient();
    const mockLlm = {
      create: vi.fn(),
      createStream: vi.fn(),
      totalUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      actualUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as unknown as BaseChatCompletionClient;

    const agent = new ComputerUseAgent({
      interfaceClient: client,
      modelClient: mockLlm,
    });

    expect(agent.name).toBe("computer-use-agent");
    expect(agent.interfaceClient).toBe(client);
    expect(agent.useScreenshots).toBe(true);
    expect(agent.maxActions).toBe(50);
  });

  it("should accept custom options", () => {
    const client = new MockInterfaceClient();
    const mockLlm = {
      create: vi.fn(),
      createStream: vi.fn(),
      totalUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      actualUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as unknown as BaseChatCompletionClient;

    const agent = new ComputerUseAgent({
      interfaceClient: client,
      modelClient: mockLlm,
      name: "my-browser-agent",
      useScreenshots: false,
      maxActions: 10,
      maxIterations: 5,
    });

    expect(agent.name).toBe("my-browser-agent");
    expect(agent.useScreenshots).toBe(false);
    expect(agent.maxActions).toBe(10);
  });

  it("should close interface client on close()", async () => {
    const client = new MockInterfaceClient();
    const mockLlm = {
      create: vi.fn(),
      createStream: vi.fn(),
      totalUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      actualUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as unknown as BaseChatCompletionClient;

    const agent = new ComputerUseAgent({
      interfaceClient: client,
      modelClient: mockLlm,
    });

    // Simulate initialization
    await client.initialize();
    (agent as any).isInitialized = true;

    await agent.close();
    expect(client.closed).toBe(true);
  });
});
