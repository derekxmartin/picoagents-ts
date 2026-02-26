import { describe, it, expect } from "vitest";
import {
  ComponentModelSchema,
  ComponentBase,
  registerComponent,
  loadComponent,
  WELL_KNOWN_PROVIDERS,
  type ComponentModel,
} from "../component-config.js";

// Test component implementation
class TestComponent extends ComponentBase {
  static componentType = "test" as const;
  static componentVersion = 1;
  static componentLabel = "TestComponent";

  constructor(public name: string, public value: number) {
    super();
  }

  toConfig(): Record<string, unknown> {
    return { name: this.name, value: this.value };
  }

  static fromConfig(config: Record<string, unknown>): TestComponent {
    return new TestComponent(
      config.name as string,
      config.value as number
    );
  }
}

describe("ComponentConfig", () => {
  describe("ComponentModelSchema", () => {
    it("should parse a valid component model", () => {
      const model = ComponentModelSchema.parse({
        provider: "picoagents/agents/Agent",
        componentType: "agent",
        version: 1,
        config: { name: "test", instructions: "do stuff" },
      });
      expect(model.provider).toBe("picoagents/agents/Agent");
      expect(model.componentType).toBe("agent");
    });

    it("should require provider and config", () => {
      expect(() =>
        ComponentModelSchema.parse({ provider: "test" })
      ).toThrow();
    });
  });

  describe("ComponentBase", () => {
    it("should dump a component to ComponentModel", () => {
      const component = new TestComponent("myComp", 42);
      const model = component.dumpComponent();

      expect(model.provider).toBe("TestComponent");
      expect(model.componentType).toBe("test");
      expect(model.config).toEqual({ name: "myComp", value: 42 });
      expect(model.label).toBe("TestComponent");
    });
  });

  describe("Component loading", () => {
    it("should load a registered component", () => {
      registerComponent("TestComponent", TestComponent as unknown as new (...args: unknown[]) => ComponentBase);

      const model: ComponentModel = {
        provider: "TestComponent",
        config: { name: "loaded", value: 99 },
      };

      const loaded = loadComponent(model) as TestComponent;
      expect(loaded.name).toBe("loaded");
      expect(loaded.value).toBe(99);
    });

    it("should throw for unknown provider", () => {
      expect(() =>
        loadComponent({ provider: "unknown/Thing", config: {} })
      ).toThrow("not found in registry");
    });
  });

  describe("WELL_KNOWN_PROVIDERS", () => {
    it("should contain OpenAI client mapping", () => {
      expect(WELL_KNOWN_PROVIDERS["OpenAIChatCompletionClient"]).toBe(
        "picoagents/llm/OpenAIChatCompletionClient"
      );
    });

    it("should contain Agent mapping", () => {
      expect(WELL_KNOWN_PROVIDERS["Agent"]).toBe(
        "picoagents/agents/Agent"
      );
    });
  });
});
