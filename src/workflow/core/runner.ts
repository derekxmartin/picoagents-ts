/**
 * Workflow runner — executes workflows with parallel step support.
 *
 * Uses Promise-based concurrency (JS is single-threaded, but
 * async I/O parallelism is achievable with Promise.all).
 */

import type { CancellationToken } from "../../cancellation-token.js";
import type { BaseStep } from "../steps/base-step.js";
import {
  type CheckpointConfig,
  type CheckpointValidationResult,
  type WorkflowCheckpoint,
  createCheckpointFromExecution,
  createCheckpointValidation,
} from "./checkpoint.js";
import {
  type WorkflowEvent,
  type WorkflowExecution,
  type StepExecution,
  WorkflowContext,
  WorkflowEventType,
  WorkflowStatus,
  StepStatus,
  createWorkflowExecution,
  createStepExecution,
} from "./models.js";
import type { Workflow } from "./workflow.js";

// ---------------------------------------------------------------------------
// Semaphore for concurrency control
// ---------------------------------------------------------------------------

class Semaphore {
  private current = 0;
  private queue: Array<() => void> = [];

  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.current++;
        resolve();
      });
    });
  }

  release(): void {
    this.current--;
    const next = this.queue.shift();
    if (next) next();
  }
}

// ---------------------------------------------------------------------------
// WorkflowRunner
// ---------------------------------------------------------------------------

export class WorkflowRunner {
  maxConcurrentSteps: number;
  private semaphore: Semaphore;
  private cancellationTokens = new Map<string, CancellationToken>();

  constructor(maxConcurrentSteps = 5) {
    this.maxConcurrentSteps = maxConcurrentSteps;
    this.semaphore = new Semaphore(maxConcurrentSteps);
  }

  // -----------------------------------------------------------------------
  // run() — convenience wrapper
  // -----------------------------------------------------------------------

  async run(
    workflow: Workflow,
    initialInput?: Record<string, unknown>,
    cancellationToken?: CancellationToken
  ): Promise<WorkflowExecution> {
    let finalExecution: WorkflowExecution | undefined;

    for await (const event of this.runStream(
      workflow,
      initialInput,
      cancellationToken
    )) {
      if (event.eventType === WorkflowEventType.WORKFLOW_COMPLETED) {
        finalExecution = event.execution as WorkflowExecution;
      } else if (event.eventType === WorkflowEventType.WORKFLOW_FAILED) {
        const exec = event.execution as WorkflowExecution | undefined;
        if (exec) finalExecution = exec;
        throw new Error(
          (event.error as string) ?? "Unknown workflow error"
        );
      } else if (event.eventType === WorkflowEventType.WORKFLOW_CANCELLED) {
        const exec = event.execution as WorkflowExecution | undefined;
        if (exec) finalExecution = exec;
        throw new Error(
          (event.reason as string) ?? "Workflow cancelled"
        );
      }
    }

    if (!finalExecution) {
      throw new Error("Workflow completed but no final execution received");
    }
    return finalExecution;
  }

  // -----------------------------------------------------------------------
  // runStream() — yields workflow events
  // -----------------------------------------------------------------------

