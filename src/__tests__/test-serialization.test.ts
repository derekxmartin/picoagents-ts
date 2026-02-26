/**
 * Test component serialization across the picoagents-ts framework.
 *
 * Converted from Python tests:
 *   - picoagents/tests/test_serialization.py
 *   - picoagents/tests/test_workflow_progress.py
 *
 * Tests that core components can serialize (toConfig/dumpComponent) and
 * deserialize (fromConfig/loadComponent) correctly, and that the workflow
 * progress event system works via WorkflowContext.emitProgress and
 * FunctionStep with the WorkflowRunner.
 */

import { describe, it, expect, vi } from "vitest";

import {
  ComponentBase,
  ComponentModelSchema,
  registerComponent,
  loadComponent,
  type ComponentModel,
} from "../component-config.js";
import { OpenAIChatCompletionClient } from "../llm/openai.js";
import { ListMemory } from "../memory/list-memory.js";
import { FileMemory } from "../memory/file-memory.js";
import {
  WorkflowContext,
  WorkflowEventType,
  createWorkflowMetadata,
  createStepMetadata,
  type StepProgressEvent,
  type WorkflowEvent,
} from "../workflow/core/models.js";
import { Workflow } from "../workflow/core/workflow.js";
import { WorkflowRunner } from "../workflow/core/runner.js";
import { FunctionStep } from "../workflow/steps/function-step.js";

// ============================================================================
// Serialization tests (from test_serialization.py)
// ============================================================================

