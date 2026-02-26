/**
 * Workflow validation, execution, edge conditions, transform steps,
 * and checkpoint tests -- converted from the Python test suite.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  Workflow,
  WorkflowRunner,
  WorkflowEventType,
  WorkflowStatus,
  StepStatus,
  createStepMetadata,
  createWorkflowMetadata,
  createEdgeCondition,
  createStepExecution,
  createWorkflowExecution,
  InMemoryCheckpointStore,
  createCheckpointConfig,
  createCheckpointFromExecution,
} from "../workflow/core/index.js";
import type {
  WorkflowEvent,
  WorkflowExecution,
  WorkflowValidationResult,
} from "../workflow/core/index.js";
import { EchoStep } from "../workflow/steps/echo-step.js";
import { FunctionStep } from "../workflow/steps/function-step.js";
import { TransformStep } from "../workflow/steps/transform-step.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEchoStep(
  stepId: string,
  name: string,
  options?: { prefix?: string; suffix?: string; inputTypeName?: string; outputTypeName?: string }
): EchoStep {
  return new EchoStep(stepId, createStepMetadata(name), {
    prefix: options?.prefix ?? "",
    suffix: options?.suffix ?? "",
    inputTypeName: options?.inputTypeName,
    outputTypeName: options?.outputTypeName,
  });
}

/** Build a simple two-step workflow used by several tests. */
function makeSampleWorkflow(): Workflow {
  const workflow = new Workflow(createWorkflowMetadata("Test Workflow"));

  const step1 = makeEchoStep("step1", "First Step", {
    prefix: "[1] ",
    inputTypeName: "TextInput",
    outputTypeName: "TextOutput",
  });
  const step2 = makeEchoStep("step2", "Second Step", {
    prefix: "[2] ",
    suffix: " (done)",
    inputTypeName: "TextOutput",
    outputTypeName: "TextOutput",
  });

  workflow.addStep(step1).addStep(step2);
  workflow.addEdge("step1", "step2");
  workflow.setStartStep("step1").addEndStep("step2");
  return workflow;
}

// ---------------------------------------------------------------------------
// 1. Workflow validation
// ---------------------------------------------------------------------------

