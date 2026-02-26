import { describe, it, expect } from "vitest";
import {
  InMemoryCheckpointStore,
  createCheckpointFromExecution,
  metadataFromCheckpoint,
  createCheckpointConfig,
} from "../core/checkpoint.js";
import {
  createWorkflowExecution,
  StepStatus,
  WorkflowStatus,
} from "../core/models.js";

function makeCheckpoint(workflowId = "wf-1") {
  const execution = createWorkflowExecution(workflowId, {
    status: WorkflowStatus.RUNNING,
    stepExecutions: {
      s1: { stepId: "s1", status: StepStatus.COMPLETED, retryCount: 0 },
      s2: { stepId: "s2", status: StepStatus.PENDING, retryCount: 0 },
    },
  });

  return createCheckpointFromExecution(
    execution,
    workflowId,
    "1.0.0",
    "abc123",
    ["s1", "s2"],
    "auto"
  );
}

describe("InMemoryCheckpointStore", () => {
  it("should save and load checkpoint", async () => {
    const store = new InMemoryCheckpointStore();
    const cp = makeCheckpoint();

    await store.save(cp);
    const loaded = await store.load(cp.checkpointId);
    expect(loaded).toBeDefined();
    expect(loaded?.checkpointId).toBe(cp.checkpointId);
  });

  it("should load latest", async () => {
    const store = new InMemoryCheckpointStore();
    const cp1 = makeCheckpoint();
    const cp2 = makeCheckpoint();
    cp2.createdAt = new Date(Date.now() + 1000);

    await store.save(cp1);
    await store.save(cp2);

    const latest = await store.loadLatest("wf-1");
    expect(latest?.checkpointId).toBe(cp2.checkpointId);
  });

  it("should delete checkpoint", async () => {
    const store = new InMemoryCheckpointStore();
    const cp = makeCheckpoint();
    await store.save(cp);

    const deleted = await store.delete(cp.checkpointId);
    expect(deleted).toBe(true);

    const loaded = await store.load(cp.checkpointId);
    expect(loaded).toBeUndefined();
  });

  it("should list metadata", async () => {
    const store = new InMemoryCheckpointStore();
    await store.save(makeCheckpoint("wf-1"));
    await store.save(makeCheckpoint("wf-2"));

    const all = await store.listMetadata();
    expect(all).toHaveLength(2);

    const wf1Only = await store.listMetadata("wf-1");
    expect(wf1Only).toHaveLength(1);
  });

  it("should cleanup old checkpoints", async () => {
    const store = new InMemoryCheckpointStore();

    for (let i = 0; i < 5; i++) {
      const cp = makeCheckpoint("wf-1");
      cp.createdAt = new Date(Date.now() + i * 1000);
      await store.save(cp);
    }

    const deleted = await store.cleanupOld("wf-1", 2);
    expect(deleted).toBe(3);

    const remaining = await store.listMetadata("wf-1");
    expect(remaining).toHaveLength(2);
  });

  it("should clear all checkpoints", async () => {
    const store = new InMemoryCheckpointStore();
    await store.save(makeCheckpoint());
    store.clear();
    const all = await store.listMetadata();
    expect(all).toHaveLength(0);
  });
});

describe("createCheckpointFromExecution", () => {
  it("should correctly categorize completed and pending steps", () => {
    const cp = makeCheckpoint();
    expect(cp.completedStepIds).toContain("s1");
    expect(cp.pendingStepIds).toContain("s2");
    expect(cp.checkpointType).toBe("auto");
    expect(cp.workflowStructureHash).toBe("abc123");
  });
});

describe("metadataFromCheckpoint", () => {
  it("should extract metadata", () => {
    const cp = makeCheckpoint();
    const meta = metadataFromCheckpoint(cp, 1234);
    expect(meta.completedSteps).toBe(1);
    expect(meta.pendingSteps).toBe(1);
    expect(meta.totalSteps).toBe(2);
    expect(meta.sizeBytes).toBe(1234);
  });
});

describe("CheckpointConfig", () => {
  it("should create with defaults", () => {
    const config = createCheckpointConfig();
    expect(config.autoSave).toBe(true);
    expect(config.saveIntervalSteps).toBe(1);
    expect(config.store).toBeInstanceOf(InMemoryCheckpointStore);
  });
});
