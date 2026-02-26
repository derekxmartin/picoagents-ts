/**
 * Maximum message termination condition.
 */

import type { Message } from "../messages.js";
import type { StopMessage } from "./base.js";
import { BaseTermination } from "./base.js";

/**
 * Terminates when the total number of messages reaches or exceeds a threshold.
 */
export class MaxMessageTermination extends BaseTermination {
  public messageCount = 0;

  constructor(public readonly maxMessages: number) {
    super();
  }

  check(newMessages: Message[]): StopMessage | null {
    this.messageCount += newMessages.length;

    if (this.messageCount >= this.maxMessages) {
      return this._setTermination(
        `Maximum messages reached (${this.messageCount}/${this.maxMessages})`,
        {
          messageCount: this.messageCount,
          maxMessages: this.maxMessages,
        }
      );
    }

    return null;
  }

  reset(): void {
    super.reset();
    this.messageCount = 0;
  }
}
