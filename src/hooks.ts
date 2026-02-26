/**
 * Deterministic loop hooks for PicoAgents.
 *
 * Hooks provide deterministic control points around the LLM-controlled tool loop.
 * Unlike middleware (which intercepts individual operations), hooks operate at the
 * LOOP level — before the first LLM call and when the loop is about to exit.
 *
 * Two hook points:
 *   - start hooks: Run before the first LLM call. Inject instructions.
 *   - end hooks: Run when agent would stop (no tool calls). Can resume the loop.
 */

import type { AgentContext } from "./context.js";
import type { Message } from "./messages.js";

// ==========================================================================
// LoopContext
// ==========================================================================

/**
 * Shared state passed to hooks during a single agent run.
 */
export interface LoopContext {
  /** The agent's working context (messages, metadata) */
  agentContext: AgentContext;
  /** Current message list being sent to the LLM */
  llmMessages: Message[];
  /** Name of the agent running */
  agentName: string;
  /** Current loop iteration (0-indexed) */
  iteration: number;
  /** How many times end hooks have resumed the loop */
  restartCount: number;
  /** Mutable dict for hooks to share state */
  metadata: Record<string, unknown>;
}

// ==========================================================================
// Termination Conditions
// ==========================================================================

/**
 * Controls when end hooks should stop restarting the agent loop.
 *
 * Composable with `.or()` and `.and()` methods.
 */
export abstract class TerminationCondition {
  /** Return true to allow the agent to stop (no more restarts). */
  abstract shouldTerminate(context: LoopContext): boolean;

  /** Reset state for a new agent run. */
  reset(): void {
    // No-op by default
  }

  /** Combine with OR — terminate if EITHER condition is met. */
  or(other: TerminationCondition): CompositeTermination {
    return new CompositeTermination([this, other], "any");
  }

  /** Combine with AND — terminate only if BOTH conditions are met. */
  and(other: TerminationCondition): CompositeTermination {
    return new CompositeTermination([this, other], "all");
  }
}

/**
 * Terminate after a maximum number of loop restarts.
 */
export class MaxRestartsTermination extends TerminationCondition {
  maxRestarts: number;

  constructor(maxRestarts = 2) {
    super();
    this.maxRestarts = maxRestarts;
  }

  shouldTerminate(context: LoopContext): boolean {
    return context.restartCount >= this.maxRestarts;
  }
}

/**
 * Combines multiple termination conditions with AND/OR logic.
 */
export class CompositeTermination extends TerminationCondition {
  conditions: TerminationCondition[];
  mode: "any" | "all";

  constructor(
    conditions: TerminationCondition[],
    mode: "any" | "all" = "any"
  ) {
    super();
    this.conditions = conditions;
    this.mode = mode;
  }

  shouldTerminate(context: LoopContext): boolean {
    const results = this.conditions.map((c) => c.shouldTerminate(context));
    return this.mode === "any" ? results.some(Boolean) : results.every(Boolean);
  }

  override reset(): void {
    for (const c of this.conditions) {
      c.reset();
    }
  }

  override or(other: TerminationCondition): CompositeTermination {
    if (this.mode === "any") {
      // Flatten: (A | B) | C = A | B | C
      if (other instanceof CompositeTermination && other.mode === "any") {
        return new CompositeTermination(
          [...this.conditions, ...other.conditions],
          "any"
        );
      }
      return new CompositeTermination([...this.conditions, other], "any");
    }
    return new CompositeTermination([this, other], "any");
  }

  override and(other: TerminationCondition): CompositeTermination {
    if (this.mode === "all") {
      if (other instanceof CompositeTermination && other.mode === "all") {
        return new CompositeTermination(
          [...this.conditions, ...other.conditions],
          "all"
        );
      }
      return new CompositeTermination([...this.conditions, other], "all");
    }
    return new CompositeTermination([this, other], "all");
  }
}

// ==========================================================================
// Base Hook Classes
// ==========================================================================

/**
 * Base class for hooks that run before the first LLM call.
 *
 * Return a string to inject as a UserMessage, or undefined for no injection.
 */
export abstract class BaseStartHook {
  abstract onStart(context: LoopContext): Promise<string | undefined>;
}

/**
 * Base class for hooks that run when the agent would stop.
 *
 * Return a string to inject as a UserMessage and RESUME the loop,
 * or undefined to allow the agent to stop.
 */
export abstract class BaseEndHook {
  abstract onEnd(context: LoopContext): Promise<string | undefined>;
}

// ==========================================================================
// Concrete Implementations
// ==========================================================================

/**
 * Start hook that injects a planning instruction before the first LLM call.
 */
export class PlanningHook extends BaseStartHook {
  instruction: string;

  constructor(instruction?: string) {
    super();
    this.instruction =
      instruction ??
      [
        "Before starting any work, you MUST:",
        "1. Analyze the task and break it into clear, actionable steps",
        "2. Use the todo_write tool to create a structured task list",
        '3. Each todo needs: content (what to do), status (\'pending\'), activeForm (present tense)',
        "4. Mark the first task as 'in_progress' before starting it",
        "5. Only ONE task should be 'in_progress' at a time",
        "",
        "As you work, update the todo list: mark tasks 'completed' when done, set the next task to 'in_progress'.",
      ].join("\n");
  }

  async onStart(_context: LoopContext): Promise<string | undefined> {
    return this.instruction;
  }
}

/**
 * End hook that checks for incomplete tasks before allowing the agent to stop.
 */
export class CompletionCheckHook extends BaseEndHook {
  termination: TerminationCondition;

  constructor(options?: {
    termination?: TerminationCondition;
    maxRestarts?: number;
  }) {
    super();
    this.termination =
      options?.termination ??
      new MaxRestartsTermination(options?.maxRestarts ?? 2);
  }

  async onEnd(context: LoopContext): Promise<string | undefined> {
    // Check termination condition first
    if (this.termination.shouldTerminate(context)) {
      return undefined; // Allow stop
    }

    // Check metadata for incomplete tasks
    const todos = (context.metadata.todos as Array<{
      status?: string;
      content?: string;
    }>) ?? [];

    if (todos.length === 0) {
      return undefined; // No todos = nothing to check
    }

    const incomplete = todos.filter((t) => t.status !== "completed");
    if (incomplete.length === 0) {
      return undefined; // All done
    }

    const total = todos.length;
    const completed = total - incomplete.length;
    const items = incomplete
      .map(
        (t) =>
          `  - [${t.status ?? "pending"}] ${t.content ?? ""}`
      )
      .join("\n");

    return (
      `You have ${incomplete.length} incomplete tasks ` +
      `(${completed}/${total} completed):\n${items}\n\n` +
      `Continue working on the next pending task. ` +
      `Update the todo list as you make progress. ` +
      `Do not ask for user input - proceed autonomously.`
    );
  }
}
