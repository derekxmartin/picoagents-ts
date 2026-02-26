/**
 * Abstract memory implementations for agent state persistence.
 *
 * Defines the memory interfaces and implementations that allow
 * agents to maintain context and learn from past interactions.
 */

import { z } from "zod";
import { ComponentBase } from "../component-config.js";

// ---------------------------------------------------------------------------
// MemoryContent
// ---------------------------------------------------------------------------

export const MemoryContentSchema = z.object({
  content: z
    .union([z.string(), z.record(z.string(), z.unknown())])
    .describe("The memory content"),
  mimeType: z
    .string()
    .default("text/plain")
    .describe("MIME type of the content"),
  metadata: z
    .record(z.string(), z.unknown())
    .default({})
    .describe("Additional memory metadata"),
  timestamp: z
    .date()
    .default(() => new Date())
    .describe("When memory was stored"),
});

export type MemoryContent = z.infer<typeof MemoryContentSchema>;

// ---------------------------------------------------------------------------
// MemoryQueryResult
// ---------------------------------------------------------------------------

export const MemoryQueryResultSchema = z.object({
  results: z
    .array(MemoryContentSchema)
    .default([])
    .describe("List of retrieved memory contents"),
});

export type MemoryQueryResult = z.infer<typeof MemoryQueryResultSchema>;

// ---------------------------------------------------------------------------
// BaseMemory
// ---------------------------------------------------------------------------

/**
 * Abstract base class for agent memory implementations.
 *
 * Provides persistent storage and retrieval for agent context,
 * enabling agents to maintain continuity across conversations.
 */
export abstract class BaseMemory extends ComponentBase {
  static componentType = "memory" as const;

  maxMemories: number;

  constructor(maxMemories = 1000) {
    super();
    this.maxMemories = maxMemories;
  }

  /** Store new content in memory. */
  abstract add(content: MemoryContent): Promise<void>;

  /** Retrieve relevant memories based on query text. */
  abstract query(query: string, limit?: number): Promise<MemoryQueryResult>;

  /** Get recent/relevant context for LLM prompt. */
  abstract getContext(maxItems?: number): Promise<MemoryQueryResult>;

  /** Remove all stored memories. */
  abstract clear(): Promise<void>;

  /** Get memory statistics. */
  async getStats(): Promise<Record<string, unknown>> {
    return {
      maxMemories: this.maxMemories,
      implementation: this.constructor.name,
    };
  }

  toConfig(): Record<string, unknown> {
    return { maxMemories: this.maxMemories };
  }
}
