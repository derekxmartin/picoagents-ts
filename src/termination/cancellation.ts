/**
 * Cancellation termination condition.
 */

import type { CancellationToken } from "../cancellation-token.js";
import type { Message } from "../messages.js";
import type { StopMessage } from "./base.js";
import { BaseTermination } from "./base.js";

/**
 * Terminates when a cancellation token is triggered.
 */
export class CancellationTermination extends BaseTermination {
  constructor(public readonly cancellationToken: CancellationToken) {
    super();
  }

  check(_newMessages: Message[]): StopMessage | null {
    if (this.cancellationToken.isCancelled()) {
      return this._setTermination("Cancellation token triggered", {
        source: "cancellation_token",
      });
    }

    return null;
  }
}
