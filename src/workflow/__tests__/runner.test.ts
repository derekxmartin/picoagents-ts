import { describe, it, expect } from "vitest";
import { Workflow } from "../core/workflow.js";
import { WorkflowRunner } from "../core/runner.js";
import {
  createStepMetadata,
  createWorkflowMetadata,
  WorkflowEventType,
  WorkflowStatus,
  StepStatus,
  type WorkflowEvent,
} from "../core/models.js";
import { EchoStep } from "../steps/echo-step.js";
import { FunctionStep } from "../steps/function-step.js";

function makeStep(id: string, prefix?: string) {
  return new EchoStep(id, createStepMetadata(`Step ${id}`), {
    prefix: prefix ?? `${id}: `,
  });
}

describe("WorkflowRunner", () => {
  it("should run a simple 2-step workflow", async () => {
    const wf = new Workflow(createWorkflowMetadata("test"));
    wf.chain(makeStep("s1"), makeStep("s2"));

    const runner = new WorkflowRunner();
    const execution = await runner.run(wf, { message: "hello" });
    expect(execution.status).toBe(WorkflowStatus.COMPLETED);
    expect(Object.keys(execution.stepExecutions)).toHaveLength(2);
    expect(execution.stepExecutions.s1.status).toBe(StepStatus.COMPLETED);
    expect(execution.stepExecutions.s2.status).toBe(StepStatus.COMPLETED);
  });

  it("should run a 3-step chain", async () => {
    const wf = new Workflow(createWorkflowMetadata("test"));
    wf.chain(makeStep("s1"), makeStep("s2"), makeStep("s3"));

    const runner = new WorkflowRunner();
    const execution = await runner.run(wf, { message: "go" });
    expect(execution.status).toBe(WorkflowStatus.COMPLETED);
    expect(Object.keys(execution.stepExecutions)).toHaveLength(3);
  });

  it("should stream events during execution", async () => {
    const wf = new Workflow(createWorkflowMetadata("test"));
    wf.chain(makeStep("s1"), makeStep("s2"));

    const runner = new WorkflowRunner();
    const events: WorkflowEvent[] = [];

    for await (const event of runner.runStream(wf, { message: "hi" })) {
      events.push(event);
    }

    const eventTypes = events.map((e) => e.eventType);
    expect(eventTypes).toContain(WorkflowEventType.WORKFLOW_STARTED);
    expect(eventTypes).toContain(WorkflowEventType.STEP_STARTED);
    expect(eventTypes).toContain(WorkflowEventType.STEP_COMPLETED);
    expect(eventTypes).toContain(WorkflowEventType.WORKFLOW_COMPLETED);
  });

  it("should emit edge activation events", async () => {
    const wf = new Workflow(createWorkflowMetadata("test"));
    wf.chain(makeStep("s1"), makeStep("s2"));

    const runner = new WorkflowRunner();
    const events: WorkflowEvent[] = [];

    for await (const event of runner.runStream(wf, { message: "hi" })) {
      events.push(event);
    }

    const edgeEvents = events.filter(
      (e) => e.eventType === WorkflowEventType.EDGE_ACTIVATED
    );
    expect(edgeEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("should handle step failure", async () => {
    const wf = new Workflow(createWorkflowMetadata("test"));
    const failStep = new FunctionStep(
      "fail",
      createStepMetadata("Fail"),
      () => {
        throw new Error("Step failed!");
      }
    );
    const s2 = makeStep("s2");
    wf.chain(failStep, s2);

    const runner = new WorkflowRunner();
    await expect(runner.run(wf, { message: "test" })).rejects.toThrow(
      "Step failed!"
    );
  });

  it("should reject invalid workflow", async () => {
    const wf = new Workflow(createWorkflowMetadata("test"));
    // No steps, no start step

    const runner = new WorkflowRunner();
    const events: WorkflowEvent[] = [];
    for await (const event of runner.runStream(wf)) {
      events.push(event);
    }

    const failEvent = events.find(
      (e) => e.eventType === WorkflowEventType.WORKFLOW_FAILED
    );
    expect(failEvent).toBeDefined();
  });

  it("should run a single step independently", async () => {
    const step = makeStep("solo");
    const runner = new WorkflowRunner();
    const result = await runner.runStep(step, { message: "test" }, { workflow_state: {} });
    expect(result.message).toBe("solo: test");
  });

  it("should get execution status", () => {
    const runner = new WorkflowRunner();
    const execution = {
      id: "exec-1",
      workflowId: "wf-1",
      status: WorkflowStatus.COMPLETED as string,
      startTime: new Date(2024, 0, 1),
      endTime: new Date(2024, 0, 1, 0, 0, 1),
      state: {},
      stepExecutions: {
        s1: {
          stepId: "s1",
          status: StepStatus.COMPLETED as string,
          retryCount: 0,
        },
      },
    };
    const status = runner.getExecutionStatus(execution);
    expect((status.progress as Record<string, unknown>).completedSteps).toBe(1);
    expect((status.timing as Record<string, unknown>).durationSeconds).toBeCloseTo(1, 0);
  });
});

describe("WorkflowRunner with FunctionStep", () => {
  it("should pass data between function steps", async () => {
    const wf = new Workflow(createWorkflowMetadata("test"));

    const step1 = new FunctionStep(
      "double",
      createStepMetadata("Double"),
      (input: Record<string, unknown>) => ({
        value: (input.value as number) * 2,
      })
    );

    const step2 = new FunctionStep(
      "add10",
      createStepMetadata("Add10"),
      (input: Record<string, unknown>) => ({
        value: (input.value as number) + 10,
      })
    );

    wf.chain(step1, step2);

    const runner = new WorkflowRunner();
    const execution = await runner.run(wf, { value: 5 });
    expect(execution.status).toBe(WorkflowStatus.COMPLETED);

    // step1 output: {value: 10}, step2 input: {value: 10}, output: {value: 20}
    expect(execution.stepExecutions.add10.outputData).toEqual({ value: 20 });
  });
});