  async *runStream(
    workflow: Workflow,
    initialInput?: Record<string, unknown>,
    cancellationToken?: CancellationToken,
    checkpoint?: WorkflowCheckpoint,
    checkpointConfig?: CheckpointConfig
  ): AsyncGenerator<WorkflowEvent, void, undefined> {
    if (cancellationToken) {
      this.cancellationTokens.set(workflow.id, cancellationToken);
    }

    let execution: WorkflowExecution;

    if (checkpoint) {
      // Resume from checkpoint
      const validation = this.validateCheckpoint(workflow, checkpoint);
      if (!validation.canResume) {
        yield {
          eventType: WorkflowEventType.WORKFLOW_FAILED,
          timestamp: new Date(),
          workflowId: workflow.id,
          error: `Checkpoint validation failed: ${validation.errors}`,
        };
        return;
      }
      execution = checkpoint.execution;

      yield {
        eventType: WorkflowEventType.WORKFLOW_RESUMED,
        timestamp: new Date(),
        workflowId: workflow.id,
        checkpointId: checkpoint.checkpointId,
        completedSteps: checkpoint.completedStepIds,
        pendingSteps: checkpoint.pendingStepIds,
      };
    } else {
      // Fresh start
      yield {
        eventType: WorkflowEventType.WORKFLOW_STARTED,
        timestamp: new Date(),
        workflowId: workflow.id,
        initialInput: initialInput ?? {},
      };

      const validation = workflow.validateWorkflow();
      if (!validation.isValid) {
        yield {
          eventType: WorkflowEventType.WORKFLOW_FAILED,
          timestamp: new Date(),
          workflowId: workflow.id,
          error: `Workflow validation failed: ${validation.errors}`,
        };
        return;
      }

      execution = createWorkflowExecution(workflow.id, {
        status: WorkflowStatus.RUNNING,
        startTime: new Date(),
        state: { ...workflow.initialState, ...(initialInput ?? {}) },
      });
    }

    try {
      yield* this.executeWorkflowStream(
        workflow,
        execution,
        initialInput ?? {},
        checkpointConfig
      );

      // Check if all steps completed
      const allComplete = Object.values(execution.stepExecutions).every(
        (se) => se.status === StepStatus.COMPLETED
      );

      if (allComplete) {
        execution.status = WorkflowStatus.COMPLETED;
        execution.endTime = new Date();
        yield {
          eventType: WorkflowEventType.WORKFLOW_COMPLETED,
          timestamp: new Date(),
          workflowId: workflow.id,
          execution,
        };
      } else {
        execution.status = WorkflowStatus.FAILED;
        execution.endTime = new Date();
        yield {
          eventType: WorkflowEventType.WORKFLOW_FAILED,
          timestamp: new Date(),
          workflowId: workflow.id,
          error: `Workflow ${workflow.id} failed`,
          execution,
        };
      }
    } catch (e) {
      execution.status = WorkflowStatus.FAILED;
      execution.error = (e as Error).message;
      execution.endTime = new Date();
      yield {
        eventType: WorkflowEventType.WORKFLOW_FAILED,
        timestamp: new Date(),
        workflowId: workflow.id,
        error: (e as Error).message,
        execution,
      };
    } finally {
      this.cancellationTokens.delete(workflow.id);
    }
  }

  // -----------------------------------------------------------------------
  // Core execution loop
  // -----------------------------------------------------------------------

