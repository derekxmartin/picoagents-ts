/**
 * Simple echo step for demonstration and testing.
 */

import { type StepMetadata, type WorkflowContext } from "../core/models.js";
import { BaseStep } from "./base-step.js";

export class EchoStep extends BaseStep<
  Record<string, unknown>,
  Record<string, unknown>
> {
  prefix: string;
  suffix: string;
  delaySeconds: number;

  constructor(
    stepId: string,
    metadata: StepMetadata,
    options?: {
      prefix?: string;
      suffix?: string;
      delaySeconds?: number;
      inputTypeName?: string;
      outputTypeName?: string;
    }
  ) {
    super(
      stepId,
      metadata,
      options?.inputTypeName ?? "EchoInput",
      options?.outputTypeName ?? "EchoOutput"
    );
    this.prefix = options?.prefix ?? "Echo: ";
    this.suffix = options?.suffix ?? "";
    this.delaySeconds = options?.delaySeconds ?? 0;
  }

  async execute(
    inputData: Record<string, unknown>,
    context: WorkflowContext
  ): Promise<Record<string, unknown>> {
    if (this.delaySeconds > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.delaySeconds * 1000)
      );
    }

    // Try common field names
    let message: unknown;
    for (const field of ["message", "result", "text", "content", "data"]) {
      if (field in inputData) {
        message = inputData[field];
        break;
      }
    }

    // Fallback to first field or string representation
    if (message === undefined) {
      const keys = Object.keys(inputData);
      message = keys.length > 0 ? inputData[keys[0]] : JSON.stringify(inputData);
    }

    const result = `${this.prefix}${message}${this.suffix}`;

    context.set(`${this.stepId}_echo_info`, {
      original: message,
      prefix: this.prefix,
      suffix: this.suffix,
      result,
    });

    return { message: result };
  }
}
