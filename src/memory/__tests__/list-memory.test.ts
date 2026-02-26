import { describe, it, expect, beforeEach } from "vitest";
import { ListMemory } from "../list-memory.js";
import type { MemoryContent } from "../base.js";

function makeContent(text: string): MemoryContent {
  return {
    content: text,
    mimeType: "text/plain",
    metadata: {},
    timestamp: new Date(),
  };
}

describe("ListMemory", () => {
  let memory: ListMemory;

  beforeEach(() => {
    memory = new ListMemory(100);
  });

  it("should add and retrieve memories", async () => {
    await memory.add(makeContent("Hello world"));
    await memory.add(makeContent("Goodbye world"));

    const ctx = await memory.getContext(10);
    expect(ctx.results).toHaveLength(2);
  });

  it("should query memories with text search", async () => {
    await memory.add(makeContent("The weather is sunny"));
    await memory.add(makeContent("I like programming"));
    await memory.add(makeContent("Sunny days are nice"));

    const result = await memory.query("sunny");
    expect(result.results).toHaveLength(2);
  });

  it("should search case-insensitively", async () => {
    await memory.add(makeContent("TypeScript is great"));

    const result = await memory.query("typescript");
    expect(result.results).toHaveLength(1);
  });

  it("should return most recent matches first", async () => {
    await memory.add(makeContent("first message about cats"));
    await memory.add(makeContent("second message about dogs"));
    await memory.add(makeContent("third message about cats"));

    const result = await memory.query("cats");
    expect(result.results).toHaveLength(2);
    expect(result.results[0].content).toBe("third message about cats");
  });

  it("should limit query results", async () => {
    for (let i = 0; i < 20; i++) {
      await memory.add(makeContent(`memory item ${i}`));
    }

    const result = await memory.query("memory", 5);
    expect(result.results).toHaveLength(5);
  });

  it("should get recent context", async () => {
    for (let i = 0; i < 20; i++) {
      await memory.add(makeContent(`item ${i}`));
    }

    const ctx = await memory.getContext(5);
    expect(ctx.results).toHaveLength(5);
    expect(ctx.results[4].content).toBe("item 19");
  });

  it("should trim oldest when exceeding capacity", async () => {
    const small = new ListMemory(3);
    await small.add(makeContent("one"));
    await small.add(makeContent("two"));
    await small.add(makeContent("three"));
    await small.add(makeContent("four"));

    expect(small.memories).toHaveLength(3);
    expect(small.memories[0].content).toBe("two");
  });

  it("should clear all memories", async () => {
    await memory.add(makeContent("hello"));
    await memory.add(makeContent("world"));
    await memory.clear();

    const ctx = await memory.getContext();
    expect(ctx.results).toHaveLength(0);
  });

  it("should report stats", async () => {
    await memory.add(makeContent("test"));
    const stats = await memory.getStats();
    expect(stats.currentMemories).toBe(1);
    expect(stats.isPersistent).toBe(false);
    expect(stats.maxMemories).toBe(100);
  });

  it("should handle JSON content in query", async () => {
    await memory.add({
      content: { key: "value", nested: "important data" },
      mimeType: "application/json",
      metadata: {},
      timestamp: new Date(),
    });

    const result = await memory.query("important");
    expect(result.results).toHaveLength(1);
  });

  it("should serialize and deserialize via config", async () => {
    await memory.add(makeContent("hello"));
    await memory.add(makeContent("world"));

    const config = memory.toConfig();
    const restored = ListMemory.fromConfig(config);

    expect(restored.memories).toHaveLength(2);
    expect(restored.memories[0].content).toBe("hello");
    expect(restored.maxMemories).toBe(100);
  });
});
