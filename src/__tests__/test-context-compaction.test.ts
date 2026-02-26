/**
 * Tests for context compaction strategies.
 *
 * This test verifies that context compaction works correctly INSIDE the tool loop,
 * which is the critical fix for the Agent Framework compaction issue.
 *
 * Key test criteria:
 * 1. Compaction is called on each iteration of the tool loop (not just once at start)
 * 2. The compacted message list REPLACES the working list (subsequent iterations use compacted)
 * 3. Atomic groups (tool calls + results) are preserved
 * 4. Statistics are tracked correctly
 */

import { describe, it, expect } from "vitest";
import {
  NoCompaction,
  HeadTailCompaction,
  SlidingWindowCompaction,
  type CompactionStrategy,
} from "../compaction.js";
import type { Message } from "../messages.js";

// === Helper factories ===

function systemMsg(content: string): Message {
  return { role: "system", content, source: "system", timestamp: new Date() };
}

function userMsg(content: string): Message {
  return { role: "user", content, source: "user", timestamp: new Date() };
}

function assistantMsg(content: string): Message {
  return {
    role: "assistant",
    content,
    source: "assistant",
    timestamp: new Date(),
  };
}

function assistantWithToolCalls(
  toolCalls: { toolName: string; parameters: Record<string, unknown>; callId: string }[],
): Message {
  return {
    role: "assistant",
    content: "",
    source: "assistant",
    timestamp: new Date(),
    toolCalls,
  } as Message;
}

function toolMsg(
  content: string,
  toolCallId: string,
  toolName: string,
): Message {
  return {
    role: "tool",
    content,
    source: toolName,
    timestamp: new Date(),
    toolCallId,
    toolName,
    success: true,
  } as Message;
}

// === Unit Tests for Strategies ===

describe("NoCompaction", () => {
  it("returns messages unchanged", () => {
    const strategy = new NoCompaction();
    const messages: Message[] = [
      systemMsg("You are helpful"),
      userMsg("Hello"),
    ];
    const result = strategy.compact(messages);
    expect(result).toEqual(messages);
    expect(result).toHaveLength(2);
  });
});

describe("HeadTailCompaction", () => {
  it("no compaction under budget", () => {
    const strategy = new HeadTailCompaction(100_000);
    const messages: Message[] = [
      systemMsg("System"),
      userMsg("Hello"),
    ];
    const result = strategy.compact(messages);
    expect(result).toHaveLength(messages.length);
    expect(strategy.compactionCount).toBe(0);
  });

  it("compaction over budget", () => {
    // Use very low budget to force compaction
    const strategy = new HeadTailCompaction(50, 0.5);

    // Create many messages to exceed budget
    const messages: Message[] = [systemMsg("System prompt")];
    for (let i = 0; i < 20; i++) {
      messages.push(userMsg("Message " + i + " ".repeat(40)));
    }

    const result = strategy.compact(messages);

    // Should have compacted
    expect(result.length).toBeLessThan(messages.length);
    expect(strategy.compactionCount).toBe(1);
    expect(strategy.totalTokensSaved).toBeGreaterThan(0);
  });

  it("preserves atomic groups", () => {
    const strategy = new HeadTailCompaction(200, 0.3);

    const messages: Message[] = [
      systemMsg("System"),
      userMsg("Do something"),
      assistantWithToolCalls([
        { toolName: "test_tool", parameters: { x: 1 }, callId: "call_1" },
      ]),
      toolMsg("Result 1", "call_1", "test_tool"),
      // More messages to force compaction
      userMsg("Another message ".repeat(20)),
      assistantWithToolCalls([
        { toolName: "test_tool", parameters: { x: 2 }, callId: "call_2" },
      ]),
      toolMsg("Result 2", "call_2", "test_tool"),
    ];

    const result = strategy.compact(messages);

    // Check that tool calls and results stay together
    for (let i = 0; i < result.length; i++) {
      const msg = result[i];
      if (msg.role === "assistant" && "toolCalls" in msg && (msg as any).toolCalls) {
        const callId = (msg as any).toolCalls[0].callId;
        // There must be a corresponding ToolMessage after this
        let foundResult = false;
        for (let j = i + 1; j < result.length; j++) {
          if (
            result[j].role === "tool" &&
            "toolCallId" in result[j] &&
            (result[j] as any).toolCallId === callId
          ) {
            foundResult = true;
            break;
          }
        }
        expect(foundResult).toBe(true);
      }
    }
  });
});

describe("SlidingWindowCompaction", () => {
  it("preserves system message", () => {
    const strategy = new SlidingWindowCompaction(100);

    const messages: Message[] = [
      systemMsg("Important system prompt"),
    ];
    // Add many messages to exceed budget
    for (let i = 0; i < 20; i++) {
      messages.push(userMsg("Message " + i + " ".repeat(40)));
    }

    const result = strategy.compact(messages);

    // System message should be first
    expect(result[0].role).toBe("system");
    expect(result[0].content).toBe("Important system prompt");
  });

  it("keeps recent messages", () => {
    const strategy = new SlidingWindowCompaction(100);

    const messages: Message[] = [
      systemMsg("System"),
      userMsg("Old message 1"),
      userMsg("Old message 2"),
      userMsg("Recent message"),
    ];

    const result = strategy.compact(messages);

    // Should include the recent message
    const contents = result.map((m) => m.content ?? "");
    expect(contents).toContain("Recent message");
  });
});