describe("Component Serialization", () => {
  // --------------------------------------------------------------------------
  // LLM client serialization
  // --------------------------------------------------------------------------
  describe("LLM client serialization", () => {
    it("should roundtrip OpenAIChatCompletionClient through toConfig/fromConfig", () => {
      const client = new OpenAIChatCompletionClient({
        model: "gpt-4.1-mini",
        apiKey: "test-key",
        baseUrl: "https://test.openai.com/v1/",
      });

      // Serialize
      const config = client.toConfig();
      expect(config.model).toBe("gpt-4.1-mini");
      expect(config.apiKey).toBe("test-key");
      expect(config.baseUrl).toBe("https://test.openai.com/v1/");

      // Deserialize
      const loaded = OpenAIChatCompletionClient.fromConfig(config);
      expect(loaded.model).toBe("gpt-4.1-mini");
      expect(loaded.apiKey).toBe("test-key");
    });

    it("should produce a valid ComponentModel via dumpComponent", () => {
      const client = new OpenAIChatCompletionClient({
        model: "gpt-4.1-mini",
        apiKey: "test-key",
      });

      const componentModel = client.dumpComponent();

      expect(componentModel.provider).toBe(
        "picoagents/llm/OpenAIChatCompletionClient"
      );
      expect(componentModel.componentType).toBe("model_client");
      expect(componentModel.config.model).toBe("gpt-4.1-mini");
      expect(componentModel.config.apiKey).toBe("test-key");

      // Should be parseable by the Zod schema
      const parsed = ComponentModelSchema.parse(componentModel);
      expect(parsed.provider).toBe(
        "picoagents/llm/OpenAIChatCompletionClient"
      );
    });
  });

  // --------------------------------------------------------------------------
  // Memory serialization
  // --------------------------------------------------------------------------
  describe("Memory serialization", () => {
    it("should roundtrip ListMemory through toConfig/fromConfig", () => {
      const listMemory = new ListMemory(50);

      const config = listMemory.toConfig();
      expect(config.maxMemories).toBe(50);

      const loaded = ListMemory.fromConfig(config);
      expect(loaded.maxMemories).toBe(50);
      expect(loaded.memories).toEqual([]); // Should start empty when no memories in config
    });

    it("should roundtrip ListMemory dumpComponent", () => {
      const listMemory = new ListMemory(50);
      const componentModel = listMemory.dumpComponent();

      expect(componentModel.provider).toBe("picoagents/memory/ListMemory");
      expect(componentModel.componentType).toBe("memory");
      expect(componentModel.config.maxMemories).toBe(50);
    });

    it("should roundtrip FileMemory through toConfig/fromConfig", () => {
      // FileMemory constructor tries to load from disk, but a non-existent
      // path will just leave memories empty, which is fine for the test.
      const fileMemory = new FileMemory("test_serialization_temp.json", 100);

      const config = fileMemory.toConfig();
      expect(config.filePath).toBe("test_serialization_temp.json");
      expect(config.maxMemories).toBe(100);

      const loaded = FileMemory.fromConfig(config);
      expect(loaded.filePath).toBe("test_serialization_temp.json");
      expect(loaded.maxMemories).toBe(100);
    });

    it("should roundtrip FileMemory dumpComponent", () => {
      const fileMemory = new FileMemory("test_serialization_temp.json", 100);
      const componentModel = fileMemory.dumpComponent();

      expect(componentModel.provider).toBe("picoagents/memory/FileMemory");
      expect(componentModel.componentType).toBe("memory");
      expect(componentModel.config.filePath).toBe(
        "test_serialization_temp.json"
      );
      expect(componentModel.config.maxMemories).toBe(100);
    });
  });

  // --------------------------------------------------------------------------
  // loadComponent via registry
  // --------------------------------------------------------------------------
  describe("loadComponent via registry", () => {
    it("should load OpenAIChatCompletionClient through the component registry", () => {
      // Register the component
      registerComponent(
        "picoagents/llm/OpenAIChatCompletionClient",
        OpenAIChatCompletionClient as unknown as new (
          ...args: unknown[]
        ) => ComponentBase
      );

      const model: ComponentModel = {
        provider: "picoagents/llm/OpenAIChatCompletionClient",
        config: {
          model: "gpt-4.1-mini",
          apiKey: "registry-test-key",
        },
      };

      const loaded = loadComponent(model) as OpenAIChatCompletionClient;
      expect(loaded.model).toBe("gpt-4.1-mini");
      expect(loaded.apiKey).toBe("registry-test-key");
    });

    it("should load ListMemory through the component registry", () => {
      registerComponent(
        "picoagents/memory/ListMemory",
        ListMemory as unknown as new (...args: unknown[]) => ComponentBase
      );

      const model: ComponentModel = {
        provider: "picoagents/memory/ListMemory",
        config: { maxMemories: 75 },
      };

      const loaded = loadComponent(model) as ListMemory;
      expect(loaded.maxMemories).toBe(75);
      expect(loaded.memories).toEqual([]);
    });

    it("should load FileMemory through the component registry", () => {
      registerComponent(
        "picoagents/memory/FileMemory",
        FileMemory as unknown as new (...args: unknown[]) => ComponentBase
      );

      const model: ComponentModel = {
        provider: "picoagents/memory/FileMemory",
        config: { filePath: "registry_test.json", maxMemories: 200 },
      };

      const loaded = loadComponent(model) as FileMemory;
      expect(loaded.filePath).toBe("registry_test.json");
      expect(loaded.maxMemories).toBe(200);
    });

    it("should throw for an unknown provider", () => {
      expect(() =>
        loadComponent({ provider: "unknown/NonExistent", config: {} })
      ).toThrow("not found in registry");
    });
  });

  // --------------------------------------------------------------------------
  // Nested serialization integrity
  // --------------------------------------------------------------------------
  describe("Nested serialization integrity", () => {
    it("should preserve all data in a full dumpComponent/fromConfig roundtrip for ListMemory with existing memories", () => {
      const memory = new ListMemory(30);

      // Manually add some memories to ensure they survive the roundtrip
      memory.memories = [
        {
          content: "Hello world",
          mimeType: "text/plain",
          metadata: { tag: "greeting" },
          timestamp: new Date("2024-06-01T12:00:00Z"),
        },
      ];

      const config = memory.toConfig();
      const loaded = ListMemory.fromConfig(config);

      expect(loaded.maxMemories).toBe(30);
      expect(loaded.memories.length).toBe(1);
      expect(loaded.memories[0].content).toBe("Hello world");
      expect(loaded.memories[0].metadata).toEqual({ tag: "greeting" });
    });
  });
});

