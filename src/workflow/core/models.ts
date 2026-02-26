/**
 * Core data models for the workflow system.
 */

import { v4 as uuidv4 } from "uuid";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const StepStatus = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  SKIPPED: "skipped",
  CANCELLED: "cancelled",
} as const;
export type StepStatus = (typeof StepStatus)[keyof typeof StepStatus];

export const WorkflowStatus = {
  CREATED: "created",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;
export type WorkflowStatus = (typeof WorkflowStatus)[keyof typeof WorkflowStatus];

export const WorkflowEventType = {
  WORKFLOW_STARTED: "workflow_started",
  WORKFLOW_COMPLETED: "workflow_completed",
  WORKFLOW_FAILED: "workflow_failed",
  WORKFLOW_CANCELLED: "workflow_cancelled",
  WORKFLOW_RESUMED: "workflow_resumed",
  CHECKPOINT_SAVED: "checkpoint_saved",
  STEP_STARTED: "step_started",
  STEP_COMPLETED: "step_completed",
  STEP_FAILED: "step_failed",
  STEP_PROGRESS: "step_progress",
  EDGE_ACTIVATED: "edge_activated",
} as const;
export type WorkflowEventType =
  (typeof WorkflowEventType)[keyof typeof WorkflowEventType];

// ---------------------------------------------------------------------------
// Edge & Condition
// ---------------------------------------------------------------------------

export interface EdgeCondition {
  type: "always" | "output_based" | "state_based" | string;
  expression?: string;
  field?: string;
  value?: unknown;
  operator?: string;
}

export function createEdgeCondition(
  overrides?: Partial<EdgeCondition>
): EdgeCondition {
  return { type: "always", ...overrides };
}

export interface Edge {
  id: string;
  fromStep: string;
  toStep: string;
  condition: EdgeCondition;
}

export function createEdge(
  fromStep: string,
  toStep: string,
  condition?: Partial<EdgeCondition>
): Edge {
  return {
    id: uuidv4(),
    fromStep,
    toStep,
    condition: createEdgeCondition(condition),
  };
}

// ---------------------------------------------------------------------------
// Execution tracking
// ---------------------------------------------------------------------------

export interface StepExecution {
  stepId: string;
  status: StepStatus;
  startTime?: Date;
  endTime?: Date;
  inputData?: Record<string, unknown>;
  outputData?: Record<string, unknown>;
  error?: string;
  retryCount: number;
}

export function createStepExecution(
  stepId: string,
  overrides?: Partial<StepExecution>
): StepExecution {
  return {
    stepId,
    status: StepStatus.PENDING,
    retryCount: 0,
    ...overrides,
  };
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: WorkflowStatus;
  startTime?: Date;
  endTime?: Date;
  state: Record<string, unknown>;
  stepExecutions: Record<string, StepExecution>;
  error?: string;
}

export function createWorkflowExecution(
  workflowId: string,
  overrides?: Partial<WorkflowExecution>
): WorkflowExecution {
  return {
    id: uuidv4(),
    workflowId,
    status: WorkflowStatus.CREATED,
    state: {},
    stepExecutions: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export interface StepMetadata {
  name: string;
  description?: string;
  tags: string[];
  maxRetries: number;
  timeoutSeconds?: number;
}

export function createStepMetadata(
  name: string,
  overrides?: Partial<StepMetadata>
): StepMetadata {
  return {
    name,
    tags: [],
    maxRetries: 0,
    ...overrides,
  };
}

export interface WorkflowMetadata {
  name: string;
  description?: string;
  version: string;
  tags: string[];
  author?: string;
  createdAt: Date;
}

export function createWorkflowMetadata(
  name: string,
  overrides?: Partial<WorkflowMetadata>
): WorkflowMetadata {
  return {
    name,
    version: "1.0.0",
    tags: [],
    createdAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export class WorkflowContext {
  state: Record<string, unknown>;
  private progressCallback?: (data: Record<string, unknown>) => void;

  constructor(state?: Record<string, unknown>) {
    this.state = state ?? {};
  }

  static fromStateRef(stateDict: Record<string, unknown>): WorkflowContext {
    const ctx = new WorkflowContext();
    ctx.state = stateDict; // Direct reference, no copy
    return ctx;
  }

  get(key: string, defaultValue?: unknown): unknown {
    return this.state[key] ?? defaultValue;
  }

  set(key: string, value: unknown): void {
    this.state[key] = value;
  }

  setProgressCallback(cb: (data: Record<string, unknown>) => void): void {
    this.progressCallback = cb;
  }

  emitProgress(
    message: string,
    completed?: number,
    total?: number,
    metadata?: Record<string, unknown>
  ): void {
    if (this.progressCallback) {
      this.progressCallback({
        message,
        completed,
        total,
        metadata: metadata ?? {},
      });
    }
  }

  toDict(): Record<string, unknown> {
    return {
      workflow_state: this.state,
      ...this.state,
    };
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface WorkflowValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  hasCycles: boolean;
  unreachableSteps: string[];
}

export function createValidationResult(
  overrides?: Partial<WorkflowValidationResult>
): WorkflowValidationResult {
  return {
    isValid: true,
    errors: [],
    warnings: [],
    hasCycles: false,
    unreachableSteps: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Workflow Events
// ---------------------------------------------------------------------------

export interface WorkflowEvent {
  eventType: WorkflowEventType;
  timestamp: Date;
  workflowId: string;
  [key: string]: unknown;
}

export interface WorkflowStartedEvent extends WorkflowEvent {
  eventType: typeof WorkflowEventType.WORKFLOW_STARTED;
  initialInput: Record<string, unknown>;
}

export interface WorkflowCompletedEvent extends WorkflowEvent {
  eventType: typeof WorkflowEventType.WORKFLOW_COMPLETED;
  execution: WorkflowExecution;
}

export interface WorkflowFailedEvent extends WorkflowEvent {
  eventType: typeof WorkflowEventType.WORKFLOW_FAILED;
  error: string;
  execution?: WorkflowExecution;
}

export interface WorkflowCancelledEvent extends WorkflowEvent {
  eventType: typeof WorkflowEventType.WORKFLOW_CANCELLED;
  execution: WorkflowExecution;
  reason: string;
}

export interface WorkflowResumedEvent extends WorkflowEvent {
  eventType: typeof WorkflowEventType.WORKFLOW_RESUMED;
  checkpointId: string;
  completedSteps: string[];
  pendingSteps: string[];
}

export interface StepStartedEvent extends WorkflowEvent {
  eventType: typeof WorkflowEventType.STEP_STARTED;
  stepId: string;
  inputData: Record<string, unknown>;
}

export interface StepCompletedEvent extends WorkflowEvent {
  eventType: typeof WorkflowEventType.STEP_COMPLETED;
  stepId: string;
  outputData: Record<string, unknown>;
  durationSeconds: number;
}

export interface StepFailedEvent extends WorkflowEvent {
  eventType: typeof WorkflowEventType.STEP_FAILED;
  stepId: string;
  error: string;
  durationSeconds: number;
}

export interface StepProgressEvent extends WorkflowEvent {
  eventType: typeof WorkflowEventType.STEP_PROGRESS;
  stepId: string;
  message: string;
  completed?: number;
  total?: number;
  metadata: Record<string, unknown>;
}

export interface EdgeActivatedEvent extends WorkflowEvent {
  eventType: typeof WorkflowEventType.EDGE_ACTIVATED;
  fromStep: string;
  toStep: string;
  data: Record<string, unknown>;
}

export interface CheckpointSavedEvent extends WorkflowEvent {
  eventType: typeof WorkflowEventType.CHECKPOINT_SAVED;
  checkpointId: string;
  completedSteps: number;
  totalSteps: number;
}

/** Create a workflow event with auto-timestamp. */
export function createWorkflowEvent<T extends WorkflowEvent>(
  event: Omit<T, "timestamp"> & { timestamp?: Date }
): T {
  return {
    timestamp: new Date(),
    ...event,
  } as T;
}
