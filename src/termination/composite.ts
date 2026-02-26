/**
 * Composite termination condition for combining multiple conditions.
 */

import type { Message } from "../messages.js";
import type { StopMessage } from "./base.js";
import { BaseTermination } from "./base.js";

/**
 * Combines multiple termination conditions with logical operators.
 *
 * - mode "any": triggers when ANY condition is met (OR logic)
 * - mode "all": triggers when ALL conditions are met (AND logic)
 */
export class CompositeTermination extends BaseTermination {
  constructor(
    public readonly conditions: BaseTermination[],
    public readonly mode: "any" | "all" = "any"
  ) {
    super();
    if (mode !== "any" && mode !== "all") {
      throw new Error("Mode must be 'any' or 'all'");
    }
  }

  check(newMessages: Message[]): StopMessage | null {
    const results: StopMessage[] = [];

    for (const condition of this.conditions) {
      const result = condition.check(newMessages);
      if (result) {
        results.push(result);
      }
    }

    if (this.mode === "any" && results.length > 0) {
      // Return first termination result
      const firstResult = results[0];
      return this._setTermination(
        `Composite (any): ${firstResult.content}`,
        {
          mode: "any",
          triggeredConditions: results.map((r) => r.source),
        }
      );
    } else if (
      this.mode === "all" &&
      results.length === this.conditions.length
    ) {
      // All conditions met
      const reasons = results.map((r) => r.content);
      return this._setTermination(
        `Composite (all): ${reasons.join("; ")}`,
        {
          mode: "all",
          triggeredConditions: results.map((r) => r.source),
        }
      );
    }

    return null;
  }

  reset(): void {
    super.reset();
    for (const condition of this.conditions) {
      condition.reset();
    }
  }

  isMet(): boolean {
    const metConditions = this.conditions.map((c) => c.isMet());

    if (this.mode === "any") {
      return metConditions.some(Boolean);
    } else {
      return metConditions.every(Boolean);
    }
  }

  /**
   * Extend OR composition — flattens same-mode composites.
   */
  or(other: BaseTermination): CompositeTermination {
    if (other instanceof CompositeTermination && other.mode === "any") {
      return new CompositeTermination(
        [...this.conditions, ...other.conditions],
        "any"
      );
    }
    return new CompositeTermination([...this.conditions, other], "any");
  }

  /**
   * Extend AND composition — flattens same-mode composites.
   */
  and(other: BaseTermination): CompositeTermination {
    if (other instanceof CompositeTermination && other.mode === "all") {
      return new CompositeTermination(
        [...this.conditions, ...other.conditions],
        "all"
      );
    }
    return new CompositeTermination([...this.conditions, other], "all");
  }
}

// Register the composite factory on BaseTermination to avoid circular import issues
BaseTermination._compositeFactory = (
  conditions: BaseTermination[],
  mode: "any" | "all"
) => new CompositeTermination(conditions, mode);
