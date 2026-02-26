/**
 * Generic data transformation step with config-based field mappings.
 */

import { type StepMetadata, type WorkflowContext } from "../core/models.js";
import { coerceValueToSchemaType } from "../schema-utils.js";
import { BaseStep } from "./base-step.js";

export class TransformStep extends BaseStep<
  Record<string, unknown>,
  Record<string, unknown>
> {
  mappings: Record<string, unknown>;
  private outputSchema?: Record<string, unknown>;

  constructor(
    stepId: string,
    metadata: StepMetadata,
    mappings: Record<string, unknown>,
    options?: {
      inputTypeName?: string;
      outputTypeName?: string;
      outputSchema?: Record<string, unknown>;
    }
  ) {
    super(
      stepId,
      metadata,
      options?.inputTypeName ?? "TransformInput",
      options?.outputTypeName ?? "TransformOutput"
    );
    this.mappings = mappings;
    this.outputSchema = options?.outputSchema;
  }

  async execute(
    inputData: Record<string, unknown>,
    context: WorkflowContext
  ): Promise<Record<string, unknown>> {
    const output: Record<string, unknown> = {};

    for (const [outField, inField] of Object.entries(this.mappings)) {
      let rawValue: unknown;

      if (typeof inField === "string") {
        if (inField.startsWith("static:")) {
          rawValue = inField.slice("static:".length);
        } else {
          rawValue = inputData[inField];
        }
      } else if (typeof inField === "object" && inField !== null && !Array.isArray(inField)) {
        // Dict mappings with nested field resolution
        const resolved: Record<string, unknown> = {};
        for (const [dictKey, dictField] of Object.entries(
          inField as Record<string, unknown>
        )) {
          if (typeof dictField === "string") {
            if (dictField.startsWith("static:")) {
              resolved[dictKey] = dictField.slice("static:".length);
            } else {
              resolved[dictKey] = inputData[dictField];
            }
          } else {
            resolved[dictKey] = dictField;
          }
        }
        rawValue = resolved;
      } else {
        rawValue = inField;
      }

      // Apply type coercion if output schema is available
      if (this.outputSchema) {
        rawValue = coerceValueToSchemaType(rawValue, outField, this.outputSchema);
      }

      output[outField] = rawValue;
    }

    return output;
  }
}
