import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { FileMemory } from "../file-memory.js";
import type { MemoryContent } from "../base.js";

function makeContent(text: string): MemoryContent {
  return {
    content: text,
    mimeType: "text/plain",
    metadata: {},
    timestamp: new Date(),
  };
}

describe("FileMemory", () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "picoagents-test-"));
    filePath = path.join(tempDir, "test-memory.json");
  });

  afterEach(() => {
    // Cleanup
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("should persist memories to file", async () => {
    const memory = new FileMemory(filePath);
    await memory.add(makeContent("Hello from file"));

    // Verify file exists
    expect(fs.existsSync(filePath)).toBe(true);

    // Load fresh instance
    const memory2 = new FileMemory(filePath);
    const ctx = await memory2.getContext();
    expect(ctx.results).toHaveLength(1);
    expect(ctx.results[0].content).toBe("Hello from file");
  });

  it("should add and query memories", async () => {
    const memory = new FileMemory(filePath);
    await memory.add(makeContent("TypeScript is fun"));
    await memory.add(makeContent("Python is great"));
    await memory.add(makeContent("TypeScript has types"));

    const result = await memory.query("TypeScript");
    expect(result.results).toHaveLength(2);
  });

  it("should get context with recent memories", async () => {
    const memory = new FileMemory(filePath);
    for (let i = 0; i < 10; i++) {
      await memory.add(makeContent(`item ${i}`));
    }

    const ctx = await memory.getContext(3);
    expect(ctx.results).toHaveLength(3);
    expect(ctx.results[2].content).toBe("item 9");
  });

  it("should trim oldest when exceeding capacity", async () => {
    const memory = new FileMemory(filePath, 3);
    await memory.add(makeContent("one"));
    await memory.add(makeContent("two"));
    await memory.add(makeContent("three"));
    await memory.add(makeContent("four"));

    expect(memory.memories).toHaveLength(3);
    expect(memory.memories[0].content).toBe("two");
  });

  it("should clear memories and remove file", async () => {
    const memory = new FileMemory(filePath);
    await memory.add(makeContent("hello"));
    expect(fs.existsSync(filePath)).toBe(true);

    await memory.clear();
    expect(memory.memories).toHaveLength(0);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("should report stats", async () => {
    const memory = new FileMemory(filePath);
    await memory.add(makeContent("test"));

    const stats = await memory.getStats();
    expect(stats.currentMemories).toBe(1);
    expect(stats.isPersistent).toBe(true);
    expect(stats.filePath).toBe(filePath);
  });

  it("should handle corrupted file gracefully", async () => {
    fs.writeFileSync(filePath, "not valid json!!!", "utf-8");

    const memory = new FileMemory(filePath);
    expect(memory.memories).toHaveLength(0);

    // Should still be able to add new memories
    await memory.add(makeContent("fresh start"));
    expect(memory.memories).toHaveLength(1);
  });

  it("should handle non-existent file", () => {
    const memory = new FileMemory(
      path.join(tempDir, "does-not-exist.json")
    );
    expect(memory.memories).toHaveLength(0);
  });

  it("should serialize and deserialize via config", async () => {
    const memory = new FileMemory(filePath, 500);
    const config = memory.toConfig();

    expect(config.filePath).toBe(filePath);
    expect(config.maxMemories).toBe(500);

    const restored = FileMemory.fromConfig(config);
    expect(restored.filePath).toBe(filePath);
    expect(restored.maxMemories).toBe(500);
  });

  it("should create directory if it does not exist", async () => {
    const nestedPath = path.join(tempDir, "sub", "dir", "memory.json");
    const memory = new FileMemory(nestedPath);
    await memory.add(makeContent("nested"));

    expect(fs.existsSync(nestedPath)).toBe(true);
  });
});
