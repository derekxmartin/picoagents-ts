/**
 * Timeout termination condition.
 */

import type { Message } from "../messages.js";
import type { StopMessage } from "./base.js";
import { BaseTermination } from "./base.js";

/**
 * Terminates when a time limit is exceeded.
 */
export class TimeoutTermination extends BaseTermination {
  private startTime: number | null;

  constructor(public readonly maxDurationSeconds: number) {
    super();
    this.startTime = Date.now() / 1000;
  }

  check(_newMessages: Message[]): StopMessage | null {
    if (this.startTime === null) {
      this.startTime = Date.now() / 1000;
      return null;
    }

    const elapsed = Date.now() / 1000 - this.startTime;

    if (elapsed >= this.maxDurationSeconds) {
      return this._setTermination(
        `Timeout reached (${elapsed.toFixed(1)}s/${this.maxDurationSeconds}s)`,
        {
          elapsedSeconds: elapsed,
          maxDurationSeconds: this.maxDurationSeconds,
        }
      );
    }

    return null;
  }

  reset(): void {
    super.reset();
    this.startTime = Date.now() / 1000;
  }
}
