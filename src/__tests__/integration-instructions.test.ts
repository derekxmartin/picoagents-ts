/**
 * Integration test: Instructions module.
 */

import { describe, it, expect } from "vitest";
import {
  getInstructions,
  TASK_COMPLETION_BLOCK,
  EFFICIENCY_BLOCK,
  BEST_PRACTICES_BLOCK,
  ANTI_HALLUCINATION_BLOCK,
  TOOL_GUIDES,
} from "../instructions.js";

describe("getInstructions", () => {
  it("should return a non-empty string", () => {
    const instructions = getInstructions();
    expect(instructions).toBeTruthy();
    expect(typeof instructions).toBe("string");
    expect(instructions.length).toBeGreaterThan(100);
  });

  it("should include all blocks", () => {
    const instructions = getInstructions();
    expect(instructions).toContain("Task Completion");
    expect(instructions).toContain("Efficiency");
    expect(instructions).toContain("Best Practices");
    expect(instructions).toContain("Anti-Hallucination");
  });

  it("should include tool guides when no filter", () => {
    const instructions = getInstructions();
    expect(instructions).toContain("Available Tools");
    expect(instructions).toContain("read_file");
    expect(instructions).toContain("think");
  });

  it("should filter tool guides by name", () => {
    const instructions = getInstructions({
      toolNames: ["read_file", "write_file"],
    });
    expect(instructions).toContain("read_file");
    expect(instructions).toContain("write_file");
    expect(instructions).not.toContain("bash_execute");
  });

  it("should return no tool guide for empty list", () => {
    const instructions = getInstructions({ toolNames: [] });
    expect(instructions).not.toContain("Available Tools");
  });

  it("should export reusable blocks", () => {
    expect(TASK_COMPLETION_BLOCK).toContain("Task Completion");
    expect(EFFICIENCY_BLOCK).toContain("Batch Tool Calls");
    expect(BEST_PRACTICES_BLOCK).toContain("Before Editing");
    expect(ANTI_HALLUCINATION_BLOCK).toContain("Anti-Hallucination");
  });

  it("TOOL_GUIDES should have expected keys", () => {
    expect(TOOL_GUIDES).toHaveProperty("read_file");
    expect(TOOL_GUIDES).toHaveProperty("think");
    expect(TOOL_GUIDES).toHaveProperty("calculator");
  });
});
