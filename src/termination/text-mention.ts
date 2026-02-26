/**
 * Text mention termination condition.
 */

import type { Message } from "../messages.js";
import type { StopMessage } from "./base.js";
import { BaseTermination } from "./base.js";

/**
 * Terminates when specific text is mentioned in any message.
 */
export class TextMentionTermination extends BaseTermination {
  private readonly searchText: string;

  constructor(
    public readonly text: string,
    public readonly caseSensitive: boolean = false
  ) {
    super();
    this.searchText = caseSensitive ? text : text.toLowerCase();
  }

  check(newMessages: Message[]): StopMessage | null {
    for (const message of newMessages) {
      const content = this.caseSensitive
        ? message.content
        : message.content.toLowerCase();

      if (content.includes(this.searchText)) {
        return this._setTermination(`Text mention found: '${this.text}'`, {
          text: this.text,
          caseSensitive: this.caseSensitive,
          foundIn: message.role,
        });
      }
    }

    return null;
  }
}
