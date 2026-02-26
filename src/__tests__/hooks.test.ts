import { describe, it, expect } from "vitest";
import { AgentContext } from "../context.js";
import {
  TerminationCondition,
  MaxRestartsTermination,
  CompositeTermination,
  PlanningHook,
  CompletionCheckHook,
  type LoopContext,
} from "../hooks.js";

function makeLoopContext(overrides?: Partial<LoopContext>): LoopContext {
  return {
    agentContext: new AgentContext("session-1"),
    llmMessages: [],
    agentName: "test-agent",
    iteration: 0,
    restartCount: 0,
    metadata: {},
    ...overrides,
  };
}

describe("MaxRestartsTermination", () => {
  it("should not terminate before max restarts", () => {
    const term = new MaxRestartsTermination(3);
    const ctx = makeLoopContext({ restartCount: 2 });
    expect(term.shouldTerminate(ctx)).toBe(false);
  });

  it("should terminate at max restarts", () => {
    const term = new MaxRestartsTermination(3);
    const ctx = makeLoopContext({ restartCount: 3 });
    expect(term.shouldTerminate(ctx)).toBe(true);
  });

  it("should terminate above max restarts", () => {
    const term = new MaxRestartsTermination(2);
    const ctx = makeLoopContext({ restartCount: 5 });
    expect(term.shouldTerminate(ctx)).toBe(true);
  });
});

describe("CompositeTermination", () => {
  it("should support OR composition", () => {
    const a = new MaxRestartsTermination(5);
    const b = new MaxRestartsTermination(2);
    const combined = a.or(b); // either

    // restartCount=3: a says no, b says yes => OR = true
    expect(
      combined.shouldTerminate(makeLoopContext({ restartCount: 3 }))
    ).toBe(true);
  });

  it("should support AND composition", () => {
    const a = new MaxRestartsTermination(2);
    const b = new MaxRestartsTermination(5);
    const combined = a.and(b); // both

    // restartCount=3: a says yes, b says no => AND = false
    expect(
      combined.shouldTerminate(makeLoopContext({ restartCount: 3 }))
    ).toBe(false);

    // restartCount=5: both say yes => AND = true
    expect(
      combined.shouldTerminate(makeLoopContext({ restartCount: 5 }))
    ).toBe(true);
  });

  it("should flatten OR chains", () => {
    const a = new MaxRestartsTermination(1);
    const b = new MaxRestartsTermination(2);
    const c = new MaxRestartsTermination(3);
    const combined = a.or(b).or(c);

    expect(combined.conditions).toHaveLength(3);
    expect(combined.mode).toBe("any");
  });

  it("should flatten AND chains", () => {
    const a = new MaxRestartsTermination(1);
    const b = new MaxRestartsTermination(2);
    const c = new MaxRestartsTermination(3);
    const combined = a.and(b).and(c);

    expect(combined.conditions).toHaveLength(3);
    expect(combined.mode).toBe("all");
  });

  it("should reset all conditions", () => {
    let resetCount = 0;

    class CountingTermination extends TerminationCondition {
      shouldTerminate(): boolean {
        return false;
      }
      override reset(): void {
        resetCount++;
      }
    }

    const combined = new CompositeTermination(
      [new CountingTermination(), new CountingTermination()],
      "any"
    );
    combined.reset();
    expect(resetCount).toBe(2);
  });
});

describe("PlanningHook", () => {
  it("should return default instruction", async () => {
    const hook = new PlanningHook();
    const result = await hook.onStart(makeLoopContext());
    expect(result).toContain("Before starting any work");
    expect(result).toContain("todo_write");
  });

  it("should return custom instruction", async () => {
    const hook = new PlanningHook("Think carefully.");
    const result = await hook.onStart(makeLoopContext());
    expect(result).toBe("Think carefully.");
  });
});

describe("CompletionCheckHook", () => {
  it("should return undefined when no todos", async () => {
    const hook = new CompletionCheckHook();
    const result = await hook.onEnd(makeLoopContext());
    expect(result).toBeUndefined();
  });

  it("should return undefined when all todos complete", async () => {
    const hook = new CompletionCheckHook();
    const ctx = makeLoopContext({
      metadata: {
        todos: [
          { content: "Task 1", status: "completed" },
          { content: "Task 2", status: "completed" },
        ],
      },
    });
    const result = await hook.onEnd(ctx);
    expect(result).toBeUndefined();
  });

  it("should return resume message when todos incomplete", async () => {
    const hook = new CompletionCheckHook();
    const ctx = makeLoopContext({
      metadata: {
        todos: [
          { content: "Task 1", status: "completed" },
          { content: "Task 2", status: "pending" },
        ],
      },
    });
    const result = await hook.onEnd(ctx);
    expect(result).toContain("1 incomplete tasks");
    expect(result).toContain("Task 2");
  });

  it("should respect termination condition", async () => {
    const hook = new CompletionCheckHook({ maxRestarts: 1 });
    const ctx = makeLoopContext({
      restartCount: 1,
      metadata: {
        todos: [{ content: "Task 1", status: "pending" }],
      },
    });
    const result = await hook.onEnd(ctx);
    expect(result).toBeUndefined(); // Should allow stop
  });
});
