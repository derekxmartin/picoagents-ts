/**
 * Handoff termination condition.
 */

import type { Message } from "../messages.js";
import type { StopMessage } from "./base.js";
import { BaseTermination } from "./base.js";

/**
 * Terminates when an agent requests handoff to a specific target.
 * Scans assistant messages for handoff patterns like "handoff to X",
 * "transfer to X", "pass to X", "delegate to X".
 */
export class HandoffTermination extends BaseTermination {
  constructor(public readonly target: string) {
    super();
  }

  check(newMessages: Message[]): StopMessage | null {
    for (const message of newMessages) {
      if (message.role === "assistant") {
        const contentLower = message.content.toLowerCase();
        const targetLower = this.target.toLowerCase();

        const handoffPatterns = [
          `handoff to ${targetLower}`,
          `transfer to ${targetLower}`,
          `pass to ${targetLower}`,
          `delegate to ${targetLower}`,
        ];

        for (const pattern of handoffPatterns) {
          if (contentLower.includes(pattern)) {
            return this._setTermination(
              `Handoff requested to '${this.target}'`,
              { target: this.target, pattern }
            );
          }
        }
      }
    }

    return null;
  }
}