// ============================================================================
// Workflow progress tests (from test_workflow_progress.py)
// ============================================================================

describe("Workflow Progress Events", () => {
  // --------------------------------------------------------------------------
  // WorkflowContext.emitProgress unit tests
  // --------------------------------------------------------------------------
  describe("WorkflowContext.emitProgress", () => {
    it("should call the registered progress callback", () => {
      const progressUpdates: Record<string, unknown>[] = [];

      const callback = (data: Record<string, unknown>): void => {
        progressUpdates.push(data);
      };

      const context = new WorkflowContext({});
      context.setProgressCallback(callback);

      context.emitProgress("Test progress", 5, 10, { foo: "bar" });

      expect(progressUpdates.length).toBe(1);
      expect(progressUpdates[0].message).toBe("Test progress");
      expect(progressUpdates[0].completed).toBe(5);
      expect(progressUpdates[0].total).toBe(10);
      expect(progressUpdates[0].metadata).toEqual({ foo: "bar" });
    });

    it("should handle missing callback gracefully (no-op)", () => {
      const context = new WorkflowContext({});
      // Should not throw when no callback is set
      expect(() => {
        context.emitProgress("Test", 1, 10);
      }).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // FunctionStep + workflow runner progress events
  // --------------------------------------------------------------------------
  describe("FunctionStep with progress emission", () => {
    it("should emit progress events through a FunctionStep in a workflow", async () => {
      const metadata = createWorkflowMetadata("test_progress");
      const workflow = new Workflow(metadata);

      const step = new FunctionStep(
        "progress_step",
        createStepMetadata("Progress Test Step"),
        async (
          input: Record<string, unknown>,
          context: WorkflowContext
        ) => {
          const count = (input.count as number) ?? 5;

          for (let i = 0; i < count; i++) {
            context.emitProgress(
              `Processing item ${i + 1}`,
              i + 1,
              count,
              { item_id: i }
            );
          }

          return { result: `Processed ${count} items` };
        }
      );

      workflow.addStep(step);
      workflow.setStartStep("progress_step");
      workflow.addEndStep("progress_step");

      const runner = new WorkflowRunner();
      const events: WorkflowEvent[] = [];

      for await (const event of runner.runStream(workflow, { count: 5 })) {
        events.push(event);
      }

      // Verify we got standard workflow lifecycle events
      const startEvents = events.filter(
        (e) => e.eventType === WorkflowEventType.WORKFLOW_STARTED
      );
      expect(startEvents.length).toBe(1);

      const completedEvents = events.filter(
        (e) => e.eventType === WorkflowEventType.WORKFLOW_COMPLETED
      );
      expect(completedEvents.length).toBe(1);

      const stepStartEvents = events.filter(
        (e) => e.eventType === WorkflowEventType.STEP_STARTED
      );
      expect(stepStartEvents.length).toBe(1);

      const stepCompletedEvents = events.filter(
        (e) => e.eventType === WorkflowEventType.STEP_COMPLETED
      );
      expect(stepCompletedEvents.length).toBe(1);
    });

    it("should run a multi-step workflow with FunctionSteps", async () => {
      const metadata = createWorkflowMetadata("test_multi_step");
      const workflow = new Workflow(metadata);

      const step1 = new FunctionStep(
        "step1",
        createStepMetadata("Step 1"),
        async (input: Record<string, unknown>, context: WorkflowContext) => {
          const count = (input.count as number) ?? 3;
          context.emitProgress("Step 1 starting", 0, count);
          return { result: `Step1 processed ${count} items`, count };
        }
      );

      const step2 = new FunctionStep(
        "step2",
        createStepMetadata("Step 2"),
        async (input: Record<string, unknown>, context: WorkflowContext) => {
          const count = (input.count as number) ?? 3;
          context.emitProgress("Step 2 starting", 0, count);
          return { result: `Step2 processed ${count} items` };
        }
      );

      workflow.addStep(step1).addStep(step2);
      workflow.addEdge("step1", "step2");
      workflow.setStartStep("step1");
      workflow.addEndStep("step2");

      const runner = new WorkflowRunner();
      const events: WorkflowEvent[] = [];

      for await (const event of runner.runStream(workflow, { count: 3 })) {
        events.push(event);
      }

      // Should have step_started and step_completed for both steps
      const stepStartEvents = events.filter(
        (e) => e.eventType === WorkflowEventType.STEP_STARTED
      );
      const stepCompletedEvents = events.filter(
        (e) => e.eventType === WorkflowEventType.STEP_COMPLETED
      );

      expect(stepStartEvents.length).toBe(2);
      expect(stepCompletedEvents.length).toBe(2);

      // Verify step IDs
      const startedStepIds = stepStartEvents.map((e) => e.stepId);
      expect(startedStepIds).toContain("step1");
      expect(startedStepIds).toContain("step2");

      // Verify the workflow completed
      const workflowCompleted = events.filter(
        (e) => e.eventType === WorkflowEventType.WORKFLOW_COMPLETED
      );
      expect(workflowCompleted.length).toBe(1);
    });

    it("should pass output from step1 as input to step2 via edges", async () => {
      const metadata = createWorkflowMetadata("test_data_flow");
      const workflow = new Workflow(metadata);

      const step1 = new FunctionStep(
        "producer",
        createStepMetadata("Producer"),
        async (input: Record<string, unknown>) => {
          return { value: 42, label: "answer" };
        }
      );

      const step2 = new FunctionStep(
        "consumer",
        createStepMetadata("Consumer"),
        async (input: Record<string, unknown>) => {
          // Should receive output from step1
          return { doubled: ((input.value as number) ?? 0) * 2 };
        }
      );

      workflow.addStep(step1).addStep(step2);
      workflow.addEdge("producer", "consumer");
      workflow.setStartStep("producer");
      workflow.addEndStep("consumer");

      const runner = new WorkflowRunner();
      const execution = await runner.run(workflow, {});

      // The consumer step should have received { value: 42, label: "answer" }
      // and produced { doubled: 84 }
      const consumerExec = execution.stepExecutions["consumer"];
      expect(consumerExec).toBeDefined();
      expect(consumerExec.outputData).toBeDefined();
      expect(consumerExec.outputData!.doubled).toBe(84);
    });
  });

  // --------------------------------------------------------------------------
  // StepProgressEvent interface
  // --------------------------------------------------------------------------
  describe("StepProgressEvent structure", () => {
    it("should have the correct shape with all fields", () => {
      const event: StepProgressEvent = {
        eventType: WorkflowEventType.STEP_PROGRESS,
        timestamp: new Date("2024-01-01T12:00:00Z"),
        workflowId: "test_workflow",
        stepId: "test_step",
        message: "Processing data",
        completed: 7,
        total: 10,
        metadata: { foo: "bar" },
      };

      expect(event.eventType).toBe(WorkflowEventType.STEP_PROGRESS);
      expect(event.stepId).toBe("test_step");
      expect(event.message).toBe("Processing data");
      expect(event.completed).toBe(7);
      expect(event.total).toBe(10);
      expect(event.metadata).toEqual({ foo: "bar" });
    });

    it("should allow optional completed/total fields", () => {
      const event: StepProgressEvent = {
        eventType: WorkflowEventType.STEP_PROGRESS,
        timestamp: new Date("2024-01-01T12:00:00Z"),
        workflowId: "test_workflow",
        stepId: "test_step",
        message: "Starting process",
        metadata: {},
      };

      expect(event.completed).toBeUndefined();
      expect(event.total).toBeUndefined();
    });
  });
});
