import { describe, it, expect } from "vitest";
import {
  StepStatus,
  WorkflowStatus,
  WorkflowEventType,
  createEdge,
  createEdgeCondition,
  createStepExecution,
  createWorkflowExecution,
  createStepMetadata,
  createWorkflowMetadata,
  WorkflowContext,
  createValidationResult,
} from "../core/models.js";

describe("Enums", () => {
  it("StepStatus has all values", () => {
    expect(StepStatus.PENDING).toBe("pending");
    expect(StepStatus.RUNNING).toBe("running");
    expect(StepStatus.COMPLETED).toBe("completed");
    expect(StepStatus.FAILED).toBe("failed");
    expect(StepStatus.SKIPPED).toBe("skipped");
    expect(StepStatus.CANCELLED).toBe("cancelled");
  });

  it("WorkflowStatus has all values", () => {
    expect(WorkflowStatus.CREATED).toBe("created");
    expect(WorkflowStatus.RUNNING).toBe("running");
    expect(WorkflowStatus.COMPLETED).toBe("completed");
  });

  it("WorkflowEventType has all values", () => {
    expect(WorkflowEventType.WORKFLOW_STARTED).toBe("workflow_started");
    expect(WorkflowEventType.STEP_COMPLETED).toBe("step_completed");
    expect(WorkflowEventType.EDGE_ACTIVATED).toBe("edge_activated");
  });
});

describe("Edge & Condition", () => {
  it("createEdgeCondition defaults to always", () => {
    const cond = createEdgeCondition();
    expect(cond.type).toBe("always");
  });

  it("createEdge creates edge with unique id", () => {
    const e1 = createEdge("a", "b");
    const e2 = createEdge("a", "b");
    expect(e1.id).not.toBe(e2.id);
    expect(e1.fromStep).toBe("a");
    expect(e1.toStep).toBe("b");
    expect(e1.condition.type).toBe("always");
  });

  it("createEdge with condition", () => {
    const e = createEdge("a", "b", {
      type: "output_based",
      field: "success",
      operator: "==",
      value: true,
    });
    expect(e.condition.type).toBe("output_based");
    expect(e.condition.field).toBe("success");
  });
});

describe("StepExecution", () => {
  it("creates with defaults", () => {
    const se = createStepExecution("step-1");
    expect(se.stepId).toBe("step-1");
    expect(se.status).toBe(StepStatus.PENDING);
    expect(se.retryCount).toBe(0);
  });
});

describe("WorkflowExecution", () => {
  it("creates with defaults", () => {
    const we = createWorkflowExecution("wf-1");
    expect(we.workflowId).toBe("wf-1");
    expect(we.status).toBe(WorkflowStatus.CREATED);
    expect(we.id).toBeTruthy();
  });
});

describe("Metadata", () => {
  it("createStepMetadata with defaults", () => {
    const m = createStepMetadata("test");
    expect(m.name).toBe("test");
    expect(m.tags).toEqual([]);
    expect(m.maxRetries).toBe(0);
  });

  it("createWorkflowMetadata with defaults", () => {
    const m = createWorkflowMetadata("my-wf");
    expect(m.name).toBe("my-wf");
    expect(m.version).toBe("1.0.0");
    expect(m.createdAt).toBeInstanceOf(Date);
  });
});

describe("WorkflowContext", () => {
  it("get and set values", () => {
    const ctx = new WorkflowContext();
    ctx.set("key", "value");
    expect(ctx.get("key")).toBe("value");
    expect(ctx.get("missing", "default")).toBe("default");
  });

  it("fromStateRef shares reference", () => {
    const state = { a: 1 };
    const ctx = WorkflowContext.fromStateRef(state);
    ctx.set("b", 2);
    expect(state.b).toBe(2); // same reference
  });

  it("emitProgress calls callback", () => {
    const ctx = new WorkflowContext();
    const events: Record<string, unknown>[] = [];
    ctx.setProgressCallback((d) => events.push(d));
    ctx.emitProgress("hello", 1, 10);
    expect(events).toHaveLength(1);
    expect(events[0].message).toBe("hello");
  });

  it("toDict includes state", () => {
    const ctx = new WorkflowContext({ x: 42 });
    const d = ctx.toDict();
    expect(d.x).toBe(42);
    expect(d.workflow_state).toEqual({ x: 42 });
  });
});

describe("WorkflowValidationResult", () => {
  it("defaults to valid", () => {
    const r = createValidationResult();
    expect(r.isValid).toBe(true);
    expect(r.errors).toEqual([]);
  });
});
