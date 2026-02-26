import { describe, it, expect } from "vitest";
import type { Message, AssistantMessage, ToolMessage, SystemMessage, UserMessage } from "../messages.js";
import {
  NoCompaction,
  HeadTailCompaction,
  SlidingWindowCompaction,
} from "../compaction.js";

// Helpers to create test messages
function sysMsg(content: string): SystemMessage {
  return {
    role: "system",
    content,
    source: "system",
    timestamp: new Date(),
  };
}

function userMsg(content: string): UserMessage {
  return {
    role: "user",
    content,
    source: "user",
    timestamp: new Date(),
  };
}

function assistantMsg(
  content: string,
  toolCalls?: AssistantMessage["toolCalls"]
): AssistantMessage {
  return {
    role: "assistant",
    content,
    source: "agent",
    timestamp: new Date(),
    toolCalls,
  };
}

function toolMsg(
  content: string,
  callId: string,
  toolName = "tool"
): ToolMessage {
  return {
    role: "tool",
    content,
    source: toolName,
    timestamp: new Date(),
    toolCallId: callId,
    toolName,
    success: true,
  };
}

describe("NoCompaction", () => {
  it("should return messages unchanged", () => {
    const strategy = new NoCompaction();
    const msgs: Message[] = [sysMsg("system"), userMsg("hello")];
    expect(strategy.compact(msgs)).toEqual(msgs);
  });

  it("should handle empty array", () => {
    const strategy = new NoCompaction();
    expect(strategy.compact([])).toEqual([]);
  });
});

describe("HeadTailCompaction", () => {
  it("should return messages unchanged when under budget", () => {
    const strategy = new HeadTailCompaction(100_000);
    const msgs: Message[] = [sysMsg("system"), userMsg("hi")];
    expect(strategy.compact(msgs)).toEqual(msgs);
    expect(strategy.compactionCount).toBe(0);
  });

  it("should compact when over budget", () => {
    // Very small budget to force compaction
    const strategy = new HeadTailCompaction(50, 0.5);

    // Create many messages to exceed budget
    const msgs: Message[] = [sysMsg("system prompt")];
    for (let i = 0; i < 30; i++) {
      msgs.push(userMsg(`message ${i} with some longer content to increase token count`));
    }

    const compacted = strategy.compact(msgs);
    expect(compacted.length).toBeLessThan(msgs.length);
    expect(strategy.compactionCount).toBe(1);
    expect(strategy.totalTokensSaved).toBeGreaterThan(0);
  });

  it("should preserve head and tail", () => {
    const strategy = new HeadTailCompaction(80, 0.3);

    const msgs: Message[] = [
      sysMsg("important system prompt"),
      userMsg("initial task"),
      ...Array.from({ length: 20 }, (_, i) =>
        userMsg(`middle message ${i} with lots of padding text to fill up context`)
      ),
      userMsg("most recent message"),
    ];

    const compacted = strategy.compact(msgs);
    // First message should be preserved (head)
    expect(compacted[0].content).toBe("important system prompt");
    // Last message should be preserved (tail)
    expect(compacted[compacted.length - 1].content).toBe(
      "most recent message"
    );
  });

  it("should preserve atomic groups (tool call + result)", () => {
    const strategy = new HeadTailCompaction(120, 0.2);

    const msgs: Message[] = [
      sysMsg("system"),
      ...Array.from({ length: 10 }, (_, i) =>
        userMsg(`padding message ${i} with extra long content for testing purposes here`)
      ),
      assistantMsg("", [
        {
          toolName: "calc",
          parameters: { expression: "2+2" },
          callId: "call_recent",
        },
      ]),
      toolMsg("4", "call_recent", "calc"),
      userMsg("final"),
    ];

    const compacted = strategy.compact(msgs);

    // If the tool call is kept, its result should also be kept
    const hasToolCall = compacted.some(
      (m) =>
        m.role === "assistant" &&
        "toolCalls" in m &&
        (m as AssistantMessage).toolCalls?.some(
          (tc) => tc.callId === "call_recent"
        )
    );
    const hasToolResult = compacted.some(
      (m) =>
        m.role === "tool" &&
        "toolCallId" in m &&
        (m as ToolMessage).toolCallId === "call_recent"
    );

    if (hasToolCall) {
      expect(hasToolResult).toBe(true);
    }
  });

  it("should handle empty messages", () => {
    const strategy = new HeadTailCompaction();
    expect(strategy.compact([])).toEqual([]);
  });
});

describe("SlidingWindowCompaction", () => {
  it("should return messages unchanged when under budget", () => {
    const strategy = new SlidingWindowCompaction(100_000);
    const msgs: Message[] = [sysMsg("system"), userMsg("hi")];
    expect(strategy.compact(msgs)).toEqual(msgs);
    expect(strategy.compactionCount).toBe(0);
  });

  it("should compact keeping system message and recent messages", () => {
    const strategy = new SlidingWindowCompaction(50);

    const msgs: Message[] = [
      sysMsg("important system prompt"),
      ...Array.from({ length: 30 }, (_, i) =>
        userMsg(`message ${i} with a lot of text content for testing compaction`)
      ),
    ];

    const compacted = strategy.compact(msgs);
    expect(compacted.length).toBeLessThan(msgs.length);
    // System message should be preserved
    expect(compacted[0].content).toBe("important system prompt");
    // Most recent messages should be preserved
    expect(compacted[compacted.length - 1].content).toBe(
      msgs[msgs.length - 1].content
    );
    expect(strategy.compactionCount).toBe(1);
  });

  it("should handle empty messages", () => {
    const strategy = new SlidingWindowCompaction();
    expect(strategy.compact([])).toEqual([]);
  });

  it("should preserve atomic groups", () => {
    const strategy = new SlidingWindowCompaction(100);

    const msgs: Message[] = [
      sysMsg("system"),
      ...Array.from({ length: 10 }, (_, i) =>
        userMsg(`padding ${i} with lots of extra content to fill tokens quickly`)
      ),
      assistantMsg("", [
        {
          toolName: "search",
          parameters: { q: "test" },
          callId: "call_1",
        },
      ]),
      toolMsg("results", "call_1", "search"),
      userMsg("latest"),
    ];

    const compacted = strategy.compact(msgs);

    // Check atomic group integrity
    const hasAssistant = compacted.some(
      (m) =>
        m.role === "assistant" &&
        "toolCalls" in m &&
        (m as AssistantMessage).toolCalls?.some(
          (tc) => tc.callId === "call_1"
        )
    );
    const hasToolResult = compacted.some(
      (m) =>
        m.role === "tool" &&
        "toolCallId" in m &&
        (m as ToolMessage).toolCallId === "call_1"
    );

    if (hasAssistant) {
      expect(hasToolResult).toBe(true);
    }
  });
});
