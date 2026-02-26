/**
 * Round-robin orchestration pattern.
 *
 * Cycles through agents in fixed order, giving each agent access to
 * the complete shared conversation history.
 */

import type { BaseAgent } from "../agents/base.js";
import type { Message } from "../messages.js";
import type { BaseTermination } from "../termination/base.js";
import type { AgentResponse } from "../types.js";
import { BaseOrchestrator } from "./base.js";

/**
 * Round-robin orchestrator that cycles through agents in fixed order.
 */
export class RoundRobinOrchestrator extends BaseOrchestrator {
  private currentAgentIndex = 0;

  constructor(
    agents: BaseAgent[],
    termination: BaseTermination,
    maxIterations = 50
  ) {
    super({ agents, termination, maxIterations });
  }

  async selectNextAgent(): Promise<BaseAgent> {
    const agent = this.agents[this.currentAgentIndex];
    this.currentAgentIndex =
      (this.currentAgentIndex + 1) % this.agents.length;
    return agent;
  }

  async prepareContextForAgent(_agent: BaseAgent): Promise<string> {
    if (this.sharedMessages.length === 0) {
      return "You are part of a team taking turns to collaboratively addressing a task. It is now your turn. ";
    }

    let context =
      "You are part of a team taking turns to collaboratively addressing a task. Here's the progress/history so far:\n\n";
    for (const msg of this.sharedMessages) {
      context += `[${msg.source}] ${msg.content}\n`;
    }
    context += "\nIt is now your turn.";
    return context;
  }

  async updateSharedState(result: AgentResponse): Promise<void> {
    const messages = result.context?.messages ?? [];
    // Skip the context message we sent, add agent's actual responses
    const newMessages = messages.length > 1 ? messages.slice(1) : [];
    this.sharedMessages.push(...newMessages);
  }

  protected override _getPatternMetadata(): Record<string, unknown> {
    const base = super._getPatternMetadata();
    return {
      ...base,
      cyclesCompleted: Math.floor(
        this.iterationCount / this.agents.length
      ),
      currentAgentIndex: this.currentAgentIndex,
      agentsOrder: this.agents.map((a) => a.name),
    };
  }

  protected override _resetForRun(): void {
    super._resetForRun();
    this.currentAgentIndex = 0;
  }
}
