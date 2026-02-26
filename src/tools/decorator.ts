/**
 * createTool — factory function for creating tools from functions.
 *
 * TypeScript equivalent of Python's @tool decorator.
 * Since TS doesn't have decorator support for this pattern,
 * we use a factory function instead.
 */

import { z } from "zod";
import { FunctionTool } from "./function-tool.js";
import { ApprovalMode } from "./base.js";

/**
 * Create a tool from a function and a Zod schema.
 *
 * @example
 * ```ts
 * const getWeather = createTool({
 *   name: "get_weather",
 *   description: "Get weather for a city",
 *   parametersSchema: z.object({
 *     city: z.string().describe("City name"),
 *   }),
 *   execute: async ({ city }) => `Weather in ${city}: Sunny`,
 * });
 * ```
 *
 * @example With approval required:
 * ```ts
 * const deleteFile = createTool({
 *   name: "delete_file",
 *   description: "Delete a file from the filesystem",
 *   approvalMode: "always_require",
 *   parametersSchema: z.object({
 *     path: z.string().describe("File path to delete"),
 *   }),
 *   execute: async ({ path }) => { ... },
 * });
 * ```
 */
export function createTool<TSchema extends z.ZodObject<z.ZodRawShape>>(options: {
  name: string;
  description: string;
  parametersSchema: TSchema;
  execute: (params: z.infer<TSchema>) => unknown | Promise<unknown>;
  version?: string;
  approvalMode?: ApprovalMode | "always_require" | "never_require";
}): FunctionTool<TSchema> {
  // Convert string to ApprovalMode if needed
  let mode: ApprovalMode;
  if (typeof options.approvalMode === "string") {
    mode =
      options.approvalMode === "always_require"
        ? ApprovalMode.ALWAYS
        : ApprovalMode.NEVER;
  } else {
    mode = options.approvalMode ?? ApprovalMode.NEVER;
  }

  return new FunctionTool({
    func: options.execute,
    parametersSchema: options.parametersSchema,
    name: options.name,
    description: options.description,
    version: options.version,
    approvalMode: mode,
  });
}
