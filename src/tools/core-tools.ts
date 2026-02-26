/**
 * Core tools that are universally useful across all agent domains.
 *
 * These tools provide basic utilities like math, datetime, JSON parsing, etc.
 * No external dependencies or LLM calls — pure deterministic operations.
 */

import { BaseTool } from "./base.js";
import type { ToolResult } from "../types.js";

// ---------------------------------------------------------------------------
// ThinkTool
// ---------------------------------------------------------------------------

export class ThinkTool extends BaseTool {
  constructor() {
    super(
      "think",
      "Use this tool when you need to pause and think carefully about a complex problem, " +
        "analyze tool results, plan your next steps, or reason through a difficult decision. " +
        "This is especially useful when: " +
        "(1) you've received complex information from tool calls that needs analysis, " +
        "(2) you need to plan a multi-step approach, " +
        "(3) the task involves policy-heavy or safety-critical decisions, " +
        "(4) you want to avoid costly mistakes by thinking through options first. " +
        "Provide your reasoning in the 'thought' parameter."
    );
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        thought: {
          type: "string",
          description:
            "Your detailed reasoning about the current situation. " +
            "Include: what you've learned so far, what options you're considering, " +
            "potential risks or edge cases, and your planned approach.",
        },
      },
      required: ["thought"],
    };
  }

  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const thought = parameters.thought as string;
    const preview =
      thought.length > 100
        ? `Reasoning recorded: ${thought.slice(0, 100)}...`
        : `Reasoning recorded: ${thought}`;

    return {
      success: true,
      result: preview,
      metadata: { thought_length: thought.length, tool_name: "think" },
    };
  }
}

// ---------------------------------------------------------------------------
// CalculatorTool
// ---------------------------------------------------------------------------

export class CalculatorTool extends BaseTool {
  constructor() {
    super(
      "calculator",
      "Evaluate mathematical expressions and perform calculations. " +
        "Use this when you need to compute numeric results, perform arithmetic operations, " +
        "or evaluate mathematical functions. " +
        "Supports: basic operations (+, -, *, /, **), math functions (sin, cos, tan, sqrt, log, exp), " +
        "and constants (pi, e). " +
        "Returns the numerical result of the expression. " +
        "Example: 'sqrt(16) + 2 * pi' returns approximately 10.28."
    );
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description:
            "Mathematical expression to evaluate (e.g., '2 + 2', 'sqrt(16)', 'pi * 2')",
        },
      },
      required: ["expression"],
    };
  }

  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const expression = parameters.expression as string;

    try {
      // Create a safe math context
      const mathFns: Record<string, unknown> = {
        abs: Math.abs,
        round: Math.round,
        min: Math.min,
        max: Math.max,
        pow: Math.pow,
        sqrt: Math.sqrt,
        sin: Math.sin,
        cos: Math.cos,
        tan: Math.tan,
        log: Math.log,
        log10: Math.log10,
        exp: Math.exp,
        ceil: Math.ceil,
        floor: Math.floor,
        pi: Math.PI,
        e: Math.E,
        PI: Math.PI,
        E: Math.E,
      };

      // Replace function names and evaluate using Function constructor
      // with only math functions in scope
      const fnBody = `"use strict"; const {${Object.keys(mathFns).join(",")}} = this; return (${expression});`;
      const fn = new Function(fnBody);
      const result = fn.call(mathFns);

      return {
        success: true,
        result: String(result),
        metadata: { expression, result },
      };
    } catch (e) {
      return {
        success: false,
        result: null,
        error: `Failed to evaluate expression: ${e instanceof Error ? e.message : String(e)}`,
        metadata: { expression },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// DateTimeTool
// ---------------------------------------------------------------------------

export class DateTimeTool extends BaseTool {
  constructor() {
    super(
      "datetime",
      "Work with dates and times - get current time, parse datetime strings, or format timestamps. " +
        "Use this when you need: (1) the current date/time in UTC, " +
        "(2) to parse an ISO datetime string into a standard format, " +
        "(3) to format a datetime using a specific pattern. " +
        "All operations use ISO 8601 format by default."
    );
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["now", "parse", "format"],
          description:
            "Operation to perform: 'now' (current time), 'parse' (string to datetime), 'format' (datetime to string)",
        },
        value: {
          type: "string",
          description:
            "ISO format datetime string (for parse/format operations)",
        },
        format: {
          type: "string",
          description:
            "Output format string (for format operation). Supports: YYYY, MM, DD, HH, mm, ss",
        },
      },
      required: ["operation"],
    };
  }

  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const operation = parameters.operation as string;

    try {
      let result: string;

      if (operation === "now") {
        result = new Date().toISOString();
      } else if (operation === "parse") {
        const value = parameters.value as string | undefined;
        if (!value)
          throw new Error("'value' parameter required for parse operation");
        const dt = new Date(value);
        if (isNaN(dt.getTime()))
          throw new Error(`Cannot parse datetime: ${value}`);
        result = dt.toISOString();
      } else if (operation === "format") {
        const value = parameters.value as string | undefined;
        const fmt = (parameters.format as string) ?? "YYYY-MM-DD HH:mm:ss";
        if (!value)
          throw new Error("'value' parameter required for format operation");
        const dt = new Date(value);
        if (isNaN(dt.getTime()))
          throw new Error(`Cannot parse datetime: ${value}`);
        result = formatDate(dt, fmt);
      } else {
        throw new Error(`Unknown operation: ${operation}`);
      }

      return {
        success: true,
        result,
        metadata: { operation },
      };
    } catch (e) {
      return {
        success: false,
        result: null,
        error: `DateTime operation failed: ${e instanceof Error ? e.message : String(e)}`,
        metadata: { operation },
      };
    }
  }
}

