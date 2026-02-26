/**
 * Tests for WebUI entity registry.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { EntityRegistry } from "../webui/registry.js";

// ---------------------------------------------------------------------------
// Mock entities
// ---------------------------------------------------------------------------

class MockAgent {
  name: string;
  description: string;
  instructions: string;
  modelClient = { model: "gpt-4" };
  tools: Array<{ name: string }>;
  memory = null;
  exampleTasks: string[];

  constructor(name: string, description = "A mock agent") {
    this.name = name;
    this.description = description;
    this.instructions = `You are ${name}`;
    this.tools = [{ name: "tool1" }, { name: "tool2" }];
    this.exampleTasks = ["Task 1", "Task 2"];
  }

  async *runStream() {
    yield { role: "assistant", content: "hello", source: this.name };
  }
}

class MockOrchestrator {
  name: string;
  description: string;
  agents: MockAgent[];
  termination: { constructor: { name: string } };

  constructor(name: string, agents: MockAgent[]) {
    this.name = name;
    this.description = `Orchestrator ${name}`;
    this.agents = agents;
    this.termination = { constructor: { name: "MaxMessageTermination" } };
  }

  async selectNextAgent() {
    return this.agents[0];
  }

  async *runStream() {
    yield { eventType: "orchestration_start" };
  }
}

class MockWorkflow {
  name: string;
  description: string;
  steps: Map<string, unknown>;
  edges: Array<{ from: string; to: string }>;
  metadata: { startStep: string };

  constructor(name: string) {
    this.name = name;
    this.description = `Workflow ${name}`;
    this.steps = new Map([
      ["step1", { id: "step1" }],
      ["step2", { id: "step2" }],
    ]);
    this.edges = [{ from: "step1", to: "step2" }];
    this.metadata = { startStep: "step1" };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EntityRegistry", () => {
  let registry: EntityRegistry;

  beforeEach(() => {
    registry = new EntityRegistry();
  });

  describe("Agent Registration", () => {
    it("should register an agent", () => {
      const agent = new MockAgent("test-agent");
      registry.registerEntity("test-agent", agent);

      const info = registry.getEntityInfo("test-agent");
      expect(info).not.toBeNull();
      expect(info!.type).toBe("agent");
      expect(info!.name).toBe("test-agent");
    });

    it("should extract agent tools", () => {
      const agent = new MockAgent("test-agent");
      registry.registerEntity("test-agent", agent);

      const info = registry.getEntityInfo("test-agent");
      expect(info!.tools).toEqual(["tool1", "tool2"]);
    });

    it("should extract agent model", () => {
      const agent = new MockAgent("test-agent");
      registry.registerEntity("test-agent", agent);

      const info = registry.getEntityInfo("test-agent") as {
        model?: string;
        type: string;
      };
      expect(info.model).toBe("gpt-4");
    });

    it("should extract example tasks", () => {
      const agent = new MockAgent("test-agent");
      registry.registerEntity("test-agent", agent);

      const info = registry.getEntityInfo("test-agent");
      expect(info!.exampleTasks).toEqual(["Task 1", "Task 2"]);
    });
  });

  describe("Orchestrator Registration", () => {
    it("should register an orchestrator", () => {
      const agent = new MockAgent("agent1");
      const orch = new MockOrchestrator("test-orch", [agent]);
      registry.registerEntity("test-orch", orch);

      const info = registry.getEntityInfo("test-orch");
      expect(info).not.toBeNull();
      expect(info!.type).toBe("orchestrator");
    });

    it("should extract orchestrator agents", () => {
      const agent1 = new MockAgent("agent1");
      const agent2 = new MockAgent("agent2");
      const orch = new MockOrchestrator("test-orch", [agent1, agent2]);
      registry.registerEntity("test-orch", orch);

      const info = registry.getEntityInfo("test-orch") as {
        agents?: string[];
        type: string;
      };
      expect(info.agents).toEqual(["agent1", "agent2"]);
    });

    it("should extract termination conditions", () => {
      const orch = new MockOrchestrator("test-orch", [new MockAgent("a")]);
      registry.registerEntity("test-orch", orch);

      const info = registry.getEntityInfo("test-orch") as {
        terminationConditions?: string[];
        type: string;
      };
      expect(info.terminationConditions).toContain("MaxMessageTermination");
    });
  });

  describe("Workflow Registration", () => {
    it("should register a workflow", () => {
      const wf = new MockWorkflow("test-wf");
      registry.registerEntity("test-wf", wf);

      const info = registry.getEntityInfo("test-wf");
      expect(info).not.toBeNull();
      expect(info!.type).toBe("workflow");
    });

    it("should extract workflow steps", () => {
      const wf = new MockWorkflow("test-wf");
      registry.registerEntity("test-wf", wf);

      const info = registry.getEntityInfo("test-wf") as {
        steps?: string[];
        type: string;
      };
      expect(info.steps).toEqual(["step1", "step2"]);
    });

    it("should extract start step", () => {
      const wf = new MockWorkflow("test-wf");
      registry.registerEntity("test-wf", wf);

      const info = registry.getEntityInfo("test-wf") as {
        startStep?: string;
        type: string;
      };
      expect(info.startStep).toBe("step1");
    });
  });

  describe("Entity Management", () => {
    it("should list all entities", () => {
      registry.registerEntity("a1", new MockAgent("agent1"));
      registry.registerEntity("a2", new MockAgent("agent2"));

      const entities = registry.listEntities();
      expect(entities.length).toBe(2);
    });

    it("should get entity object", () => {
      const agent = new MockAgent("test-agent");
      registry.registerEntity("test-agent", agent);

      const obj = registry.getEntityObject("test-agent");
      expect(obj).toBe(agent);
    });

    it("should return null for non-existent entity info", () => {
      const info = registry.getEntityInfo("nonexistent");
      expect(info).toBeNull();
    });

    it("should return null for non-existent entity object", () => {
      const obj = registry.getEntityObject("nonexistent");
      expect(obj).toBeNull();
    });

    it("should unregister an entity", () => {
      registry.registerEntity("a1", new MockAgent("agent1"));
      expect(registry.listEntities().length).toBe(1);

      const removed = registry.unregisterEntity("a1");
      expect(removed).toBe(true);
      expect(registry.listEntities().length).toBe(0);
      expect(registry.getEntityObject("a1")).toBeNull();
    });

    it("should return false for unregistering non-existent entity", () => {
      const removed = registry.unregisterEntity("nonexistent");
      expect(removed).toBe(false);
    });

    it("should clear all entities", () => {
      registry.registerEntity("a1", new MockAgent("agent1"));
      registry.registerEntity("a2", new MockAgent("agent2"));

      registry.clear();
      expect(registry.listEntities().length).toBe(0);
    });

    it("should handle entity with no description", () => {
      const obj = { name: "bare", instructions: "test", modelClient: { model: "x" } };
      registry.registerEntity("bare", obj);

      const info = registry.getEntityInfo("bare");
      expect(info).not.toBeNull();
      expect(info!.name).toBe("bare");
    });

    it("should set source to memory for registered entities", () => {
      registry.registerEntity("a1", new MockAgent("agent1"));
      const info = registry.getEntityInfo("a1");
      expect(info!.source).toBe("memory");
    });

    it("should handle duck-typed agent (runStream + name)", () => {
      const duckAgent = {
        name: "duck",
        async *runStream() {
          yield { role: "assistant", content: "quack" };
        },
      };
      registry.registerEntity("duck", duckAgent);

      const info = registry.getEntityInfo("duck");
      expect(info).not.toBeNull();
      expect(info!.type).toBe("agent");
    });

    it("should return null for unrecognized objects", () => {
      registry.registerEntity("unknown", { foo: "bar" });
      const info = registry.getEntityInfo("unknown");
      expect(info).toBeNull();
    });

    it("should overwrite entity on re-registration", () => {
      registry.registerEntity("a1", new MockAgent("agent1"));
      registry.registerEntity("a1", new MockAgent("agent1-v2"));

      const info = registry.getEntityInfo("a1");
      expect(info!.name).toBe("agent1-v2");
    });
  });
});
