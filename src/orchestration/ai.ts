/**
 * AI-driven conversation orchestration pattern.
 *
 * Uses LLM reasoning with structured output to select the most appropriate
 * next agent based on conversation context and agent capabilities.
 */

import { z } from "zod";
import type { BaseAgent } from "../agents/base.js";
import type { BaseChatCompletionClient } from "../llm/base.js";
import type { Message } from "../messages.js";
import type { BaseTermination } from "../termination/base.js";
import type { AgentResponse } from "../types.js";
import { BaseOrchestrator } from "./base.js";

// ---------------------------------------------------------------------------
// Structured output schemas
// ---------------------------------------------------------------------------

export const AgentSelectionSchema = z.object({
  selectedAgent: z.string().describe("Name of the selected agent"),
  reasoning: z
    .string()
    .describe("Explanation for why this agent was chosen"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Confidence in selection (0.0-1.0)"),
});

export type AgentSelection = z.infer<typeof AgentSelectionSchema>;

// ---------------------------------------------------------------------------
// AIOrchestrator
// ---------------------------------------------------------------------------

/**
 * AI-driven orchestrator that uses an LLM to select the best agent
 * for each iteration based on conversation context.
 */
export class AIOrchestrator extends BaseOrchestrator {
  modelClient: BaseChatCompletionClient;
  selectionHistory: Array<Record<string, unknown>> = [];
  private agentCapabilitiesCache: string | null = null;

  constructor(
    agents: BaseAgent[],
    termination: BaseTermination,
    modelClient: BaseChatCompletionClient,
    maxIterations = 50
  ) {
    super({ agents, termination, maxIterations });
    this.modelClient = modelClient;
  }

  async selectNextAgent(): Promise<BaseAgent> {
    const capabilities = this._getCachedCapabilities();
    const conversationContext = this._formatConversationForSelection();

    const selectionPrompt = `You are coordinating a team of AI agents working collaboratively on a task.

Available agents and their capabilities:
${capabilities}

Recent conversation history:
${conversationContext}

Based on the conversation context and each agent's specific capabilities, choose which agent should respond next to move the conversation or task forward. Consider:
- What type of response is needed right now?
- Which agent's skills/tools best match the current need?
- Natural flow of the conversation
- Avoiding repetitive selections unless justified

Select the most appropriate agent and explain your reasoning. Your reason should be a single clean and clear line.`;

    const messages: Message[] = [
      {
        role: "user" as const,
        content: selectionPrompt,
        source: "orchestrator",
        timestamp: new Date(),
      },
    ];

    let selectedName: string;
    let reasoning: string;
    let confidence: number;

    try {
      const result = await this.modelClient.create(messages, {
        outputSchema: AgentSelectionSchema as unknown as Record<string, unknown>,
      });

      if (result.structuredOutput) {
        const selection = result.structuredOutput as AgentSelection;
        selectedName = selection.selectedAgent;
        reasoning = selection.reasoning;
        confidence = selection.confidence;
      } else {
        selectedName = this._extractAgentNameFromText(
          result.message.content
        );
        reasoning = "Fallback selection due to parsing error";
        confidence = 0.5;
      }
    } catch (e) {
      console.warn(`Agent selection LLM call failed: ${e}`);
      selectedName = this._getFallbackAgentName();
      reasoning = `Fallback due to LLM error: ${String(e)}`;
      confidence = 0.1;
    }

    const selectedAgent = this._findAgentByName(selectedName);

    this.selectionHistory.push({
      selectedAgent: selectedAgent.name,
      iteration: this.iterationCount,
      reasoning,
      confidence,
      conversationLength: this.sharedMessages.length,
    });

    return selectedAgent;
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
    const newMessages = messages.length > 1 ? messages.slice(1) : [];
    this.sharedMessages.push(...newMessages);
  }

  override getAgentCapabilitiesSummary(): string {
    return this._getCachedCapabilities();
  }

  protected override _getPatternMetadata(): Record<string, unknown> {
    const base = super._getPatternMetadata();

    const uniqueAgents = new Set(
      this.selectionHistory.map(
        (s) => s.selectedAgent as string
      )
    );
    const avgConfidence = this.selectionHistory.length > 0
      ? this.selectionHistory.reduce(
          (sum, s) => sum + (s.confidence as number),
          0
        ) / this.selectionHistory.length
      : 0;

    return {
      ...base,
      selectionHistory: this.selectionHistory.map((s) => ({
        agent: s.selectedAgent,
        iteration: s.iteration,
        confidence: s.confidence,
      })),
      uniqueAgentsSelected: uniqueAgents.size,
      agentDiversity: this.agents.length > 0
        ? uniqueAgents.size / this.agents.length
        : 0,
      averageConfidence: Math.round(avgConfidence * 1000) / 1000,
      modelUsed: this.modelClient.model,
    };
  }

  protected override _resetForRun(): void {
    super._resetForRun();
    this.selectionHistory = [];
    this.agentCapabilitiesCache = null;
  }

  // Helper methods

  private _getCachedCapabilities(): string {
    if (this.agentCapabilitiesCache === null) {
      const lines = this.agents.map((agent) => {
        let line = `\u2022 ${agent.name}: ${agent.description}`;
        if (agent.tools && agent.tools.length > 0) {
          const toolNames = agent.tools.map((t) => t.name);
          line += ` | Tools: ${toolNames.join(", ")}`;
        }
        return line;
      });
      this.agentCapabilitiesCache = lines.join("\n");
    }
    return this.agentCapabilitiesCache;
  }

  private _findAgentByName(name: string): BaseAgent {
    const nameLower = name.toLowerCase().trim();

    // Exact match first
    for (const agent of this.agents) {
      if (agent.name.toLowerCase() === nameLower) {
        return agent;
      }
    }

    // Partial match fallback
    for (const agent of this.agents) {
      if (
        nameLower.includes(agent.name.toLowerCase()) ||
        agent.name.toLowerCase().includes(nameLower)
      ) {
        return agent;
      }
    }

    // No match found — return first agent
    console.warn(
      `Agent '${name}' not found, using fallback: ${this.agents[0].name}`
    );
    return this.agents[0];
  }

  private _formatConversationForSelection(): string {
    if (this.sharedMessages.length === 0) {
      return "No conversation yet.";
    }

    let context = "History so far:\n\n";
    for (const msg of this.sharedMessages) {
      context += `[${msg.source}] ${msg.content}\n`;
    }
    return context;
  }

  private _extractAgentNameFromText(text: string): string {
    const textLower = text.toLowerCase();
    for (const agent of this.agents) {
      if (textLower.includes(agent.name.toLowerCase())) {
        return agent.name;
      }
    }
    return this.agents[0].name;
  }

  private _getFallbackAgentName(): string {
    if (this.selectionHistory.length > 0) {
      const lastAgentName = this.selectionHistory[
        this.selectionHistory.length - 1
      ].selectedAgent as string;
      const agentNames = this.agents.map((a) => a.name);
      const lastIndex = agentNames.indexOf(lastAgentName);
      if (lastIndex >= 0) {
        return agentNames[(lastIndex + 1) % agentNames.length];
      }
    }
    return this.agents[0].name;
  }
}
