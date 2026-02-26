/**
 * Simple in-memory list storage for development and testing.
 *
 * Stores memories in an array with basic text search capabilities.
 * Does not persist between sessions.
 */

import type { MemoryContent, MemoryQueryResult } from "./base.js";
import { BaseMemory } from "./base.js";

export class ListMemory extends BaseMemory {
  static override componentType = "memory" as const;
  static override componentVersion = 1;
  static componentProviderOverride = "picoagents/memory/ListMemory";

  memories: MemoryContent[] = [];

  constructor(maxMemories = 1000) {
    super(maxMemories);
  }

  async add(content: MemoryContent): Promise<void> {
    this.memories.push(content);

    // Trim oldest if exceeding capacity
    if (this.memories.length > this.maxMemories) {
      this.memories = this.memories.slice(-this.maxMemories);
    }
  }

  async query(query: string, limit = 10): Promise<MemoryQueryResult> {
    const queryLower = query.toLowerCase();
    const matching: MemoryContent[] = [];

    // Search most recent first
    for (let i = this.memories.length - 1; i >= 0; i--) {
      const memory = this.memories[i];
      const contentStr =
        typeof memory.content === "string"
          ? memory.content
          : JSON.stringify(memory.content);

      if (contentStr.toLowerCase().includes(queryLower)) {
        matching.push(memory);
        if (matching.length >= limit) break;
      }
    }

    return { results: matching };
  }

  async getContext(maxItems = 10): Promise<MemoryQueryResult> {
    const recent = this.memories.slice(-maxItems);
    return { results: recent };
  }

  async clear(): Promise<void> {
    this.memories = [];
  }

  override async getStats(): Promise<Record<string, unknown>> {
    const base = await super.getStats();
    return {
      ...base,
      currentMemories: this.memories.length,
      isPersistent: false,
    };
  }

  override toConfig(): Record<string, unknown> {
    return {
      maxMemories: this.maxMemories,
      memories: this.memories.map((m) => ({
        content: m.content,
        mimeType: m.mimeType,
        metadata: m.metadata,
        timestamp: m.timestamp.toISOString(),
      })),
    };
  }

  static fromConfig(config: Record<string, unknown>): ListMemory {
    const instance = new ListMemory(
      (config.maxMemories as number) ?? 1000
    );
    if (Array.isArray(config.memories)) {
      instance.memories = config.memories.map(
        (m: Record<string, unknown>) => ({
          content: m.content as string | Record<string, unknown>,
          mimeType: (m.mimeType as string) ?? "text/plain",
          metadata: (m.metadata as Record<string, unknown>) ?? {},
          timestamp: m.timestamp ? new Date(m.timestamp as string) : new Date(),
        })
      );
    }
    return instance;
  }
}