function formatDate(date: Date, format: string): string {
  return format
    .replace("YYYY", String(date.getUTCFullYear()))
    .replace("MM", String(date.getUTCMonth() + 1).padStart(2, "0"))
    .replace("DD", String(date.getUTCDate()).padStart(2, "0"))
    .replace("HH", String(date.getUTCHours()).padStart(2, "0"))
    .replace("mm", String(date.getUTCMinutes()).padStart(2, "0"))
    .replace("ss", String(date.getUTCSeconds()).padStart(2, "0"));
}

// ---------------------------------------------------------------------------
// JSONParserTool
// ---------------------------------------------------------------------------

export class JSONParserTool extends BaseTool {
  constructor() {
    super(
      "json_parser",
      "Parse JSON strings, validate JSON structure, or extract values from JSON."
    );
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        json_string: {
          type: "string",
          description: "JSON string to parse",
        },
        path: {
          type: "string",
          description:
            "Optional JSON path to extract (dot notation, e.g., 'user.name')",
        },
      },
      required: ["json_string"],
    };
  }

  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const jsonString = parameters.json_string as string;
    const path = parameters.path as string | undefined;

    try {
      let parsed: unknown = JSON.parse(jsonString);

      if (path) {
        for (const key of path.split(".")) {
          if (
            typeof parsed === "object" &&
            parsed !== null &&
            !Array.isArray(parsed)
          ) {
            parsed = (parsed as Record<string, unknown>)[key];
          } else if (Array.isArray(parsed) && /^\d+$/.test(key)) {
            parsed = parsed[parseInt(key, 10)];
          } else {
            throw new Error(`Path '${path}' not found in JSON`);
          }
        }
      }

      return {
        success: true,
        result: parsed,
        metadata: { path },
      };
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      const isJsonError = error instanceof SyntaxError;
      return {
        success: false,
        result: null,
        error: isJsonError
          ? `Invalid JSON: ${error.message}`
          : `JSON parsing failed: ${error.message}`,
        metadata: {},
      };
    }
  }
}

// ---------------------------------------------------------------------------
// RegexTool
// ---------------------------------------------------------------------------