// === Integration Tests ===

describe("CompactionInToolLoop", () => {
  it("strategy protocol compliance", () => {
    // All strategies should satisfy the CompactionStrategy interface
    // In TypeScript this is enforced at compile time, but we can verify
    // they all have the compact method
    const strategies: CompactionStrategy[] = [
      new HeadTailCompaction(),
      new SlidingWindowCompaction(),
      new NoCompaction(),
    ];

    for (const strategy of strategies) {
      expect(typeof strategy.compact).toBe("function");
    }
  });

  it("compaction loop simulation", () => {
    /**
     * Simulate the agent tool loop to verify compaction behavior.
     *
     * This tests the CRITICAL pattern that MiniAgent uses:
     * `messages = strategy.compact(messages)` - reassignment!
     */
    const strategy = new HeadTailCompaction(100);

    // Simulate the agent loop pattern
    let messages: Message[] = [
      systemMsg("System"),
      userMsg("User task"),
    ];

    // Simulate 3 iterations of the tool loop
    for (let iteration = 0; iteration < 3; iteration++) {
      // === THIS IS THE KEY: Compaction happens BEFORE LLM call ===
      messages = strategy.compact(messages);

      // Simulate LLM response with tool call
      messages.push(
        assistantWithToolCalls([
          {
            toolName: "test",
            parameters: { x: iteration },
            callId: `call_${iteration}`,
          },
        ]),
      );

      // Simulate tool result
      messages.push(
        toolMsg(
          "Result " + iteration + " ".repeat(200), // Make results big
          `call_${iteration}`,
          "test",
        ),
      );
    }

    // After 3 iterations with big results, compaction should have triggered
    expect(strategy.compactionCount).toBeGreaterThan(0);
    expect(strategy.totalTokensSaved).toBeGreaterThan(0);
  });

  it("compaction persists across iterations", () => {
    /**
     * Verify the compacted list is used (not discarded) in subsequent iterations.
     */
    const calls: [number, number][] = []; // (input_len, output_len)

    const strategy: CompactionStrategy = {
      compact(messages: Message[]): Message[] {
        const inputLen = messages.length;

        // Compact to 3 messages if over 5
        if (messages.length > 5) {
          const compacted = [...messages.slice(0, 2), messages[messages.length - 1]];
          calls.push([inputLen, compacted.length]);
          return compacted;
        }

        calls.push([inputLen, messages.length]);
        return messages;
      },
    };

    let messages: Message[] = [
      systemMsg("System"),
      userMsg("Task"),
    ];

    // Simulate iterations
    for (let i = 0; i < 5; i++) {
      messages = strategy.compact(messages);
      // Add 2 messages per iteration
      messages.push(assistantMsg(`Response ${i}`));
      messages.push(userMsg(`Follow up ${i}`));
    }

    // Verify the pattern: after compaction, next input should start from
    // compacted size (+ new messages), NOT from original growing size
    for (let i = 1; i < calls.length; i++) {
      const [inputLen] = calls[i];
      const prevOutputLen = calls[i - 1][1];
      // Input should be prev_output + 2 (the messages added after)
      const expectedInput = prevOutputLen + 2;
      expect(inputLen).toBe(expectedInput);
    }
  });
});

// === Statistics Tests ===

describe("StrategyStatistics", () => {
  it("head tail tracks compaction count", () => {
    const strategy = new HeadTailCompaction(50);

    // First call - should compact
    const messages1: Message[] = [
      systemMsg("S"),
      ...Array.from({ length: 10 }, () => userMsg("M".repeat(50))),
    ];
    strategy.compact(messages1);

    // Second call - should compact again
    const messages2: Message[] = [
      ...messages1,
      userMsg("More ".repeat(50)),
    ];
    strategy.compact(messages2);

    expect(strategy.compactionCount).toBe(2);
  });

  it("head tail tracks tokens saved", () => {
    const strategy = new HeadTailCompaction(50);

    const messages: Message[] = [
      systemMsg("S"),
      ...Array.from({ length: 10 }, () => userMsg("Message ".repeat(20))),
    ];

    strategy.compact(messages);

    expect(strategy.totalTokensSaved).toBeGreaterThan(0);
  });
});

// === Edge Cases ===

describe("EdgeCases", () => {
  it("empty messages", () => {
    const strategy = new HeadTailCompaction(100);
    const result = strategy.compact([]);
    expect(result).toEqual([]);
  });

  it("single message", () => {
    const strategy = new HeadTailCompaction(100);
    const messages: Message[] = [systemMsg("Hello")];
    const result = strategy.compact(messages);
    expect(result).toHaveLength(1);
  });
});
