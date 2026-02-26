/**
 * AgentAsTool — wraps any agent to expose it as a tool for other agents.
 *
 * Enables hierarchical composition where specialized agents can be
 * used as tools by higher-level coordinating agents.
 */

import type { Message } from "../messages.js";
import { BaseTool } from "../tools/base.js";
import type { ToolResult, AgentResponse } from "../types.js";
import type { BaseAgent } from "./base.js";

export type ResultStrategy = string | ((msgs: Message[]) => string);

export class AgentAsTool extends BaseTool {
  agent: BaseAgent;
  taskParameterName: string;
  resultStrategy: ResultStrategy;

  constructor(
    agent: BaseAgent,
    taskParameterName = "task",
    resultStrategy: ResultStrategy = "last"
  ) {
    super(agent.name, agent.description);
    this.agent = agent;
    this.taskParameterName = taskParameterName;
    this.resultStrategy = resultStrategy;
    this.validateResultStrategy();
  }

  private validateResultStrategy(): void {
    if (typeof this.resultStrategy === "function") return;
    if (typeof this.resultStrategy !== "string") {
      throw new TypeError("resultStrategy must be a string or function");
    }

    if (
      this.resultStrategy === "all" ||
      this.resultStrategy === "last"
    )
      return;

    if (this.resultStrategy.startsWith("last:")) {
      const n = parseInt(this.resultStrategy.split(":")[1], 10);
      if (isNaN(n) || n <= 0) {
        throw new Error(
          `Invalid result_strategy format: ${this.resultStrategy}. Expected 'last:N' where N is a positive integer`
        );
      }
    } else {
      throw new Error(
        `Unknown result_strategy: ${this.resultStrategy}. Expected 'last', 'last:N', 'all', or a callable`
      );
    }
  }

  extractResult(messages: Message[]): string {
    if (messages.length === 0) return "";

    if (typeof this.resultStrategy === "function") {
      return this.resultStrategy(messages);
    }

    if (this.resultStrategy === "last") {
      return messages[messages.length - 1].content;
    }
    if (this.resultStrategy === "all") {
      return messages.map((m) => m.content).join("\n");
    }
    if (this.resultStrategy.startsWith("last:")) {
      const n = parseInt(this.resultStrategy.split(":")[1], 10);
      return messages
        .slice(-n)
        .map((m) => m.content)
        .join("\n");
    }
    return messages[messages.length - 1].content;
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        [this.taskParameterName]: {
          type: "string",
          description: `Task for ${this.agent.name} to complete`,
        },
      },
      required: [this.taskParameterName],
    };
  }

  async execute(
    params: Record<string, unknown>
  ): Promise<ToolResult> {
    const task = (params[this.taskParameterName] as string) ?? "";

    try {
      const response = await this.agent.run(task);

      const messages = response.context?.messages ?? [];
      const finalContent = this.extractResult(messages);

      return {
        success: true,
        result: finalContent,
        metadata: {
          agentName: this.agent.name,
          messageCount: messages.length,
        },
      };
    } catch (e) {
      return {
        success: false,
        result: "",
        error: `Agent execution failed: ${(e as Error).message}`,
        metadata: { agentName: this.agent.name },
      };
    }
  }
}
