/**
 * Integration test: Workflow system end-to-end.
 *
 * Tests the Workflow → Steps → Runner pipeline with
 * parallel execution, edge conditions, and checkpoints.
 */

import { describe, it, expect } from "vitest";
import {
  Workflow,
  WorkflowRunner,
  WorkflowEventType,
  WorkflowStatus,
  StepStatus,
  createStepMetadata,
  createWorkflowMetadata,
  InMemoryCheckpointStore,
  createCheckpointConfig,
} from "../workflow/core/index.js";
import { EchoStep } from "../workflow/steps/echo-step.js";
import { FunctionStep } from "../workflow/steps/function-step.js";
import { TransformStep } from "../workflow/steps/transform-step.js";
import type { WorkflowEvent } from "../workflow/core/models.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Workflow integration", () => {
  it("should run a linear 3-step workflow", async () => {
    const echo1 = new EchoStep("echo1", createStepMetadata("Echo 1"), { prefix: "Step1: " });
    const echo2 = new EchoStep("echo2", createStepMetadata("Echo 2"), { prefix: "Step2: " });
    const echo3 = new EchoStep("echo3", createStepMetadata("Echo 3"), { prefix: "Step3: " });

    const workflow = new Workflow(
      createWorkflowMetadata("Linear Test"),
      {},
      "linear-test"
    );

    workflow.addStep(echo1);
    workflow.addStep(echo2);
    workflow.addStep(echo3);
    workflow.chain(echo1, echo2, echo3);

    const runner = new WorkflowRunner();
    const execution = await runner.run(workflow, { message: "hello" });

    expect(execution.status).toBe(WorkflowStatus.COMPLETED);
    expect(Object.keys(execution.stepExecutions)).toHaveLength(3);

    for (const se of Object.values(execution.stepExecutions)) {
      expect(se.status).toBe(StepStatus.COMPLETED);
    }
  });

  it("should run parallel steps (diamond pattern)", async () => {
    const start = new FunctionStep("start", createStepMetadata("Start"), (input) => ({
      value: (input.value as number) * 2,
    }));
    const branchA = new FunctionStep("branch_a", createStepMetadata("Branch A"), (input) => ({
      a_result: `A:${input.value}`,
    }));
    const branchB = new FunctionStep("branch_b", createStepMetadata("Branch B"), (input) => ({
      b_result: `B:${input.value}`,
    }));
    const end = new FunctionStep("end", createStepMetadata("End"), (input) => ({
      final: "done",
      ...input,
    }));

    const workflow = new Workflow(
      createWorkflowMetadata("Diamond"),
      {},
      "diamond-test"
    );

    workflow.addStep(start);
    workflow.addStep(branchA);
    workflow.addStep(branchB);
    workflow.addStep(end);

    workflow.addEdge("start", "branch_a");
    workflow.addEdge("start", "branch_b");
    workflow.addEdge("branch_a", "end");
    workflow.addEdge("branch_b", "end");

    workflow.setStartStep("start");
    workflow.addEndStep("end");

    const runner = new WorkflowRunner(2);
    const execution = await runner.run(workflow, { value: 5 });

    expect(execution.status).toBe(WorkflowStatus.COMPLETED);
    expect(Object.keys(execution.stepExecutions)).toHaveLength(4);
  });

  it("should stream workflow events in correct order", async () => {
    const step1 = new EchoStep("step1", createStepMetadata("Step 1"));
    const step2 = new EchoStep("step2", createStepMetadata("Step 2"));

    const workflow = new Workflow(
      createWorkflowMetadata("Event Test"),
      {},
      "event-test"
    );

    workflow.addStep(step1);
    workflow.addStep(step2);
    workflow.chain(step1, step2);

    const runner = new WorkflowRunner();
    const events: WorkflowEvent[] = [];

    for await (const event of runner.runStream(workflow, { message: "test" })) {
      events.push(event);
    }

    // Should start with WORKFLOW_STARTED
    expect(events[0].eventType).toBe(WorkflowEventType.WORKFLOW_STARTED);

    // Should end with WORKFLOW_COMPLETED
    expect(events[events.length - 1].eventType).toBe(
      WorkflowEventType.WORKFLOW_COMPLETED
    );

    // Should have step events in between
    const stepStarted = events.filter(
      (e) => e.eventType === WorkflowEventType.STEP_STARTED
    );
    const stepCompleted = events.filter(
      (e) => e.eventType === WorkflowEventType.STEP_COMPLETED
    );
    expect(stepStarted).toHaveLength(2);
    expect(stepCompleted).toHaveLength(2);
  });

  it("should support workflow with transform step", async () => {
    const inputStep = new FunctionStep("input", createStepMetadata("Input"), (data) => ({
      name: data.name,
      greeting: `Hello ${data.name}`,
    }));

    const transformStep = new TransformStep("transform", createStepMetadata("Transform"), {
      output_name: "name",
      output_greeting: "greeting",
      label: "static:processed",
    });

    const workflow = new Workflow(
      createWorkflowMetadata("Transform Test"),
      {},
      "transform-test"
    );

    workflow.addStep(inputStep);
    workflow.addStep(transformStep);
    workflow.chain(inputStep, transformStep);

    const runner = new WorkflowRunner();
    const execution = await runner.run(workflow, { name: "Alice" });

    expect(execution.status).toBe(WorkflowStatus.COMPLETED);
    const transformOutput = execution.stepExecutions["transform"]?.outputData;
    expect(transformOutput).toBeDefined();
    expect(transformOutput?.output_name).toBe("Alice");
    expect(transformOutput?.label).toBe("processed");
  });

  it("should handle step failure gracefully", async () => {
    const good = new EchoStep("good", createStepMetadata("Good"));
    const bad = new FunctionStep("bad", createStepMetadata("Bad"), () => {
      throw new Error("Intentional failure");
    });

    const workflow = new Workflow(
      createWorkflowMetadata("Fail Test"),
      {},
      "fail-test"
    );

    workflow.addStep(good);
    workflow.addStep(bad);
    workflow.chain(good, bad);

    const runner = new WorkflowRunner();

    await expect(
      runner.run(workflow, { message: "test" })
    ).rejects.toThrow();
  });

  it("should validate workflow correctly", () => {
    const a = new EchoStep("a", createStepMetadata("A"));
    const b = new EchoStep("b", createStepMetadata("B"));

    const workflow = new Workflow(
      createWorkflowMetadata("Valid"),
      {},
      "valid-test"
    );

    workflow.addStep(a);
    workflow.addStep(b);
    workflow.chain(a, b);

    const result = workflow.validateWorkflow();
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should detect cycles in workflow", () => {
    const a = new EchoStep("a", createStepMetadata("A"));
    const b = new EchoStep("b", createStepMetadata("B"));

    const workflow = new Workflow(
      createWorkflowMetadata("Cycle"),
      {},
      "cycle-test"
    );

    workflow.addStep(a);
    workflow.addStep(b);
    workflow.addEdge("a", "b");
    workflow.addEdge("b", "a");
    workflow.setStartStep("a");
    workflow.addEndStep("b");

    const result = workflow.validateWorkflow();
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes("ycle"))).toBe(true);
  });
});
