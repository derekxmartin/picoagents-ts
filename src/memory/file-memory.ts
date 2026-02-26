/**
 * File-based persistent memory storage.
 *
 * Stores memories in a JSON file for persistence between sessions.
 * Provides basic text search capabilities.
 */

import * as fs from "fs";
import * as path from "path";
import type { MemoryContent, MemoryQueryResult } from "./base.js";
import { BaseMemory } from "./base.js";

export class FileMemory extends BaseMemory {
  static override componentType = "memory" as const;
  static override componentVersion = 1;
  static componentProviderOverride = "picoagents/memory/FileMemory";

  filePath: string;
  memories: MemoryContent[] = [];

  constructor(filePath: string, maxMemories = 1000) {
    super(maxMemories);
    this.filePath = filePath;
    this.loadMemories();
  }

  // -------------------------------------------------------------------------
  // Persistence helpers
  // -------------------------------------------------------------------------

  private loadMemories(): void {
    if (!fs.existsSync(this.filePath)) return;

    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const data = JSON.parse(raw) as Record<string, unknown>[];
      this.memories = data.map((m) => ({
        content: m.content as string | Record<string, unknown>,
        mimeType: (m.mimeType as string) ?? "text/plain",
        metadata: (m.metadata as Record<string, unknown>) ?? {},
        timestamp: m.timestamp ? new Date(m.timestamp as string) : new Date(),
      }));
    } catch {
      // If file is corrupted, start fresh
      this.memories = [];
    }
  }

  private saveMemories(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (dir && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = this.memories.map((m) => ({
        content: m.content,
        mimeType: m.mimeType,
        metadata: m.metadata,
        timestamp: m.timestamp.toISOString(),
      }));

      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch {
      // Silently handle save errors to avoid breaking agent execution
    }
  }

  // -------------------------------------------------------------------------
  // BaseMemory implementation
  // -------------------------------------------------------------------------

  async add(content: MemoryContent): Promise<void> {
    this.memories.push(content);

    if (this.memories.length > this.maxMemories) {
      this.memories = this.memories.slice(-this.maxMemories);
    }

    this.saveMemories();
  }

  async query(query: string, limit = 10): Promise<MemoryQueryResult> {
    const queryLower = query.toLowerCase();
    const matching: MemoryContent[] = [];

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
    try {
      if (fs.existsSync(this.filePath)) {
        fs.unlinkSync(this.filePath);
      }
    } catch {
      // silently handle
    }
  }

  override async getStats(): Promise<Record<string, unknown>> {
    const base = await super.getStats();
    return {
      ...base,
      currentMemories: this.memories.length,
      filePath: this.filePath,
      isPersistent: true,
    };
  }

  override toConfig(): Record<string, unknown> {
    return {
      filePath: this.filePath,
      maxMemories: this.maxMemories,
    };
  }

  static fromConfig(config: Record<string, unknown>): FileMemory {
    return new FileMemory(
      config.filePath as string,
      (config.maxMemories as number) ?? 1000
    );
  }
}
