/**
 * External termination condition.
 */

import type { Message } from "../messages.js";
import type { StopMessage } from "./base.js";
import { BaseTermination } from "./base.js";

/**
 * Terminates based on an external callback signal.
 */
export class ExternalTermination extends BaseTermination {
  constructor(public readonly checkCallback: () => boolean) {
    super();
  }

  check(_newMessages: Message[]): StopMessage | null {
    try {
      if (this.checkCallback()) {
        return this._setTermination("External termination signal received", {
          source: "external_callback",
        });
      }
    } catch {
      // Don't let callback errors stop orchestration
    }

    return null;
  }
}
