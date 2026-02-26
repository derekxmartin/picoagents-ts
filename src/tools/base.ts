/**
 * Base tool classes and interfaces for the picoagents framework.
 *
 * Defines the abstract base class and core functionality for tools
 * that agents can use to interact with the world.
 */

import type { z } from "zod";
import type { ToolResult } from "../types.js";
import type { Message } from "../messages.js";
import type { AgentEvent } from "../types.js";
import type { CancellationToken } from "../cancellation-token.js";

// ---------------------------------------------------------------------------
// ApprovalMode
// ---------------------------------------------------------------------------

export const ApprovalMode = {
  NEVER: "never_require",
  ALWAYS: "always_require",
} as const;

export type ApprovalMode = (typeof ApprovalMode)[keyof typeof ApprovalMode];

// ---------------------------------------------------------------------------
// BaseTool — abstract base class
// ---------------------------------------------------------------------------

export abstract class BaseTool {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly approvalMode: ApprovalMode;

  constructor(
    name: string,
    description: string,
    version = "1.0.0",
    approvalMode: ApprovalMode = ApprovalMode.NEVER
  ) {
    this.name = name;
    this.description = description;
    this.version = version;
    this.approvalMode = approvalMode;
  }

  /**
   * JSON Schema defining expected inputs for this tool.
   */
  abstract get parameters(): Record<string, unknown>;

  /**
   * Execute the tool with the given parameters.
   */
  abstract execute(
    parameters: Record<string, unknown>
  ): Promise<ToolResult>;

  /**
   * Execute the tool with streaming output support.
   * Default implementation wraps execute() for backward compatibility.
   */
  async *executeStream(
    parameters: Record<string, unknown>,
    _cancellationToken?: CancellationToken
  ): AsyncGenerator<Message | AgentEvent | ToolResult> {
    const result = await this.execute(parameters);
    yield result;
  }

  /**
   * Check if this tool supports streaming execution.
   */
  supportsStreaming(): boolean {
    return Object.getPrototypeOf(this).executeStream !== BaseTool.prototype.executeStream;
  }

  /**
   * Validate that the provided parameters match the tool's schema.
   */
  validateParameters(params: Record<string, unknown>): boolean {
    try {
      const schema = this.parameters as {
        required?: string[];
        properties?: Record<string, { type?: string }>;
      };
      const requiredFields = schema.required ?? [];

      // Check required fields are present
      for (const field of requiredFields) {
        if (!(field in params)) {
          return false;
        }
      }

      // Check parameter types if specified in schema
      const properties = schema.properties ?? {};
      for (const [paramName, paramValue] of Object.entries(params)) {
        if (paramName in properties) {
          const expectedType = properties[paramName].type;
          if (expectedType && !checkType(paramValue, expectedType)) {
            return false;
          }
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Convert tool to OpenAI function calling format.
   */
  toLlmFormat(): Record<string, unknown> {
    const versionedName =
      this.version !== "1.0.0"
        ? `${this.name}_v${this.version}`
        : this.name;

    return {
      type: "function",
      function: {
        name: versionedName,
        description: this.description,
        parameters: this.parameters,
      },
    };
  }

  toString(): string {
    return `${this.constructor.name}(name='${this.name}')`;
  }
}

// ---------------------------------------------------------------------------
// Type checking helper
// ---------------------------------------------------------------------------

function checkType(value: unknown, expectedType: string): boolean {
  const typeChecks: Record<string, (v: unknown) => boolean> = {
    string: (v) => typeof v === "string",
    integer: (v) => typeof v === "number" && Number.isInteger(v),
    number: (v) => typeof v === "number",
    boolean: (v) => typeof v === "boolean",
    array: (v) => Array.isArray(v),
    object: (v) =>
      typeof v === "object" && v !== null && !Array.isArray(v),
  };

  const check = typeChecks[expectedType];
  if (!check) return true; // Unknown type, assume valid
  return check(value);
}
