/**
 * PicoAgent step — wraps a BaseAgent to run inside a workflow.
 */

import { type StepMetadata, type WorkflowContext } from "../core/models.js";
import { BaseStep } from "./base-step.js";
import type { BaseAgent } from "../../agents/base.js";

export interface PicoAgentInput {
  task: string;
  additionalContext?: Record<string, unknown>;
}

export interface PicoAgentOutput {
  response: string;
  messages: Record<string, unknown>[];
  usage: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export class PicoAgentStep extends BaseStep<PicoAgentInput, PicoAgentOutput> {
  agent: BaseAgent;

  constructor(stepId: string, metadata: StepMetadata, agent: BaseAgent) {
    super(stepId, metadata, "PicoAgentInput", "PicoAgentOutput");
    this.agent = agent;
  }

  async execute(
    inputData: PicoAgentInput,
    context: WorkflowContext
  ): Promise<PicoAgentOutput> {
    // Store request info
    context.set(`${this.stepId}_request_info`, {
      agentName: this.agent.name,
      task: inputData.task,
      timestamp: new Date().toISOString(),
      additionalContext: inputData.additionalContext,
    });

    try {
      const agentResult = await this.agent.run(inputData.task);

      // Extract final response from context messages
      let finalResponse = "";
      const contextMessages = agentResult.context?.messages ?? [];

      for (let i = contextMessages.length - 1; i >= 0; i--) {
        if (contextMessages[i].role === "assistant") {
          finalResponse = contextMessages[i].content;
          break;
        }
      }
      if (!finalResponse && contextMessages.length > 0) {
        finalResponse = contextMessages[contextMessages.length - 1].content;
      }
      if (!finalResponse) {
        finalResponse = "No response generated";
      }

      // Serialize messages
      const serializedMessages = contextMessages.map((msg) => ({
        role: msg.role,
        content: msg.content,
        source: msg.source,
        timestamp: msg.timestamp?.toISOString?.() ?? null,
      }));

      const usageDict = {
        durationMs: agentResult.usage.durationMs,
        llmCalls: agentResult.usage.llmCalls,
        tokensInput: agentResult.usage.tokensInput,
        tokensOutput: agentResult.usage.tokensOutput,
        toolCalls: agentResult.usage.toolCalls,
        memoryOperations: agentResult.usage.memoryOperations,
      };

      const executionMetadata = {
        agentName: this.agent.name,
        messageCount: contextMessages.length,
        elapsedTime: agentResult.usage.durationMs / 1000,
        llmCalls: agentResult.usage.llmCalls,
        tokensTotal:
          agentResult.usage.tokensInput + agentResult.usage.tokensOutput,
        executionTimestamp: new Date().toISOString(),
      };

      context.set(`${this.stepId}_output`, {
        response: finalResponse,
        messages: serializedMessages,
        usage: usageDict,
        metadata: executionMetadata,
      });

      return {
        response: finalResponse,
        messages: serializedMessages,
        usage: usageDict,
        metadata: executionMetadata,
      };
    } catch (e) {
      const errorMsg = `PicoAgent execution failed: ${(e as Error).message}`;

      context.set(`${this.stepId}_error`, {
        error: errorMsg,
        timestamp: new Date().toISOString(),
      });

      return {
        response: `Error: ${errorMsg}`,
        messages: [],
        usage: {},
        metadata: {
          agentName: this.agent.name,
          error: errorMsg,
          executionTimestamp: new Date().toISOString(),
        },
      };
    }
  }
}
