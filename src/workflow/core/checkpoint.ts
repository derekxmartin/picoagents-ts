/**
 * Checkpoint storage backends for workflow execution state.
 */

import { v4 as uuidv4 } from "uuid";
import {
  type StepExecution,
  type WorkflowExecution,
  StepStatus,
} from "./models.js";

// ---------------------------------------------------------------------------
// WorkflowCheckpoint
// ---------------------------------------------------------------------------

export interface WorkflowCheckpoint {
  workflowId: string;
  workflowVersion: string;
  workflowStructureHash: string;
  checkpointId: string;
  createdAt: Date;
  checkpointType: string;
  execution: WorkflowExecution;
  completedStepIds: string[];
  pendingStepIds: string[];
}

export function createCheckpointFromExecution(
  execution: WorkflowExecution,
  workflowId: string,
  workflowVersion: string,
  workflowStructureHash: string,
  allStepIds: string[],
  checkpointType = "manual"
): WorkflowCheckpoint {
  const completedStepIds = Object.entries(execution.stepExecutions)
    .filter(([, se]) => se.status === StepStatus.COMPLETED)
    .map(([id]) => id);

  const pendingStepIds = allStepIds.filter(
    (id) =>
      !(id in execution.stepExecutions) ||
      execution.stepExecutions[id].status === StepStatus.PENDING
  );

  return {
    workflowId,
    workflowVersion,
    workflowStructureHash,
    checkpointId: uuidv4(),
    createdAt: new Date(),
    checkpointType,
    execution,
    completedStepIds,
    pendingStepIds,
  };
}

// ---------------------------------------------------------------------------
// CheckpointMetadata (lightweight)
// ---------------------------------------------------------------------------

export interface CheckpointMetadata {
  checkpointId: string;
  workflowId: string;
  workflowVersion: string;
  createdAt: Date;
  checkpointType: string;
  completedSteps: number;
  pendingSteps: number;
  totalSteps: number;
  sizeBytes?: number;
}

export function metadataFromCheckpoint(
  cp: WorkflowCheckpoint,
  sizeBytes?: number
): CheckpointMetadata {
  return {
    checkpointId: cp.checkpointId,
    workflowId: cp.workflowId,
    workflowVersion: cp.workflowVersion,
    createdAt: cp.createdAt,
    checkpointType: cp.checkpointType,
    completedSteps: cp.completedStepIds.length,
    pendingSteps: cp.pendingStepIds.length,
    totalSteps: cp.completedStepIds.length + cp.pendingStepIds.length,
    sizeBytes,
  };
}

// ---------------------------------------------------------------------------
// CheckpointValidationResult
// ---------------------------------------------------------------------------

export interface CheckpointValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  canResume: boolean;
  checkpointInfo: Record<string, unknown>;
}

export function createCheckpointValidation(
  overrides?: Partial<CheckpointValidationResult>
): CheckpointValidationResult {
  return {
    isValid: true,
    errors: [],
    warnings: [],
    canResume: true,
    checkpointInfo: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Abstract CheckpointStore
// ---------------------------------------------------------------------------

export abstract class CheckpointStore {
  abstract save(checkpoint: WorkflowCheckpoint): Promise<void>;
  abstract load(checkpointId: string): Promise<WorkflowCheckpoint | undefined>;
  abstract loadLatest(
    workflowId: string
  ): Promise<WorkflowCheckpoint | undefined>;
  abstract delete(checkpointId: string): Promise<boolean>;
  abstract listMetadata(
    workflowId?: string,
    limit?: number
  ): Promise<CheckpointMetadata[]>;
  abstract cleanupOld(
    workflowId: string,
    keepLastN?: number
  ): Promise<number>;
}

// ---------------------------------------------------------------------------
// InMemoryCheckpointStore
// ---------------------------------------------------------------------------

export class InMemoryCheckpointStore extends CheckpointStore {
  private checkpoints = new Map<string, WorkflowCheckpoint>();
  private byWorkflow = new Map<string, string[]>();

  async save(checkpoint: WorkflowCheckpoint): Promise<void> {
    this.checkpoints.set(checkpoint.checkpointId, checkpoint);
    const ids = this.byWorkflow.get(checkpoint.workflowId) ?? [];
    ids.push(checkpoint.checkpointId);
    this.byWorkflow.set(checkpoint.workflowId, ids);
  }

  async load(
    checkpointId: string
  ): Promise<WorkflowCheckpoint | undefined> {
    return this.checkpoints.get(checkpointId);
  }

  async loadLatest(
    workflowId: string
  ): Promise<WorkflowCheckpoint | undefined> {
    const ids = this.byWorkflow.get(workflowId) ?? [];
    const cps = ids
      .map((id) => this.checkpoints.get(id))
      .filter((cp): cp is WorkflowCheckpoint => cp !== undefined);
    if (!cps.length) return undefined;
    cps.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
    return cps[0];
  }

  async delete(checkpointId: string): Promise<boolean> {
    const cp = this.checkpoints.get(checkpointId);
    if (!cp) return false;
    this.checkpoints.delete(checkpointId);
    const ids = this.byWorkflow.get(cp.workflowId);
    if (ids) {
      const idx = ids.indexOf(checkpointId);
      if (idx >= 0) ids.splice(idx, 1);
    }
    return true;
  }

  async listMetadata(
    workflowId?: string,
    limit = 100
  ): Promise<CheckpointMetadata[]> {
    let cps: WorkflowCheckpoint[];
    if (workflowId) {
      const ids = this.byWorkflow.get(workflowId) ?? [];
      cps = ids
        .map((id) => this.checkpoints.get(id))
        .filter((cp): cp is WorkflowCheckpoint => cp !== undefined);
    } else {
      cps = [...this.checkpoints.values()];
    }

    const metas = cps.map((cp) => metadataFromCheckpoint(cp));
    metas.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
    return metas.slice(0, limit);
  }

  async cleanupOld(
    workflowId: string,
    keepLastN = 5
  ): Promise<number> {
    const ids = this.byWorkflow.get(workflowId) ?? [];
    const cps = ids
      .map((id) => ({
        id,
        cp: this.checkpoints.get(id),
      }))
      .filter(
        (x): x is { id: string; cp: WorkflowCheckpoint } =>
          x.cp !== undefined
      );
    cps.sort(
      (a, b) => b.cp.createdAt.getTime() - a.cp.createdAt.getTime()
    );
    const toDelete = cps.slice(keepLastN);
    for (const { id } of toDelete) {
      await this.delete(id);
    }
    return toDelete.length;
  }

  clear(): void {
    this.checkpoints.clear();
    this.byWorkflow.clear();
  }
}

// ---------------------------------------------------------------------------
// CheckpointConfig
// ---------------------------------------------------------------------------

export interface CheckpointConfig {
  store: CheckpointStore;
  autoSave: boolean;
  saveIntervalSteps: number;
  autoCleanup: boolean;
  keepLastN: number;
}

export function createCheckpointConfig(
  overrides?: Partial<CheckpointConfig>
): CheckpointConfig {
  return {
    store: new InMemoryCheckpointStore(),
    autoSave: true,
    saveIntervalSteps: 1,
    autoCleanup: false,
    keepLastN: 5,
    ...overrides,
  };
}
