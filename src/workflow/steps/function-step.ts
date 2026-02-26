/**
 * Step that wraps a user-provided function.
 */

import { type StepMetadata, type WorkflowContext } from "../core/models.js";
import { BaseStep } from "./base-step.js";

export type StepFunction<TInput = Record<string, unknown>, TOutput = Record<string, unknown>> =
  | ((input: TInput, context: WorkflowContext) => TOutput)
  | ((input: TInput, context: WorkflowContext) => Promise<TOutput>);

export class FunctionStep<
  TInput = Record<string, unknown>,
  TOutput = Record<string, unknown>,
> extends BaseStep<TInput, TOutput> {
  private func: StepFunction<TInput, TOutput>;

  constructor(
    stepId: string,
    metadata: StepMetadata,
    func: StepFunction<TInput, TOutput>,
    inputTypeName = "FunctionInput",
    outputTypeName = "FunctionOutput"
  ) {
    super(stepId, metadata, inputTypeName, outputTypeName);
    this.func = func;
  }

  async execute(inputData: TInput, context: WorkflowContext): Promise<TOutput> {
    const result = this.func(inputData, context);
    if (result instanceof Promise) {
      return result;
    }
    return result;
  }
}
