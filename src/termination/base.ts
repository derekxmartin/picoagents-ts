/**
 * Base termination condition for orchestration.
 *
 * Distinct from the hooks.ts TerminationCondition (which controls agent-loop restarts).
 * These termination conditions operate on message streams and are used by orchestrators
 * to decide when multi-agent coordination should stop.
 */

import type { Message } from "../messages.js";

// ---------------------------------------------------------------------------
// StopMessage
// ---------------------------------------------------------------------------

/**
 * Information about why orchestration stopped.
 */
export interface StopMessage {
  /** Human-readable reason for stopping. */
  content: string;
  /** What caused the stop (termination condition class name). */
  source: string;
  /** Additional metadata about the termination. */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// BaseTermination
// ---------------------------------------------------------------------------

/**
 * Abstract base class for all orchestration termination conditions.
 *
 * Subclasses implement `check(newMessages)` which returns a StopMessage
 * when the condition is met, or null otherwise.
 *
 * Use CompositeTermination directly, or the static `BaseTermination.any()`
 * and `BaseTermination.all()` helpers for combining conditions.
 */
export abstract class BaseTermination {
  protected _met = false;
  protected _reason = "";
  protected _metadata: Record<string, unknown> = {};

  /**
   * Check termination on delta messages.
   *
   * @param newMessages - New messages since last check
   * @returns StopMessage if termination is met, null otherwise
   */
  abstract check(newMessages: Message[]): StopMessage | null;

  /** Current termination state. */
  isMet(): boolean {
    return this._met;
  }

  /** Reset for next orchestration run. */
  reset(): void {
    this._met = false;
    this._reason = "";
    this._metadata = {};
  }

  /** Why termination occurred. */
  getReason(): string {
    return this._reason;
  }

  /** Additional termination metadata. */
  getMetadata(): Record<string, unknown> {
    return { ...this._metadata };
  }

  /**
   * Helper to set termination state and return StopMessage.
   */
  protected _setTermination(
    reason: string,
    metadata?: Record<string, unknown>
  ): StopMessage {
    this._met = true;
    this._reason = reason;
    this._metadata = metadata ?? {};

    return {
      content: reason,
      source: this.constructor.name,
      metadata: this._metadata,
    };
  }

  /**
   * Combine with another condition using OR logic (any triggers stop).
   * Uses the _compositeFactory which is set by the composite module to avoid circular imports.
   */
  or(other: BaseTermination): BaseTermination {
    return BaseTermination._compositeFactory([this, other], "any");
  }

  /**
   * Combine with another condition using AND logic (all must trigger).
   */
  and(other: BaseTermination): BaseTermination {
    return BaseTermination._compositeFactory([this, other], "all");
  }

  /**
   * @internal Factory function set by composite.ts to avoid circular imports.
   */
  static _compositeFactory: (
    conditions: BaseTermination[],
    mode: "any" | "all"
  ) => BaseTermination;
}