export class RegexTool extends BaseTool {
  constructor() {
    super(
      "regex",
      "Find patterns in text using regular expressions. Supports search, match, findall, and replace operations."
    );
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["search", "match", "findall", "replace"],
          description:
            "Regex operation: 'search' (find first), 'match' (match from start), 'findall' (all matches), 'replace' (substitute)",
        },
        pattern: {
          type: "string",
          description: "Regular expression pattern",
        },
        text: { type: "string", description: "Text to search" },
        replacement: {
          type: "string",
          description: "Replacement text (for replace operation)",
        },
        flags: {
          type: "string",
          description:
            "Regex flags: 'i' (ignore case), 'm' (multiline), 's' (dotall). Can combine: 'im'",
        },
      },
      required: ["operation", "pattern", "text"],
    };
  }

  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const operation = parameters.operation as string;
    const pattern = parameters.pattern as string;
    const text = parameters.text as string;
    const replacement = (parameters.replacement as string) ?? "";
    const flagsStr = (parameters.flags as string) ?? "";

    try {
      // Build JS flags
      let jsFlags = "";
      if (flagsStr.includes("i")) jsFlags += "i";
      if (flagsStr.includes("m")) jsFlags += "m";
      if (flagsStr.includes("s")) jsFlags += "s";

      let result: unknown;

      if (operation === "search") {
        const re = new RegExp(pattern, jsFlags);
        const match = re.exec(text);
        result = match ? match[0] : null;
      } else if (operation === "match") {
        // match from start — anchor the pattern
        const re = new RegExp(`^(?:${pattern})`, jsFlags);
        const match = re.exec(text);
        result = match ? match[0] : null;
      } else if (operation === "findall") {
        const re = new RegExp(pattern, jsFlags + "g");
        result = [...text.matchAll(re)].map((m) => m[0]);
      } else if (operation === "replace") {
        const re = new RegExp(pattern, jsFlags + "g");
        result = text.replace(re, replacement);
      } else {
        throw new Error(`Unknown operation: ${operation}`);
      }

      return {
        success: true,
        result,
        metadata: { operation, pattern },
      };
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      const isSyntaxError = error instanceof SyntaxError;
      return {
        success: false,
        result: null,
        error: isSyntaxError
          ? `Invalid regex pattern: ${error.message}`
          : `Regex operation failed: ${error.message}`,
        metadata: { operation, pattern },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// TaskStatusTool
// ---------------------------------------------------------------------------

export class TaskStatusTool extends BaseTool {
  constructor() {
    super(
      "task_status",
      "Evaluate current task status with explicit rationale. " +
        "Use this to formally assess whether a task is complete or incomplete. " +
        "IMPORTANT: Call this before finishing a task. " +
        "Provide: (1) status ('complete' or 'incomplete'), " +
        "(2) detailed rationale explaining your assessment, " +
        "(3) optional: list of requirements met/pending."
    );
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["complete", "incomplete"],
          description:
            "'complete' if all task requirements are satisfied. " +
            "'incomplete' if stopping due to blockers, limits, or need for input.",
        },
        rationale: {
          type: "string",
          description:
            "Detailed explanation of your assessment. " +
            "If COMPLETE: List each requirement and evidence it's satisfied. " +
            "If INCOMPLETE: Explain the blocker, what was attempted, " +
            "and why stopping now.",
        },
        requirements_met: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional: List of requirements that have been satisfied.",
        },
        requirements_pending: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional: List of requirements not yet satisfied (if incomplete).",
        },
      },
      required: ["status", "rationale"],
    };
  }

  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const status = parameters.status as string;
    const rationale = parameters.rationale as string;
    const requirementsMet = (parameters.requirements_met as string[]) ?? [];
    const requirementsPending =
      (parameters.requirements_pending as string[]) ?? [];

    const lines: string[] = [
      `Task Status: ${status.toUpperCase()}`,
      "",
      "Rationale:",
      rationale,
    ];

    if (requirementsMet.length > 0) {
      lines.push("", "Requirements Met:");
      for (const req of requirementsMet) {
        lines.push(`  * ${req}`);
      }
    }

    if (requirementsPending.length > 0) {
      lines.push("", "Requirements Pending:");
      for (const req of requirementsPending) {
        lines.push(`  - ${req}`);
      }
    }

    return {
      success: true,
      result: lines.join("\n"),
      metadata: {
        status,
        rationale,
        requirements_met: requirementsMet,
        requirements_pending: requirementsPending,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a list of core utility tools.
 */
export function createCoreTools(): BaseTool[] {
  return [
    new ThinkTool(),
    new TaskStatusTool(),
    new CalculatorTool(),
    new DateTimeTool(),
    new JSONParserTool(),
    new RegexTool(),
  ];
}