describe("Workflow validation", () => {
  it("should pass validation for a valid workflow", () => {
    const wf = makeSampleWorkflow();
    const v = wf.validateWorkflow();
    expect(v.isValid).toBe(true);
    expect(v.errors).toHaveLength(0);
  });

  it("should detect cycle in workflow graph", () => {
    const wf = new Workflow(createWorkflowMetadata("Cycle Test"));

    const a = makeEchoStep("a", "A");
    const b = makeEchoStep("b", "B");
    const c = makeEchoStep("c", "C");

    wf.addStep(a).addStep(b).addStep(c);
    wf.addEdge("a", "b");
    wf.addEdge("b", "c");
    wf.addEdge("c", "a"); // creates cycle
    wf.setStartStep("a").addEndStep("c");

    const v = wf.validateWorkflow();
    expect(v.hasCycles).toBe(true);
    expect(v.isValid).toBe(false);
    expect(v.errors.some((e) => /cycle/i.test(e))).toBe(true);
  });

  it("should detect unreachable steps", () => {
    const wf = new Workflow(createWorkflowMetadata("Unreachable Test"));

    const a = makeEchoStep("a", "A");
    const b = makeEchoStep("b", "B");
    const orphan = makeEchoStep("orphan", "Orphan");

    wf.addStep(a).addStep(b).addStep(orphan);
    wf.addEdge("a", "b");
    wf.setStartStep("a").addEndStep("b");
    // orphan has no incoming/outgoing edges from start

    const v = wf.validateWorkflow();
    expect(v.unreachableSteps).toContain("orphan");
  });

  it("should warn about steps with no outgoing edges that are not end steps", () => {
    const wf = new Workflow(createWorkflowMetadata("Dead End Test"));

    const a = makeEchoStep("step_a", "Step A");
    const b = makeEchoStep("step_b", "Step B");

    wf.addStep(a).addStep(b);
    wf.addEdge("step_a", "step_b");
    wf.setStartStep("step_a");
    // step_b is NOT marked as end step

    const v = wf.validateWorkflow();
    expect(
      v.warnings.some((w) => w.includes("has no outgoing edges but is not marked as an end step"))
    ).toBe(true);
  });

  it("should report error when no steps exist", () => {
    const wf = new Workflow(createWorkflowMetadata("Empty"));
    const v = wf.validateWorkflow();
    expect(v.isValid).toBe(false);
    expect(v.errors.some((e) => /no steps/i.test(e))).toBe(true);
  });

  it("should report error when no start step is set", () => {
    const wf = new Workflow(createWorkflowMetadata("No Start"));
    wf.addStep(makeEchoStep("s", "S"));
    const v = wf.validateWorkflow();
    expect(v.isValid).toBe(false);
    expect(v.errors.some((e) => /start step/i.test(e))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Basic workflow creation and edge addition
// ---------------------------------------------------------------------------

describe("Workflow basics", () => {
  it("should create an empty workflow", () => {
    const wf = new Workflow(createWorkflowMetadata("Test"));
    expect(wf.metadata.name).toBe("Test");
    expect(wf.steps.size).toBe(0);
    expect(wf.edges).toHaveLength(0);
  });

  it("should add steps to workflow", () => {
    const wf = new Workflow(createWorkflowMetadata("Test"));
    const step = makeEchoStep("test_step", "Test Step");
    wf.addStep(step);
    expect(wf.steps.has("test_step")).toBe(true);
    expect(wf.steps.get("test_step")).toBe(step);
  });

  it("should add edges between steps", () => {
    const wf = new Workflow(createWorkflowMetadata("Test"));
    const step1 = makeEchoStep("step1", "Step 1");
    const step2 = makeEchoStep("step2", "Step 2");

    wf.addStep(step1).addStep(step2);
    wf.addEdge("step1", "step2");

    expect(wf.edges).toHaveLength(1);
    expect(wf.edges[0].fromStep).toBe("step1");
    expect(wf.edges[0].toStep).toBe("step2");
  });

  it("chain() should wire steps linearly", () => {
    const wf = new Workflow(createWorkflowMetadata("Chain Test"));
    const s1 = makeEchoStep("s1", "S1");
    const s2 = makeEchoStep("s2", "S2");
    const s3 = makeEchoStep("s3", "S3");
    wf.chain(s1, s2, s3);

    expect(wf.steps.size).toBe(3);
    expect(wf.edges).toHaveLength(2);
    expect(wf.startStepId).toBe("s1");
    expect(wf.endStepIds).toContain("s3");
  });
});

// ---------------------------------------------------------------------------
// 3. Edge conditions
// ---------------------------------------------------------------------------

describe("Edge conditions", () => {
  it("'always' condition should make step ready regardless of output", () => {
    const wf = new Workflow(createWorkflowMetadata("Always Test"));
    const a = makeEchoStep("step_a", "Step A");
    const b = makeEchoStep("step_b", "Step B");
    wf.addStep(a).addStep(b);
    wf.addEdge("step_a", "step_b", { type: "always" });
    wf.setStartStep("step_a").addEndStep("step_b");

    const execution = createWorkflowExecution(wf.id, {
      status: WorkflowStatus.RUNNING,
      stepExecutions: {
        step_a: createStepExecution("step_a", {
          status: StepStatus.COMPLETED,
          outputData: { result: "any output" },
        }),
      },
    });

    const ready = wf.getReadySteps(execution);
    expect(ready).toContain("step_b");
  });

  it("'state_based' condition should evaluate workflow state", () => {
    const wf = new Workflow(createWorkflowMetadata("State Test"));
    const a = makeEchoStep("step_a", "Step A");
    const b = makeEchoStep("step_b", "Step B");
    wf.addStep(a).addStep(b);
    wf.addEdge("step_a", "step_b", {
      type: "state_based",
      field: "user_approved",
      operator: "==",
      value: true,
    });
    wf.setStartStep("step_a").addEndStep("step_b");

    // Test 1: condition fails
    const exec1 = createWorkflowExecution(wf.id, {
      status: WorkflowStatus.RUNNING,
      state: { user_approved: false },
      stepExecutions: {
        step_a: createStepExecution("step_a", {
          status: StepStatus.COMPLETED,
          outputData: { result: "completed" },
        }),
      },
    });
    expect(wf.getReadySteps(exec1)).not.toContain("step_b");

    // Test 2: condition passes
    exec1.state["user_approved"] = true;
    expect(wf.getReadySteps(exec1)).toContain("step_b");
  });

  it("'output_based' condition with == operator", () => {
    const wf = new Workflow(createWorkflowMetadata("Op Test"));
    const a = makeEchoStep("step_a", "Step A");
    const b = makeEchoStep("step_b", "Step B");
    wf.addStep(a).addStep(b);
    wf.setStartStep("step_a").addEndStep("step_b");

    // == should pass when values match
    wf.edges = [];
    wf.addEdge("step_a", "step_b", {
      type: "output_based",
      field: "result",
      operator: "==",
      value: "success",
    });

    const execPass = createWorkflowExecution(wf.id, {
      status: WorkflowStatus.RUNNING,
      stepExecutions: {
        step_a: createStepExecution("step_a", {
          status: StepStatus.COMPLETED,
          outputData: { result: "success" },
        }),
      },
    });
    expect(wf.getReadySteps(execPass)).toContain("step_b");

    // == should fail when values differ
    const execFail = createWorkflowExecution(wf.id, {
      status: WorkflowStatus.RUNNING,
      stepExecutions: {
        step_a: createStepExecution("step_a", {
          status: StepStatus.COMPLETED,
          outputData: { result: "failure" },
        }),
      },
    });
    expect(wf.getReadySteps(execFail)).not.toContain("step_b");
  });

  it("'output_based' condition with != operator", () => {
    const wf = new Workflow(createWorkflowMetadata("Op Test"));
    const a = makeEchoStep("step_a", "Step A");
    const b = makeEchoStep("step_b", "Step B");
    wf.addStep(a).addStep(b);
    wf.setStartStep("step_a").addEndStep("step_b");
    wf.addEdge("step_a", "step_b", {
      type: "output_based",
      field: "result",
      operator: "!=",
      value: "failure",
    });

    const execPass = createWorkflowExecution(wf.id, {
      status: WorkflowStatus.RUNNING,
      stepExecutions: {
        step_a: createStepExecution("step_a", {
          status: StepStatus.COMPLETED,
          outputData: { result: "success" },
        }),
      },
    });
    expect(wf.getReadySteps(execPass)).toContain("step_b");

    const execFail = createWorkflowExecution(wf.id, {
      status: WorkflowStatus.RUNNING,
      stepExecutions: {
        step_a: createStepExecution("step_a", {
          status: StepStatus.COMPLETED,
          outputData: { result: "failure" },
        }),
      },
    });
    expect(wf.getReadySteps(execFail)).not.toContain("step_b");
  });
});

// ---------------------------------------------------------------------------
// 4. TransformStep tests
// ---------------------------------------------------------------------------

describe("TransformStep", () => {
  it("should apply valid field mappings", async () => {
    const step = new TransformStep(
      "transform",
      createStepMetadata("Transform"),
      { baz: "foo", qux: "bar" }
    );

    const runner = new WorkflowRunner();
    const output = await runner.runStep(step, { foo: "hello", bar: 42 });
    expect(output.baz).toBe("hello");
    expect(output.qux).toBe(42);
  });

  it("should support static: prefix for literal values", async () => {
    const step = new TransformStep(
      "transform_static",
      createStepMetadata("TransformStatic"),
      { baz: "foo", static_field: "static:hello" }
    );

    const runner = new WorkflowRunner();
    const output = await runner.runStep(step, { foo: "world" });
    expect(output.baz).toBe("world");
    expect(output.static_field).toBe("hello");
  });

  it("should work inside a workflow", async () => {
    const transform = new TransformStep(
      "t1",
      createStepMetadata("Rename"),
      { renamed: "original" }
    );

    const wf = new Workflow(createWorkflowMetadata("Transform WF"));
    wf.addStep(transform);
    wf.setStartStep("t1").addEndStep("t1");

    const runner = new WorkflowRunner();
    const exec = await runner.run(wf, { original: "value123" });
    expect(exec.status).toBe(WorkflowStatus.COMPLETED);
    expect(exec.stepExecutions["t1"].outputData?.renamed).toBe("value123");
  });
});

// ---------------------------------------------------------------------------
// 5. Checkpoint save/resume basics
// ---------------------------------------------------------------------------

describe("Checkpoint save and resume", () => {
  it("should save checkpoints during workflow execution", async () => {
    const double = new FunctionStep(
      "double",
      createStepMetadata("Double"),
      (input: Record<string, unknown>) => ({ result: (input.value as number) * 2 }),
      "NumberInput",
      "NumberOutput"
    );
    const addTen = new FunctionStep(
      "add_ten",
      createStepMetadata("Add Ten"),
      (input: Record<string, unknown>) => ({ result: (input.result as number) + 10 }),
      "NumberOutput",
      "NumberOutput"
    );
    const square = new FunctionStep(
      "square",
      createStepMetadata("Square"),
      (input: Record<string, unknown>) => ({ result: (input.result as number) ** 2 }),
      "NumberOutput",
      "NumberOutput"
    );

    const wf = new Workflow(createWorkflowMetadata("Math Pipeline"));
    wf.chain(double, addTen, square);

    const store = new InMemoryCheckpointStore();
    const config = createCheckpointConfig({ store, autoSave: true, saveIntervalSteps: 1 });

    const runner = new WorkflowRunner();
    const events: WorkflowEvent[] = [];
    for await (const event of runner.runStream(wf, { value: 3 }, undefined, undefined, config)) {
      events.push(event);
    }

    // Verify workflow completed
    const finalEvent = events[events.length - 1];
    expect(finalEvent.eventType).toBe(WorkflowEventType.WORKFLOW_COMPLETED);

    // Verify checkpoints were saved (at least 2 of 3 steps checkpoint)
    const metadata = await store.listMetadata(wf.id);
    expect(metadata.length).toBeGreaterThanOrEqual(2);

    // Verify final result: (3 * 2 + 10) ** 2 = 256
    const execution = finalEvent.execution as WorkflowExecution;
    expect((execution.state["square_output"] as Record<string, unknown>).result).toBe(256);

    // Load latest checkpoint
    const checkpoint = await store.loadLatest(wf.id);
    expect(checkpoint).toBeDefined();
    expect(checkpoint!.completedStepIds.length).toBeGreaterThanOrEqual(2);
    expect(checkpoint!.pendingStepIds.length).toBeLessThanOrEqual(1);
  });

  it("should resume from checkpoint after simulated failure", async () => {
    const double = new FunctionStep(
      "double",
      createStepMetadata("Double"),
      (input: Record<string, unknown>) => ({ result: (input.value as number) * 2 }),
      "NumberInput",
      "NumberOutput"
    );
    const addTen = new FunctionStep(
      "add_ten",
      createStepMetadata("Add Ten"),
      (input: Record<string, unknown>) => ({ result: (input.result as number) + 10 }),
      "NumberOutput",
      "NumberOutput"
    );

    const wf = new Workflow(createWorkflowMetadata("Resume Test"));
    wf.chain(double, addTen);

    const runner = new WorkflowRunner();
    const store = new InMemoryCheckpointStore();
    const config = createCheckpointConfig({ store, autoSave: true, saveIntervalSteps: 1 });

    // Run and break after first checkpoint
    for await (const event of runner.runStream(wf, { value: 5 }, undefined, undefined, config)) {
      if (event.eventType === WorkflowEventType.CHECKPOINT_SAVED) {
        break; // simulate failure
      }
    }

    // Load checkpoint after "failure"
    const checkpoint = await store.loadLatest(wf.id);
    expect(checkpoint).toBeDefined();
    expect(checkpoint!.completedStepIds).toHaveLength(1);
    expect(checkpoint!.completedStepIds).toContain("double");

    // Resume from checkpoint
    const resumeEvents: WorkflowEvent[] = [];
    for await (const event of runner.runStream(
      wf,
      { value: 5 },
      undefined,
      checkpoint!,
      config
    )) {
      resumeEvents.push(event);
    }

    // Verify resume event was emitted
    expect(resumeEvents.some((e) => e.eventType === WorkflowEventType.WORKFLOW_RESUMED)).toBe(
      true
    );

    // Verify only add_ten ran (double was already done)
    const stepCompletedEvents = resumeEvents.filter(
      (e) => e.eventType === WorkflowEventType.STEP_COMPLETED
    );
    expect(stepCompletedEvents).toHaveLength(1);
    expect(stepCompletedEvents[0].stepId).toBe("add_ten");

    // Verify final result: 5 * 2 + 10 = 20
    const finalEvent = resumeEvents[resumeEvents.length - 1];
    expect(finalEvent.eventType).toBe(WorkflowEventType.WORKFLOW_COMPLETED);
    const execution = finalEvent.execution as WorkflowExecution;
    expect((execution.state["add_ten_output"] as Record<string, unknown>).result).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// 6. InMemoryCheckpointStore operations
// ---------------------------------------------------------------------------

describe("InMemoryCheckpointStore", () => {
  let store: InMemoryCheckpointStore;

  beforeEach(() => {
    store = new InMemoryCheckpointStore();
  });

  it("should save and load checkpoints", async () => {
    const execution = createWorkflowExecution("wf-1", {
      status: WorkflowStatus.COMPLETED,
      stepExecutions: {
        step1: createStepExecution("step1", { status: StepStatus.COMPLETED }),
      },
    });

    const checkpoint = createCheckpointFromExecution(
      execution,
      "wf-1",
      "1.0.0",
      "abc123",
      ["step1"],
      "manual"
    );

    await store.save(checkpoint);
    const loaded = await store.load(checkpoint.checkpointId);
    expect(loaded).toBeDefined();
    expect(loaded!.workflowId).toBe("wf-1");
    expect(loaded!.completedStepIds).toContain("step1");
  });

  it("should load latest checkpoint for a workflow", async () => {
    const exec1 = createWorkflowExecution("wf-1", { status: WorkflowStatus.COMPLETED });
    const cp1 = createCheckpointFromExecution(exec1, "wf-1", "1.0.0", "abc", ["s1"]);

    // Small delay so timestamps differ
    await new Promise((r) => setTimeout(r, 10));

    const exec2 = createWorkflowExecution("wf-1", { status: WorkflowStatus.COMPLETED });
    const cp2 = createCheckpointFromExecution(exec2, "wf-1", "1.0.0", "abc", ["s1"]);

    await store.save(cp1);
    await store.save(cp2);

    const latest = await store.loadLatest("wf-1");
    expect(latest).toBeDefined();
    expect(latest!.checkpointId).toBe(cp2.checkpointId);
  });

  it("should delete a checkpoint", async () => {
    const exec = createWorkflowExecution("wf-1", { status: WorkflowStatus.COMPLETED });
    const cp = createCheckpointFromExecution(exec, "wf-1", "1.0.0", "abc", ["s1"]);

    await store.save(cp);
    const deleted = await store.delete(cp.checkpointId);
    expect(deleted).toBe(true);

    const loaded = await store.load(cp.checkpointId);
    expect(loaded).toBeUndefined();
  });

  it("should list metadata", async () => {
    for (let i = 0; i < 3; i++) {
      const exec = createWorkflowExecution("wf-1", {
        status: WorkflowStatus.COMPLETED,
        stepExecutions: {
          s1: createStepExecution("s1", { status: StepStatus.COMPLETED }),
        },
      });
      const cp = createCheckpointFromExecution(exec, "wf-1", "1.0.0", "abc", ["s1"]);
      await store.save(cp);
      await new Promise((r) => setTimeout(r, 5));
    }

    const metas = await store.listMetadata("wf-1");
    expect(metas).toHaveLength(3);
    expect(metas.every((m) => m.workflowId === "wf-1")).toBe(true);
  });

  it("should cleanup old checkpoints keeping last N", async () => {
    // Create 10 checkpoints
    for (let i = 0; i < 10; i++) {
      const exec = createWorkflowExecution("wf-cleanup", {
        status: WorkflowStatus.COMPLETED,
        stepExecutions: {
          s1: createStepExecution("s1", { status: StepStatus.COMPLETED }),
        },
      });
      const cp = createCheckpointFromExecution(exec, "wf-cleanup", "1.0.0", "abc", ["s1"]);
      await store.save(cp);
      await new Promise((r) => setTimeout(r, 5));
    }

    const beforeMeta = await store.listMetadata("wf-cleanup");
    expect(beforeMeta).toHaveLength(10);

    const deleted = await store.cleanupOld("wf-cleanup", 3);
    expect(deleted).toBe(7);

    const afterMeta = await store.listMetadata("wf-cleanup");
    expect(afterMeta).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 7. Workflow structure hash stability
// ---------------------------------------------------------------------------

describe("Workflow structure hash", () => {
  it("should produce identical hashes for identical structures", () => {
    function createWf() {
      const double = new FunctionStep(
        "double",
        createStepMetadata("Double"),
        (input: Record<string, unknown>) => ({ result: (input.value as number) * 2 }),
        "NumberInput",
        "NumberOutput"
      );
      const addTen = new FunctionStep(
        "add_ten",
        createStepMetadata("Add Ten"),
        (input: Record<string, unknown>) => ({ result: (input.result as number) + 10 }),
        "NumberOutput",
        "NumberOutput"
      );
      const wf = new Workflow(createWorkflowMetadata("Hash Test"));
      wf.chain(double, addTen);
      return wf;
    }

    const wf1 = createWf();
    const wf2 = createWf();

    const hash1 = wf1.computeStructureHash();
    const hash2 = wf2.computeStructureHash();

    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(16);
  });

  it("should produce different hashes for different structures", () => {
    const wf1 = new Workflow(createWorkflowMetadata("H1"));
    const a1 = makeEchoStep("a", "A");
    const b1 = makeEchoStep("b", "B");
    wf1.chain(a1, b1);

    const wf2 = new Workflow(createWorkflowMetadata("H2"));
    const a2 = makeEchoStep("a", "A");
    const b2 = makeEchoStep("b", "B");
    const c2 = makeEchoStep("c", "C");
    wf2.chain(a2, b2, c2);

    expect(wf1.computeStructureHash()).not.toBe(wf2.computeStructureHash());
  });
});

// ---------------------------------------------------------------------------
// 8. Checkpoint validation (structure mismatch)
// ---------------------------------------------------------------------------

describe("Checkpoint validation", () => {
  it("should reject checkpoint when workflow structure has changed", async () => {
    const double = new FunctionStep(
      "double",
      createStepMetadata("Double"),
      (input: Record<string, unknown>) => ({ result: (input.value as number) * 2 }),
      "NumberInput",
      "NumberOutput"
    );
    const addTen = new FunctionStep(
      "add_ten",
      createStepMetadata("Add Ten"),
      (input: Record<string, unknown>) => ({ result: (input.result as number) + 10 }),
      "NumberOutput",
      "NumberOutput"
    );

    // Build and run v1
    const wfV1 = new Workflow(createWorkflowMetadata("V1"), {}, "stable-id");
    wfV1.addStep(double).setStartStep("double").addEndStep("double");

    const runner = new WorkflowRunner();
    const store = new InMemoryCheckpointStore();
    const config = createCheckpointConfig({ store, autoSave: true });

    for await (const _event of runner.runStream(
      wfV1,
      { value: 3 },
      undefined,
      undefined,
      config
    )) {
      // consume
    }

    const checkpoint = await store.loadLatest(wfV1.id);
    expect(checkpoint).toBeDefined();

    // Build v2 with different structure but same id
    const wfV2 = new Workflow(createWorkflowMetadata("V2"), {}, "stable-id");
    wfV2.chain(double, addTen);

    const validation = runner.validateCheckpoint(wfV2, checkpoint!);
    expect(validation.canResume).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
    expect(validation.errors[0].toLowerCase()).toContain("structure");
  });
});

// ---------------------------------------------------------------------------
// 9. Workflow execution end-to-end
// ---------------------------------------------------------------------------

describe("Workflow execution", () => {
  it("should run a simple two-step workflow", async () => {
    const wf = makeSampleWorkflow();
    const runner = new WorkflowRunner();
    const execution = await runner.run(wf, { message: "hello" });

    expect(execution.status).toBe(WorkflowStatus.COMPLETED);
    expect(Object.keys(execution.stepExecutions)).toHaveLength(2);
    expect(execution.stepExecutions["step1"].status).toBe(StepStatus.COMPLETED);
    expect(execution.stepExecutions["step2"].status).toBe(StepStatus.COMPLETED);
  });

  it("should run a FunctionStep pipeline: double -> add_ten -> square", async () => {
    const double = new FunctionStep(
      "double",
      createStepMetadata("Double"),
      (input: Record<string, unknown>) => ({ result: (input.value as number) * 2 }),
      "NumberInput",
      "NumberOutput"
    );
    const addTen = new FunctionStep(
      "add_ten",
      createStepMetadata("Add Ten"),
      (input: Record<string, unknown>) => ({ result: (input.result as number) + 10 }),
      "NumberOutput",
      "NumberOutput"
    );
    const square = new FunctionStep(
      "square",
      createStepMetadata("Square"),
      (input: Record<string, unknown>) => ({ result: (input.result as number) ** 2 }),
      "NumberOutput",
      "NumberOutput"
    );

    const wf = new Workflow(createWorkflowMetadata("Math Pipeline"));
    wf.chain(double, addTen, square);

    const runner = new WorkflowRunner();
    const exec = await runner.run(wf, { value: 3 });

    expect(exec.status).toBe(WorkflowStatus.COMPLETED);
    // (3 * 2 + 10) ** 2 = 256
    expect((exec.state["square_output"] as Record<string, unknown>).result).toBe(256);
  });

  it("should emit correct event sequence via runStream", async () => {
    const wf = makeSampleWorkflow();
    const runner = new WorkflowRunner();
    const events: WorkflowEvent[] = [];

    for await (const event of runner.runStream(wf, { message: "test" })) {
      events.push(event);
    }

    const types = events.map((e) => e.eventType);
    expect(types[0]).toBe(WorkflowEventType.WORKFLOW_STARTED);
    expect(types[types.length - 1]).toBe(WorkflowEventType.WORKFLOW_COMPLETED);
    expect(types).toContain(WorkflowEventType.STEP_STARTED);
    expect(types).toContain(WorkflowEventType.STEP_COMPLETED);
  });
});