  private async *executeWorkflowStream(
    workflow: Workflow,
    execution: WorkflowExecution,
    initialInput: Record<string, unknown>,
    checkpointConfig?: CheckpointConfig
  ): AsyncGenerator<WorkflowEvent, void, undefined> {
    const completedSteps = new Set<string>(
      Object.entries(execution.stepExecutions)
        .filter(([, se]) => se.status === StepStatus.COMPLETED)
        .map(([id]) => id)
    );

    const runningPromises = new Map<string, Promise<{ stepId: string; result?: Record<string, unknown>; error?: Error }>>();
    let stepsSinceCheckpoint = 0;

    while (completedSteps.size < workflow.steps.size) {
      // Check cancellation
      const ct = this.cancellationTokens.get(workflow.id);
      if (ct?.isCancelled()) {
        execution.status = WorkflowStatus.CANCELLED;
        execution.endTime = new Date();
        yield {
          eventType: WorkflowEventType.WORKFLOW_CANCELLED,
          timestamp: new Date(),
          workflowId: workflow.id,
          execution,
          reason: "Cancelled by user",
        };
        return;
      }

      // Get ready steps
      let readySteps = workflow.getReadySteps(execution);
      readySteps = readySteps.filter(
        (s) => !completedSteps.has(s) && !runningPromises.has(s)
      );

      if (!readySteps.length && !runningPromises.size) {
        const remaining = [...workflow.steps.keys()].filter(
          (id) => !completedSteps.has(id)
        );
        if (remaining.length) {
          throw new Error(
            `Workflow stuck: remaining steps ${remaining} cannot be executed`
          );
        }
        break;
      }

      // Start new tasks
      for (const stepId of readySteps) {
        if (runningPromises.size >= this.maxConcurrentSteps) break;

        const step = workflow.steps.get(stepId)!;
        const inputData = this.prepareStepInput(
          stepId,
          workflow,
          execution,
          initialInput
        );

        execution.stepExecutions[stepId] = createStepExecution(stepId, {
          status: StepStatus.RUNNING,
          startTime: new Date(),
          inputData,
        });

        yield {
          eventType: WorkflowEventType.STEP_STARTED,
          timestamp: new Date(),
          workflowId: workflow.id,
          stepId,
          inputData,
        };

        // Run step with semaphore
        const promise = this.runStepWithSemaphore(
          step,
          stepId,
          inputData,
          execution.state,
          workflow.id
        );
        runningPromises.set(stepId, promise);
      }

      // Wait for any running promise to complete
      if (runningPromises.size) {
        const results = await Promise.race(
          [...runningPromises.entries()].map(async ([id, p]) => {
            const result = await p;
            return { id, ...result };
          })
        );

        const { id: doneId } = results;
        runningPromises.delete(doneId);

        const stepExec = execution.stepExecutions[doneId];

        if (results.error) {
          stepExec.status = StepStatus.FAILED;
          stepExec.error = results.error.message;
          stepExec.endTime = new Date();

          const duration = stepExec.startTime
            ? (Date.now() - stepExec.startTime.getTime()) / 1000
            : 0;

          yield {
            eventType: WorkflowEventType.STEP_FAILED,
            timestamp: new Date(),
            workflowId: workflow.id,
            stepId: doneId,
            error: results.error.message,
            durationSeconds: duration,
          };

          throw results.error;
        } else {
          stepExec.status = StepStatus.COMPLETED;
          stepExec.outputData = results.result;
          stepExec.endTime = new Date();

          const duration = stepExec.startTime
            ? (Date.now() - stepExec.startTime.getTime()) / 1000
            : 0;

          execution.state[`${doneId}_output`] = results.result;
          completedSteps.add(doneId);

          yield {
            eventType: WorkflowEventType.STEP_COMPLETED,
            timestamp: new Date(),
            workflowId: workflow.id,
            stepId: doneId,
            outputData: results.result ?? {},
            durationSeconds: duration,
          };

          // Edge activation events
          for (const edge of workflow.edges) {
            if (edge.fromStep === doneId) {
              yield {
                eventType: WorkflowEventType.EDGE_ACTIVATED,
                timestamp: new Date(),
                workflowId: workflow.id,
                fromStep: doneId,
                toStep: edge.toStep,
                data: results.result ?? {},
              };
            }
          }

          // Auto-checkpoint
          stepsSinceCheckpoint++;
          if (
            checkpointConfig?.autoSave &&
            stepsSinceCheckpoint >= checkpointConfig.saveIntervalSteps
          ) {
            const cp = createCheckpointFromExecution(
              execution,
              workflow.id,
              workflow.metadata.version,
              workflow.computeStructureHash(),
              [...workflow.steps.keys()],
              "auto"
            );
            await checkpointConfig.store.save(cp);
            yield {
              eventType: WorkflowEventType.CHECKPOINT_SAVED,
              timestamp: new Date(),
              workflowId: workflow.id,
              checkpointId: cp.checkpointId,
              completedSteps: completedSteps.size,
              totalSteps: workflow.steps.size,
            };

            if (checkpointConfig.autoCleanup) {
              await checkpointConfig.store.cleanupOld(
                workflow.id,
                checkpointConfig.keepLastN
              );
            }
            stepsSinceCheckpoint = 0;
          }
        }
      }

      // Check if we reached an end step
      if (workflow.endStepIds.some((id) => completedSteps.has(id))) {
        break;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Step execution helpers
  // -----------------------------------------------------------------------

  private async runStepWithSemaphore(
    step: BaseStep,
    stepId: string,
    inputData: Record<string, unknown>,
    workflowState: Record<string, unknown>,
    workflowId: string
  ): Promise<{
    stepId: string;
    result?: Record<string, unknown>;
    error?: Error;
  }> {
    await this.semaphore.acquire();
    try {
      const typedContext = WorkflowContext.fromStateRef(workflowState);
      const contextDict = typedContext.toDict();
      contextDict._context_obj = typedContext;

      const result = await step.run(inputData, contextDict);
      return { stepId, result };
    } catch (e) {
      return { stepId, error: e as Error };
    } finally {
      this.semaphore.release();
    }
  }

  private prepareStepInput(
    stepId: string,
    workflow: Workflow,
    execution: WorkflowExecution,
    initialInput: Record<string, unknown>
  ): Record<string, unknown> {
    if (stepId === workflow.startStepId) {
      return { ...initialInput };
    }

    const dependencies = workflow.getStepDependencies(stepId);
    if (!dependencies.length) return { ...initialInput };

    // Find the completed dependency with output
    for (const depId of dependencies) {
      const depExec = execution.stepExecutions[depId];
      if (
        depExec?.outputData &&
        depExec.status === StepStatus.COMPLETED
      ) {
        return { ...depExec.outputData };
      }
    }

    return { ...initialInput };
  }

  // -----------------------------------------------------------------------
  // Standalone step execution
  // -----------------------------------------------------------------------

  async runStep(
    step: BaseStep,
    inputData: Record<string, unknown>,
    context?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return step.run(inputData, context ?? {});
  }

  // -----------------------------------------------------------------------
  // Execution status
  // -----------------------------------------------------------------------

  getExecutionStatus(
    execution: WorkflowExecution
  ): Record<string, unknown> {
    const total = Object.keys(execution.stepExecutions).length;
    const completed = Object.values(execution.stepExecutions).filter(
      (s) => s.status === StepStatus.COMPLETED
    ).length;
    const failed = Object.values(execution.stepExecutions).filter(
      (s) => s.status === StepStatus.FAILED
    ).length;
    const running = Object.values(execution.stepExecutions).filter(
      (s) => s.status === StepStatus.RUNNING
    ).length;

    let duration: number | undefined;
    if (execution.startTime && execution.endTime) {
      duration =
        (execution.endTime.getTime() - execution.startTime.getTime()) / 1000;
    }

    return {
      executionId: execution.id,
      workflowId: execution.workflowId,
      status: execution.status,
      progress: {
        totalSteps: total,
        completedSteps: completed,
        failedSteps: failed,
        runningSteps: running,
        percentage: total > 0 ? (completed / total) * 100 : 0,
      },
      timing: {
        startTime: execution.startTime,
        endTime: execution.endTime,
        durationSeconds: duration,
      },
      error: execution.error,
    };
  }

  // -----------------------------------------------------------------------
  // Checkpoint validation
  // -----------------------------------------------------------------------

  validateCheckpoint(
    workflow: Workflow,
    checkpoint: WorkflowCheckpoint
  ): CheckpointValidationResult {
    const result = createCheckpointValidation();

    if (checkpoint.workflowId !== workflow.id) {
      result.warnings.push(
        `Checkpoint workflow_id '${checkpoint.workflowId}' differs from ` +
          `current workflow '${workflow.id}'.`
      );
    }

    const currentHash = workflow.computeStructureHash();
    if (checkpoint.workflowStructureHash !== currentHash) {
      result.errors.push(
        `Workflow structure has changed since checkpoint was created. Cannot safely resume.`
      );
      result.isValid = false;
      result.canResume = false;
      return result;
    }

    for (const stepId of checkpoint.completedStepIds) {
      if (!workflow.steps.has(stepId)) {
        result.errors.push(
          `Checkpoint references completed step '${stepId}' that no longer exists`
        );
        result.isValid = false;
        result.canResume = false;
      }
    }

    result.checkpointInfo = {
      createdAt: checkpoint.createdAt.toISOString(),
      completedSteps: checkpoint.completedStepIds.length,
      pendingSteps: checkpoint.pendingStepIds.length,
      checkpointType: checkpoint.checkpointType,
    };

    return result;
  }

  // -----------------------------------------------------------------------
  // Cancellation
  // -----------------------------------------------------------------------

  async cancelWorkflow(
    workflowId: string,
    _reason = "Cancelled by user"
  ): Promise<boolean> {
    const ct = this.cancellationTokens.get(workflowId);
    if (ct) {
      ct.cancel();
      return true;
    }
    return false;
  }
}
