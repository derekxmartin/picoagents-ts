/**
 * Base class for all workflow steps.
 *
 * In TypeScript we use Zod schemas for input/output validation
 * rather than Pydantic models. Steps are generic over their
 * input and output shapes.
 */

import { z } from "zod";
import {
  type StepMetadata,
  type WorkflowContext,
  StepStatus,
} from "../core/models.js";

// ---------------------------------------------------------------------------
// BaseStep
// ---------------------------------------------------------------------------

export abstract class BaseStep<
  TInput = Record<string, unknown>,
  TOutput = Record<string, unknown>,
> {
  stepId: string;
  metadata: StepMetadata;
  inputTypeName: string;
  outputTypeName: string;

  private _status: string = StepStatus.PENDING;
  private _startTime?: Date;
  private _endTime?: Date;
  private _error?: string;

  /**
   * @param stepId   Unique identifier for this step
   * @param metadata Step metadata (name, retries, timeout, etc.)
   * @param inputTypeName  Name of the input type (for hashing / display)
   * @param outputTypeName Name of the output type
   */
  constructor(
    stepId: string,
    metadata: StepMetadata,
    inputTypeName = "Record",
    outputTypeName = "Record"
  ) {
    this.stepId = stepId;
    this.metadata = metadata;
    this.inputTypeName = inputTypeName;
    this.outputTypeName = outputTypeName;
  }

  // -----------------------------------------------------------------------
  // Status properties
  // -----------------------------------------------------------------------

  get status(): string {
    return this._status;
  }
  get startTime(): Date | undefined {
    return this._startTime;
  }
  get endTime(): Date | undefined {
    return this._endTime;
  }
  get error(): string | undefined {
    return this._error;
  }
  get duration(): number | undefined {
    if (this._startTime && this._endTime) {
      return (this._endTime.getTime() - this._startTime.getTime()) / 1000;
    }
    return undefined;
  }

  // -----------------------------------------------------------------------
  // Abstract execute
  // -----------------------------------------------------------------------

  abstract execute(
    inputData: TInput,
    context: WorkflowContext
  ): Promise<TOutput>;

  // -----------------------------------------------------------------------
  // run() — wrapper with validation, retries, timeout
  // -----------------------------------------------------------------------

  async run(
    inputData: Record<string, unknown>,
    contextDict: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    this._status = StepStatus.RUNNING;
    this._startTime = new Date();
    this._error = undefined;

    let retryCount = 0;
    const maxRetries = this.metadata.maxRetries;

    while (retryCount <= maxRetries) {
      try {
        // Create typed context
        const { WorkflowContext: WC } = await import("../core/models.js");
        const workflowState =
          (contextDict.workflow_state as Record<string, unknown>) ?? {};
        const typedContext = WC.fromStateRef(workflowState);

        // Re-use progress callback if set
        const contextObj = contextDict._context_obj;
        if (
          contextObj &&
          typeof contextObj === "object" &&
          "progressCallback" in (contextObj as Record<string, unknown>)
        ) {
          // Link progress callback
        }

        // Execute with optional timeout
        let output: TOutput;
        if (this.metadata.timeoutSeconds) {
          output = await withTimeout(
            this.execute(inputData as unknown as TInput, typedContext),
            this.metadata.timeoutSeconds * 1000
          );
        } else {
          output = await this.execute(
            inputData as unknown as TInput,
            typedContext
          );
        }

        this._status = StepStatus.COMPLETED;
        this._endTime = new Date();

        // Return as plain object
        if (typeof output === "object" && output !== null) {
          return output as Record<string, unknown>;
        }
        return { result: output };
      } catch (e) {
        retryCount++;
        const errMsg = `Step ${this.stepId} failed (attempt ${retryCount}/${maxRetries + 1}): ${(e as Error).message}`;

        if (retryCount <= maxRetries) {
          await sleep(1000);
          continue;
        }

        this._error = (e as Error).message;
        this._status = StepStatus.FAILED;
        this._endTime = new Date();
        throw e;
      }
    }

    throw new Error(`Unexpected error in step ${this.stepId}`);
  }

  // -----------------------------------------------------------------------
  // Validation helpers
  // -----------------------------------------------------------------------

  validateInput(data: Record<string, unknown>): boolean {
    // Override in subclass with Zod parsing if desired
    return data !== undefined;
  }

  validateOutput(data: Record<string, unknown>): boolean {
    return data !== undefined;
  }

  getSchema(): Record<string, unknown> {
    return {
      stepId: this.stepId,
      metadata: { ...this.metadata },
      inputTypeName: this.inputTypeName,
      outputTypeName: this.outputTypeName,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Step timed out after ${ms / 1000}s`)),
      ms
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}
