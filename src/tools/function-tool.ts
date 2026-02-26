/**
 * FunctionTool — wraps an async function with a Zod schema as a tool.
 *
 * Unlike Python, TypeScript has no runtime type introspection, so users
 * must provide a Zod schema describing the function's parameters.
 */

import { z } from "zod";
import { BaseTool, type ApprovalMode, ApprovalMode as AM } from "./base.js";
import type { ToolResult } from "../types.js";

/**
 * Options for creating a FunctionTool.
 */
export interface FunctionToolOptions<
  TSchema extends z.ZodObject<z.ZodRawShape>,
> {
  /** The async or sync function to wrap. */
  func: (params: z.infer<TSchema>) => unknown | Promise<unknown>;
  /** Zod schema describing the function's parameters. */
  parametersSchema: TSchema;
  /** Tool name (defaults to func.name). */
  name?: string;
  /** Tool description. */
  description?: string;
  /** Semantic version string. */
  version?: string;
  /** Whether approval is required before execution. */
  approvalMode?: ApprovalMode;
}

export class FunctionTool<
  TSchema extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>,
> extends BaseTool {
  private readonly func: (
    params: z.infer<TSchema>
  ) => unknown | Promise<unknown>;
  private readonly parametersSchema: TSchema;
  private readonly _parametersJsonSchema: Record<string, unknown>;

  constructor(options: FunctionToolOptions<TSchema>) {
    const name = options.name ?? options.func.name ?? "unnamed_function";
    const description =
      options.description ?? `Execute ${name} function`;

    super(name, description, options.version ?? "1.0.0", options.approvalMode ?? AM.NEVER);

    this.func = options.func;
    this.parametersSchema = options.parametersSchema;
    this._parametersJsonSchema = zodToJsonSchema(this.parametersSchema);
  }

  get parameters(): Record<string, unknown> {
    return this._parametersJsonSchema;
  }

  /**
   * Execute the wrapped function with validated parameters.
   */
  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    try {
      // Validate with Zod
      const parseResult = this.parametersSchema.safeParse(parameters);
      if (!parseResult.success) {
        return {
          success: false,
          result: null,
          error: `Invalid parameters: ${parseResult.error.message}`,
          metadata: { tool_name: this.name },
        };
      }

      // Execute function (handles both sync and async)
      const result = await Promise.resolve(this.func(parseResult.data));

      return {
        success: true,
        result,
        error: undefined,
        metadata: { tool_name: this.name },
      };
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      return {
        success: false,
        result: null,
        error: error.message,
        metadata: {
          tool_name: this.name,
          exception_type: error.constructor.name,
        },
      };
    }
  }

  /**
   * Make the tool directly callable.
   */
  async call(
    params: z.infer<TSchema>
  ): Promise<unknown> {
    return Promise.resolve(this.func(params));
  }
}

// ---------------------------------------------------------------------------
// Minimal Zod → JSON Schema converter
// ---------------------------------------------------------------------------

/**
 * Convert a Zod object schema to a JSON Schema compatible dictionary.
 * This is a lightweight converter handling the most common Zod types.
 */
function zodToJsonSchema(
  schema: z.ZodObject<z.ZodRawShape>
): Record<string, unknown> {
  const shape = schema.shape;
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const zodType = value as z.ZodTypeAny;
    properties[key] = zodTypeToJsonSchema(zodType);

    // If the type is not optional/nullable, it's required
    if (!isOptional(zodType)) {
      required.push(key);
    }
  }

  return {
    type: "object",
    properties,
    required,
  };
}

function zodTypeToJsonSchema(
  zodType: z.ZodTypeAny
): Record<string, unknown> {
  // Unwrap optional
  if (zodType instanceof z.ZodOptional) {
    return zodTypeToJsonSchema(zodType.unwrap());
  }

  // Unwrap default
  if (zodType instanceof z.ZodDefault) {
    const inner = zodTypeToJsonSchema(
      (zodType as z.ZodDefault<z.ZodTypeAny>)._def.innerType
    );
    inner.default = zodType._def.defaultValue();
    return inner;
  }

  // String
  if (zodType instanceof z.ZodString) {
    const schema: Record<string, unknown> = { type: "string" };
    if (zodType.description) schema.description = zodType.description;
    return schema;
  }

  // Number
  if (zodType instanceof z.ZodNumber) {
    const schema: Record<string, unknown> = { type: "number" };
    if (zodType.description) schema.description = zodType.description;
    // Check for integer constraint
    const checks = (zodType as unknown as { _def: { checks: Array<{ kind: string }> } })._def.checks;
    if (checks?.some((c) => c.kind === "int")) {
      schema.type = "integer";
    }
    return schema;
  }

  // Boolean
  if (zodType instanceof z.ZodBoolean) {
    return { type: "boolean" };
  }

  // Array
  if (zodType instanceof z.ZodArray) {
    return {
      type: "array",
      items: zodTypeToJsonSchema(zodType.element),
    };
  }

  // Enum
  if (zodType instanceof z.ZodEnum) {
    return {
      type: "string",
      enum: zodType.options,
    };
  }

  // Literal
  if (zodType instanceof z.ZodLiteral) {
    const val = zodType.value;
    return {
      type: typeof val === "number" ? "number" : typeof val === "boolean" ? "boolean" : "string",
      enum: [val],
    };
  }

  // Object (nested)
  if (zodType instanceof z.ZodObject) {
    return zodToJsonSchema(zodType);
  }

  // Record
  if (zodType instanceof z.ZodRecord) {
    return { type: "object" };
  }

  // Union
  if (zodType instanceof z.ZodUnion) {
    const options = (zodType as z.ZodUnion<[z.ZodTypeAny, ...z.ZodTypeAny[]]>).options;
    return {
      oneOf: options.map((opt: z.ZodTypeAny) => zodTypeToJsonSchema(opt)),
    };
  }

  // Fallback
  return { type: "string" };
}

function isOptional(zodType: z.ZodTypeAny): boolean {
  if (zodType instanceof z.ZodOptional) return true;
  if (zodType instanceof z.ZodDefault) return true;
  if (zodType instanceof z.ZodNullable) return true;
  return false;
}
