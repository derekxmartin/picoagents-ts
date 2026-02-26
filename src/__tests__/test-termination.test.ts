/**
 * Tests for termination conditions module.
 *
 * Tests all termination conditions: MaxMessage, TextMention, Timeout,
 * TokenUsage, Cancellation, External, FunctionCall, Handoff, Composite.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CancellationToken } from "../cancellation-token.js";
import type { Message, AssistantMessage, UserMessage, ToolMessage } from "../messages.js";
import {
  BaseTermination,
  MaxMessageTermination,
  TextMentionTermination,
  TimeoutTermination,
  TokenUsageTermination,
  CancellationTermination,
  ExternalTermination,
  FunctionCallTermination,
  HandoffTermination,
  CompositeTermination,
  type StopMessage,
} from "../termination/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function userMsg(content: string): UserMessage {
  return {
    role: "user" as const,
    content,
    source: "user",
    timestamp: new Date(),
  };
}

function assistantMsg(content: string, source = "assistant"): AssistantMessage {
  return {
    role: "assistant" as const,
    content,
    source,
    timestamp: new Date(),
  };
}

function toolMsg(
  content: string,
  toolName: string,
  success = true
): ToolMessage {
  return {
    role: "tool" as const,
    content,
    source: "tool",
    toolCallId: `call_${Math.random().toString(36).slice(2, 8)}`,
    toolName,
    success,
    timestamp: new Date(),
  };
}

// ============================================================================
// MaxMessageTermination
// ============================================================================

describe("MaxMessageTermination", () => {
  it("should not terminate initially", () => {
    const term = new MaxMessageTermination(3);
    expect(term.isMet()).toBe(false);
  });

  it("should not terminate before threshold", () => {
    const term = new MaxMessageTermination(3);

    let result = term.check([userMsg("First message")]);
    expect(result).toBeNull();
    expect(term.isMet()).toBe(false);

    result = term.check([assistantMsg("Second message")]);
    expect(result).toBeNull();
    expect(term.isMet()).toBe(false);
  });

  it("should terminate at threshold", () => {
    const term = new MaxMessageTermination(3);

    term.check([userMsg("First")]);
    term.check([assistantMsg("Second")]);
    const result = term.check([userMsg("Third")]);

    expect(result).not.toBeNull();
    expect(term.isMet()).toBe(true);
    expect(result!.content).toContain("Maximum messages reached");
    expect(result!.source).toBe("MaxMessageTermination");
  });

  it("should count batch messages correctly", () => {
    const term = new MaxMessageTermination(3);

    const result = term.check([
      userMsg("First"),
      assistantMsg("Second"),
      userMsg("Third"),
    ]);

    expect(result).not.toBeNull();
    expect(term.isMet()).toBe(true);
    expect(term.messageCount).toBe(3);
  });

  it("should reset properly", () => {
    const term = new MaxMessageTermination(1);
    term.check([userMsg("Trigger")]);
    expect(term.isMet()).toBe(true);

    term.reset();
    expect(term.isMet()).toBe(false);
    expect(term.messageCount).toBe(0);
    expect(term.getReason()).toBe("");
  });

  it("should include metadata in stop message", () => {
    const term = new MaxMessageTermination(2);
    term.check([userMsg("First")]);
    const result = term.check([userMsg("Second")]);

    expect(result).not.toBeNull();
    expect(result!.metadata).toEqual({
      messageCount: 2,
      maxMessages: 2,
    });
  });
});

// ============================================================================
// TextMentionTermination
// ============================================================================

describe("TextMentionTermination", () => {
  it("should not terminate initially", () => {
    const term = new TextMentionTermination("TERMINATE");
    expect(term.isMet()).toBe(false);
  });

  it("should not terminate on regular messages", () => {
    const term = new TextMentionTermination("TERMINATE");
    const result = term.check([userMsg("Just a regular message")]);
    expect(result).toBeNull();
    expect(term.isMet()).toBe(false);
  });

  it("should terminate when text is found (case insensitive)", () => {
    const term = new TextMentionTermination("TERMINATE");
    const result = term.check([
      assistantMsg("I think we should TERMINATE this conversation"),
    ]);

    expect(result).not.toBeNull();
    expect(term.isMet()).toBe(true);
    expect(result!.content).toContain("Text mention found: 'TERMINATE'");
    expect(result!.source).toBe("TextMentionTermination");
  });

  it("should be case insensitive by default", () => {
    const term = new TextMentionTermination("TERMINATE");
    const result = term.check([
      assistantMsg("We should terminate this"),
    ]);
    expect(result).not.toBeNull();
    expect(term.isMet()).toBe(true);
  });

  it("should support case-sensitive mode", () => {
    const term = new TextMentionTermination("TERMINATE", true);

    // Lowercase should not trigger
    let result = term.check([assistantMsg("We should terminate this")]);
    expect(result).toBeNull();
    expect(term.isMet()).toBe(false);

    // Uppercase should trigger
    result = term.check([assistantMsg("We should TERMINATE this")]);
    expect(result).not.toBeNull();
    expect(term.isMet()).toBe(true);
  });

  it("should detect text in any message in the batch", () => {
    const term = new TextMentionTermination("STOP");
    const result = term.check([
      userMsg("First message"),
      assistantMsg("Let's STOP here"),
    ]);
    expect(result).not.toBeNull();
  });

  it("should include metadata", () => {
    const term = new TextMentionTermination("DONE", true);
    const result = term.check([assistantMsg("We are DONE")]);

    expect(result).not.toBeNull();
    expect(result!.metadata).toEqual({
      text: "DONE",
      caseSensitive: true,
      foundIn: "assistant",
    });
  });
});

// ============================================================================
// TimeoutTermination
// ============================================================================

describe("TimeoutTermination", () => {
  it("should not terminate initially", () => {
    const term = new TimeoutTermination(10);
    expect(term.isMet()).toBe(false);
  });

  it("should not terminate before timeout", () => {
    const term = new TimeoutTermination(10);
    const result = term.check([userMsg("Quick check")]);
    expect(result).toBeNull();
    expect(term.isMet()).toBe(false);
  });

  it("should terminate after timeout", async () => {
    const term = new TimeoutTermination(0.1); // 100ms

    term.check([userMsg("Start timer")]);

    // Wait for timeout
    await new Promise((resolve) => setTimeout(resolve, 150));

    const result = term.check([userMsg("After timeout")]);
    expect(result).not.toBeNull();
    expect(term.isMet()).toBe(true);
    expect(result!.content).toContain("Timeout reached");
  });

  it("should reset timer on reset", () => {
    const term = new TimeoutTermination(10);
    term.check([userMsg("Start")]);
    term.reset();
    expect(term.isMet()).toBe(false);
  });

  it("should include metadata", async () => {
    const term = new TimeoutTermination(0.1);
    term.check([userMsg("Start")]);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const result = term.check([userMsg("Check")]);

    expect(result).not.toBeNull();
    expect(result!.metadata).toHaveProperty("elapsedSeconds");
    expect(result!.metadata).toHaveProperty("maxDurationSeconds");
  });
});

// ============================================================================
// TokenUsageTermination
// ============================================================================

describe("TokenUsageTermination", () => {
  it("should not terminate initially", () => {
    const term = new TokenUsageTermination(100);
    expect(term.isMet()).toBe(false);
  });

  it("should not terminate with short messages", () => {
    const term = new TokenUsageTermination(20);
    const result = term.check([userMsg("Hi")]); // ~1 token
    expect(result).toBeNull();
    expect(term.isMet()).toBe(false);
  });

  it("should terminate when token limit exceeded", () => {
    const term = new TokenUsageTermination(20);
    const longContent =
      "This is a very long message that should exceed the token limit ".repeat(
        10
      );
    const result = term.check([assistantMsg(longContent)]);

    expect(result).not.toBeNull();
    expect(term.isMet()).toBe(true);
    expect(result!.content).toContain("Token limit exceeded");
  });

  it("should accumulate tokens across checks", () => {
    const term = new TokenUsageTermination(10);

    // "Hello world!!" = 13 chars → floor(13/4) = 3 tokens
    term.check([userMsg("Hello world!!")]);
    expect(term.isMet()).toBe(false);
    expect(term.totalTokens).toBe(3);

    term.check([assistantMsg("Hello world!!")]);
    expect(term.isMet()).toBe(false);
    expect(term.totalTokens).toBe(6);

    // "Another longer message here" = 26 chars → floor(26/4) = 6 tokens → total 12
    term.check([userMsg("Another longer message here")]);
    expect(term.isMet()).toBe(true);
    expect(term.totalTokens).toBe(12);
  });

  it("should reset token counter", () => {
    const term = new TokenUsageTermination(1);
    term.check([userMsg("Very long message" .repeat(100))]);
    expect(term.isMet()).toBe(true);

    term.reset();
    expect(term.isMet()).toBe(false);
    expect(term.totalTokens).toBe(0);
  });

  it("should include metadata", () => {
    const term = new TokenUsageTermination(5);
    const result = term.check([userMsg("A sufficiently long message for tokens")]);

    expect(result).not.toBeNull();
    expect(result!.metadata).toHaveProperty("totalTokens");
    expect(result!.metadata).toHaveProperty("maxTokens", 5);
  });
});

// ============================================================================
// CancellationTermination
// ============================================================================

describe("CancellationTermination", () => {
  it("should not terminate when token is not cancelled", () => {
    const token = new CancellationToken();
    const term = new CancellationTermination(token);

    const result = term.check([userMsg("Test")]);
    expect(result).toBeNull();
    expect(term.isMet()).toBe(false);
  });

  it("should terminate when token is cancelled", () => {
    const token = new CancellationToken();
    const term = new CancellationTermination(token);

    token.cancel();

    const result = term.check([userMsg("Test")]);
    expect(result).not.toBeNull();
    expect(term.isMet()).toBe(true);
    expect(result!.content).toBe("Cancellation token triggered");
    expect(result!.source).toBe("CancellationTermination");
  });

  it("should include metadata", () => {
    const token = new CancellationToken();
    const term = new CancellationTermination(token);
    token.cancel();

    const result = term.check([userMsg("Test")]);
    expect(result!.metadata).toEqual({ source: "cancellation_token" });
  });
});

// ============================================================================
// ExternalTermination
// ============================================================================

describe("ExternalTermination", () => {
  it("should not terminate when callback returns false", () => {
    const term = new ExternalTermination(() => false);
    const result = term.check([userMsg("Test")]);
    expect(result).toBeNull();
    expect(term.isMet()).toBe(false);
  });

  it("should terminate when callback returns true", () => {
    let flag = false;
    const term = new ExternalTermination(() => flag);

    let result = term.check([userMsg("Test")]);
    expect(result).toBeNull();

    flag = true;
    result = term.check([assistantMsg("Another")]);
    expect(result).not.toBeNull();
    expect(term.isMet()).toBe(true);
    expect(result!.content).toBe("External termination signal received");
  });

  it("should not crash on callback exception", () => {
    const term = new ExternalTermination(() => {
      throw new Error("Callback error");
    });

    const result = term.check([userMsg("Test")]);
    expect(result).toBeNull();
    expect(term.isMet()).toBe(false);
  });
});

// ============================================================================
// FunctionCallTermination
// ============================================================================

describe("FunctionCallTermination", () => {
  it("should not terminate on regular messages", () => {
    const term = new FunctionCallTermination("approve_action");
    const result = term.check([userMsg("Please approve this")]);
    expect(result).toBeNull();
    expect(term.isMet()).toBe(false);
  });

  it("should not terminate on different function call", () => {
    const term = new FunctionCallTermination("approve_action");
    const result = term.check([
      toolMsg("Function executed", "other_function"),
    ]);
    expect(result).toBeNull();
    expect(term.isMet()).toBe(false);
  });

  it("should terminate on matching function call", () => {
    const term = new FunctionCallTermination("approve_action");
    const result = term.check([
      toolMsg("Action approved", "approve_action"),
    ]);

    expect(result).not.toBeNull();
    expect(term.isMet()).toBe(true);
    expect(result!.content).toBe("Function 'approve_action' was called");
    expect(result!.source).toBe("FunctionCallTermination");
  });

  it("should include success status in metadata", () => {
    const term = new FunctionCallTermination("my_func");
    const result = term.check([toolMsg("Result", "my_func", false)]);

    expect(result).not.toBeNull();
    expect(result!.metadata).toEqual({
      functionName: "my_func",
      success: false,
    });
  });

  it("should detect function call in batch", () => {
    const term = new FunctionCallTermination("target_func");
    const result = term.check([
      userMsg("Some message"),
      toolMsg("Other result", "other_func"),
      toolMsg("Target result", "target_func"),
    ]);
    expect(result).not.toBeNull();
    expect(term.isMet()).toBe(true);
  });
});

// ============================================================================
// HandoffTermination
// ============================================================================

describe("HandoffTermination", () => {
  it("should not terminate on regular messages", () => {
    const term = new HandoffTermination("specialist");
    const result = term.check([userMsg("Tell me about specialists")]);
    expect(result).toBeNull();
    expect(term.isMet()).toBe(false);
  });

  it("should not terminate on user messages with handoff text", () => {
    const term = new HandoffTermination("specialist");
    const result = term.check([userMsg("handoff to specialist")]);
    // User messages are role 'user', not 'assistant'
    expect(result).toBeNull();
  });

  it("should terminate on handoff pattern", () => {
    const term = new HandoffTermination("specialist");
    const result = term.check([
      assistantMsg("I'll handoff to specialist for this task"),
    ]);

    expect(result).not.toBeNull();
    expect(term.isMet()).toBe(true);
    expect(result!.content).toBe("Handoff requested to 'specialist'");
  });

  it("should detect transfer pattern", () => {
    const term = new HandoffTermination("expert");
    const result = term.check([
      assistantMsg("Let me transfer to expert"),
    ]);
    expect(result).not.toBeNull();
  });

  it("should detect pass pattern", () => {
    const term = new HandoffTermination("agent2");
    const result = term.check([
      assistantMsg("I'll pass to agent2 now"),
    ]);
    expect(result).not.toBeNull();
  });

  it("should detect delegate pattern", () => {
    const term = new HandoffTermination("analyzer");
    const result = term.check([
      assistantMsg("I should delegate to analyzer"),
    ]);
    expect(result).not.toBeNull();
  });

  it("should be case insensitive", () => {
    const term = new HandoffTermination("Specialist");
    const result = term.check([
      assistantMsg("HANDOFF TO SPECIALIST please"),
    ]);
    expect(result).not.toBeNull();
  });

  it("should include metadata with pattern", () => {
    const term = new HandoffTermination("target");
    const result = term.check([
      assistantMsg("Let me transfer to target now"),
    ]);

    expect(result).not.toBeNull();
    expect(result!.metadata).toEqual({
      target: "target",
      pattern: "transfer to target",
    });
  });
});

// ============================================================================
// CompositeTermination
// ============================================================================

describe("CompositeTermination", () => {
  describe("any mode (OR logic)", () => {
    it("should not terminate initially", () => {
      const composite = new CompositeTermination(
        [new MaxMessageTermination(5), new TextMentionTermination("STOP")],
        "any"
      );
      expect(composite.isMet()).toBe(false);
    });

    it("should terminate when any condition is met", () => {
      const term1 = new MaxMessageTermination(5);
      const term2 = new TextMentionTermination("STOP");
      const composite = new CompositeTermination([term1, term2], "any");

      const result = composite.check([
        assistantMsg("Let's STOP here"),
      ]);

      expect(result).not.toBeNull();
      expect(composite.isMet()).toBe(true);
      expect(result!.content).toContain("Composite (any)");
    });

    it("should reset all conditions", () => {
      const term1 = new MaxMessageTermination(5);
      const term2 = new TextMentionTermination("STOP");
      const composite = new CompositeTermination([term1, term2], "any");

      composite.check([assistantMsg("Let's STOP")]);
      expect(composite.isMet()).toBe(true);

      composite.reset();
      expect(composite.isMet()).toBe(false);
      expect(term1.isMet()).toBe(false);
      expect(term2.isMet()).toBe(false);
    });
  });

  describe("all mode (AND logic)", () => {
    it("should not terminate when only one condition is met", () => {
      const term1 = new MaxMessageTermination(2);
      const term2 = new TextMentionTermination("DONE");
      const composite = new CompositeTermination([term1, term2], "all");

      const result = composite.check([userMsg("First message")]);
      expect(result).toBeNull();
      expect(composite.isMet()).toBe(false);
    });

    it("should terminate when all conditions are met", () => {
      const term1 = new MaxMessageTermination(2);
      const term2 = new TextMentionTermination("DONE");
      const composite = new CompositeTermination([term1, term2], "all");

      composite.check([userMsg("First message")]);
      const result = composite.check([
        assistantMsg("Second message, we are DONE"),
      ]);

      expect(result).not.toBeNull();
      expect(composite.isMet()).toBe(true);
      expect(result!.content).toContain("Composite (all)");
    });
  });

  describe("operator methods", () => {
    it("should create OR composite with .or()", () => {
      const term1 = new MaxMessageTermination(3);
      const term2 = new TextMentionTermination("STOP");

      const orComposite = term1.or(term2);
      expect(orComposite).toBeInstanceOf(CompositeTermination);
      expect(orComposite.mode).toBe("any");
      expect(orComposite.conditions).toHaveLength(2);
    });

    it("should create AND composite with .and()", () => {
      const term1 = new MaxMessageTermination(3);
      const term2 = new TextMentionTermination("STOP");

      const andComposite = term1.and(term2);
      expect(andComposite).toBeInstanceOf(CompositeTermination);
      expect(andComposite.mode).toBe("all");
      expect(andComposite.conditions).toHaveLength(2);
    });

    it("should chain OR compositions (flatten)", () => {
      const term1 = new MaxMessageTermination(3);
      const term2 = new TextMentionTermination("STOP");
      const term3 = new TokenUsageTermination(100);

      const chained = term1.or(term2).or(term3);
      expect(chained).toBeInstanceOf(CompositeTermination);
      expect(chained.mode).toBe("any");
      expect(chained.conditions).toHaveLength(3);
    });

    it("should chain AND compositions (flatten)", () => {
      const term1 = new MaxMessageTermination(3);
      const term2 = new TextMentionTermination("STOP");
      const term3 = new TokenUsageTermination(100);

      const chained = term1.and(term2).and(term3);
      expect(chained).toBeInstanceOf(CompositeTermination);
      expect(chained.mode).toBe("all");
      expect(chained.conditions).toHaveLength(3);
    });
  });

  describe("validation", () => {
    it("should reject invalid mode", () => {
      expect(() => {
        new CompositeTermination(
          [new MaxMessageTermination(3), new TextMentionTermination("STOP")],
          "invalid" as any
        );
      }).toThrow("Mode must be 'any' or 'all'");
    });
  });
});

// ============================================================================
// Cross-cutting / reset tests
// ============================================================================

describe("Termination reset functionality", () => {
  it("should reset all termination types properly", async () => {
    const terminations: BaseTermination[] = [
      new MaxMessageTermination(1),
      new TextMentionTermination("STOP"),
      new TokenUsageTermination(1),
      new TimeoutTermination(0.05),
    ];

    // Trigger all terminations
    for (const term of terminations) {
      if (term instanceof TimeoutTermination) {
        term.check([userMsg("Start")]);
        await new Promise((resolve) => setTimeout(resolve, 100));
        term.check([userMsg("Trigger")]);
      } else if (term instanceof MaxMessageTermination) {
        term.check([userMsg("Trigger")]);
      } else if (term instanceof TextMentionTermination) {
        term.check([userMsg("STOP now")]);
      } else {
        // TokenUsageTermination
        term.check([userMsg("Very long message".repeat(100))]);
      }

      expect(term.isMet()).toBe(true);
    }

    // Reset all and verify
    for (const term of terminations) {
      term.reset();
      expect(term.isMet()).toBe(false);
      expect(term.getReason()).toBe("");
    }
  });
});

// ============================================================================
// BaseTermination abstract class
// ============================================================================

describe("BaseTermination", () => {
  class TestTermination extends BaseTermination {
    check(newMessages: Message[]): StopMessage | null {
      if (newMessages.some((m) => m.content === "trigger")) {
        return this._setTermination("Triggered", { custom: "data" });
      }
      return null;
    }
  }

  it("should track state through _setTermination", () => {
    const term = new TestTermination();
    expect(term.isMet()).toBe(false);
    expect(term.getReason()).toBe("");
    expect(term.getMetadata()).toEqual({});

    const result = term.check([userMsg("trigger")]);

    expect(result).not.toBeNull();
    expect(term.isMet()).toBe(true);
    expect(term.getReason()).toBe("Triggered");
    expect(term.getMetadata()).toEqual({ custom: "data" });
  });

  it("should return copy of metadata", () => {
    const term = new TestTermination();
    term.check([userMsg("trigger")]);

    const meta1 = term.getMetadata();
    const meta2 = term.getMetadata();
    expect(meta1).toEqual(meta2);
    expect(meta1).not.toBe(meta2); // Different object references
  });

  it("should set source to class name in stop message", () => {
    const term = new TestTermination();
    const result = term.check([userMsg("trigger")]);
    expect(result!.source).toBe("TestTermination");
  });
});
