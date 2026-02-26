import { describe, it, expect } from "vitest";
import { Workflow } from "../core/workflow.js";
import {
  createStepMetadata,
  createWorkflowMetadata,
  createWorkflowExecution,
  StepStatus,
  WorkflowStatus,
} from "../core/models.js";
import { EchoStep } from "../steps/echo-step.js";

function makeStep(id: string) {
  return new EchoStep(id, createStepMetadata(`Step ${id}`));
}

describe("Workflow", () => {
  it("should create empty workflow", () => {
    const wf = new Workflow(createWorkflowMetadata("test"));
    expect(wf.steps.size).toBe(0);
    expect(wf.edges).toHaveLength(0);
  });

  it("should add steps", () => {
    const wf = new Workflow(createWorkflowMetadata("test"));
    const step = makeStep("s1");
    wf.addStep(step);
    expect(wf.steps.size).toBe(1);
  });

  it("should add edges", () => {
    const wf = new Workflow(createWorkflowMetadata("test"));
    const s1 = makeStep("s1");
    const s2 = makeStep("s2");
    wf.addEdge(s1, s2);
    expect(wf.edges).toHaveLength(1);
    expect(wf.steps.size).toBe(2); // auto-registered
  });

  it("should chain steps", () => {
    const wf = new Workflow(createWorkflowMetadata("test"));
    const s1 = makeStep("s1");
    const s2 = makeStep("s2");
    const s3 = makeStep("s3");
    wf.chain(s1, s2, s3);
    expect(wf.edges).toHaveLength(2);
    expect(wf.startStepId).toBe("s1");
    expect(wf.endStepIds).toContain("s3");
  });

  it("chain requires at least 2 steps", () => {
    const wf = new Workflow(createWorkflowMetadata("test"));
    expect(() => wf.chain(makeStep("s1"))).toThrow();
  });

  it("setStartStep validates existence", () => {
    const wf = new Workflow(createWorkflowMetadata("test"));
    expect(() => wf.setStartStep("nonexistent")).toThrow();
  });

  it("should get dependencies", () => {
    const wf = new Workflow(createWorkflowMetadata("test"));
    const s1 = makeStep("s1");
    const s2 = makeStep("s2");
    wf.chain(s1, s2);
    expect(wf.getStepDependencies("s2")).toEqual(["s1"]);
    expect(wf.getStepDependencies("s1")).toEqual([]);
  });

  it("should get dependents", () => {
    const wf = new Workflow(createWorkflowMetadata("test"));
    const s1 = makeStep("s1");
    const s2 = makeStep("s2");
    wf.chain(s1, s2);
    expect(wf.getStepDependents("s1")).toEqual(["s2"]);
    expect(wf.getStepDependents("s2")).toEqual([]);
  });
});

describe("Workflow validation", () => {
  it("should reject empty workflow", () => {
    const wf = new Workflow(createWorkflowMetadata("test"));
    const result = wf.validateWorkflow();
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("should reject workflow without start step", () => {
    const wf = new Workflow(createWorkflowMetadata("test"));
    wf.addStep(makeStep("s1"));
    const result = wf.validateWorkflow();
    expect(result.isValid).toBe(false);
  });

  it("should validate valid chained workflow", () => {
    const wf = new Workflow(createWorkflowMetadata("test"));
    wf.chain(makeStep("s1"), makeStep("s2"));
    const result = wf.validateWorkflow();
    expect(result.isValid).toBe(true);
    expect(result.hasCycles).toBe(false);
  });

  it("should detect cycles", () => {
    const wf = new Workflow(createWorkflowMetadata("test"));
    const s1 = makeStep("s1");
    const s2 = makeStep("s2");
    wf.addStep(s1).addStep(s2);
    wf.addEdge("s1", "s2");
    wf.addEdge("s2", "s1"); // cycle
    wf.setStartStep("s1");
    wf.addEndStep("s2");
    const result = wf.validateWorkflow();
    expect(result.hasCycles).toBe(true);
    expect(result.isValid).toBe(false);
  });

  it("should detect unreachable steps", () => {
    const wf = new Workflow(createWorkflowMetadata("test"));
    const s1 = makeStep("s1");
    const s2 = makeStep("s2");
    const s3 = makeStep("s3"); // unreachable
    wf.addStep(s1).addStep(s2).addStep(s3);
    wf.addEdge("s1", "s2");
    wf.setStartStep("s1");
    wf.addEndStep("s2");
    const result = wf.validateWorkflow();
    expect(result.unreachableSteps).toContain("s3");
  });
});

describe("Workflow getReadySteps", () => {
  it("should return start step initially", () => {
    const wf = new Workflow(createWorkflowMetadata("test"));
    wf.chain(makeStep("s1"), makeStep("s2"));
    const execution = createWorkflowExecution(wf.id, {
      status: WorkflowStatus.RUNNING,
    });
    const ready = wf.getReadySteps(execution);
    expect(ready).toEqual(["s1"]);
  });

  it("should return next step after dependency completes", () => {
    const wf = new Workflow(createWorkflowMetadata("test"));
    wf.chain(makeStep("s1"), makeStep("s2"));
    const execution = createWorkflowExecution(wf.id, {
      status: WorkflowStatus.RUNNING,
      stepExecutions: {
        s1: {
          stepId: "s1",
          status: StepStatus.COMPLETED,
          retryCount: 0,
          outputData: { message: "done" },
        },
      },
    });
    const ready = wf.getReadySteps(execution);
    expect(ready).toEqual(["s2"]);
  });
});

describe("Edge condition evaluation", () => {
  it("always condition returns true", () => {
    const wf = new Workflow(createWorkflowMetadata("test"));
    wf.chain(makeStep("s1"), makeStep("s2"));
    const edge = wf.edges[0];
    const execution = createWorkflowExecution(wf.id);
    expect(wf.evaluateEdgeCondition(edge, execution)).toBe(true);
  });

  it("output_based condition checks field value", () => {
    const wf = new Workflow(createWorkflowMetadata("test"));
    const s1 = makeStep("s1");
    const s2 = makeStep("s2");
    wf.addEdge(s1, s2, {
      type: "output_based",
      field: "success",
      operator: "==",
      value: true,
    });
    wf.setStartStep(s1);
    wf.addEndStep(s2);

    const execution = createWorkflowExecution(wf.id, {
      stepExecutions: {
        s1: {
          stepId: "s1",
          status: StepStatus.COMPLETED,
          retryCount: 0,
          outputData: { success: true },
        },
      },
    });

    expect(wf.evaluateEdgeCondition(wf.edges[0], execution)).toBe(true);
  });
});

describe("Workflow structure hash", () => {
  it("same structure produces same hash", () => {
    const wf1 = new Workflow(createWorkflowMetadata("test1"));
    wf1.chain(makeStep("s1"), makeStep("s2"));
    const wf2 = new Workflow(createWorkflowMetadata("test2"));
    wf2.chain(makeStep("s1"), makeStep("s2"));
    expect(wf1.computeStructureHash()).toBe(wf2.computeStructureHash());
  });

  it("different structure produces different hash", () => {
    const wf1 = new Workflow(createWorkflowMetadata("test"));
    wf1.chain(makeStep("s1"), makeStep("s2"));
    const wf2 = new Workflow(createWorkflowMetadata("test"));
    wf2.chain(makeStep("s1"), makeStep("s2"), makeStep("s3"));
    expect(wf1.computeStructureHash()).not.toBe(wf2.computeStructureHash());
  });
});
