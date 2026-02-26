/**
 * Function call termination condition.
 */

import type { Message } from "../messages.js";
import type { StopMessage } from "./base.js";
import { BaseTermination } from "./base.js";

/**
 * Terminates when a specific function/tool is called.
 */
export class FunctionCallTermination extends BaseTermination {
  constructor(public readonly functionName: string) {
    super();
  }

  check(newMessages: Message[]): StopMessage | null {
    for (const message of newMessages) {
      if (
        message.role === "tool" &&
        "toolName" in message &&
        (message as { toolName: string }).toolName === this.functionName
      ) {
        return this._setTermination(
          `Function '${this.functionName}' was called`,
          {
            functionName: this.functionName,
            success: (message as { success: boolean }).success,
          }
        );
      }
    }

    return null;
  }
}
