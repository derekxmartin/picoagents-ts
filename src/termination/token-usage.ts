/**
 * Token usage termination condition.
 */

import type { Message } from "../messages.js";
import type { StopMessage } from "./base.js";
import { BaseTermination } from "./base.js";

/**
 * Terminates when approximate token usage exceeds a limit.
 * Uses a simple estimate of ~4 characters per token.
 */
export class TokenUsageTermination extends BaseTermination {
  public totalTokens = 0;

  constructor(public readonly maxTokens: number) {
    super();
  }

  check(newMessages: Message[]): StopMessage | null {
    // Simple token estimation: ~4 characters per token
    const newTokens = newMessages.reduce(
      (sum, msg) => sum + Math.floor(msg.content.length / 4),
      0
    );
    this.totalTokens += newTokens;

    if (this.totalTokens >= this.maxTokens) {
      return this._setTermination(
        `Token limit exceeded (${this.totalTokens}/${this.maxTokens})`,
        { totalTokens: this.totalTokens, maxTokens: this.maxTokens }
      );
    }

    return null;
  }

  reset(): void {
    super.reset();
    this.totalTokens = 0;
  }
}
