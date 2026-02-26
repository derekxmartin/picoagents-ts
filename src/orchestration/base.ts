/**
 * Base orchestrator implementation.
 *
 * Provides the foundational BaseOrchestrator class with the universal
 * orchestration loop shared by all patterns.
 */

import type { CancellationToken } from "../cancellation-token.js";
import { CancelledError } from "../cancellation-token.js";
import type { BaseAgent } from "../agents/base.js";
import type { Message, UserMessage } from "../messages.js";
import type { BaseTermination, StopMessage } from "../termination/base.js";
import type {
  AgentResponse,
  AgentEvent,
  ChatCompletionChunk,
  Usage,
  OrchestrationResponse,
  OrchestrationEvent,
} from "../types.js";
import { addUsage } from "../types.js";

// ---------------------------------------------------------------------------
// BaseOrchestrator
// ---------------------------------------------------------------------------

/**
 * Abstract base class for all orchestration patterns.
 *
 * Defines the core orchestration interface and universal orchestration loop.
 */
export abstract class BaseOrchestrator {
  agents: BaseAgent[];
  termination: BaseTermination;
  maxIterations: number;
  name: string;
  description?: string;
  exampleTasks: string[];

  // Runtime state
  sharedMessages: Message[] = [];
  iterationCount = 0;
  startTime: number | null = null;
  private _lastTerminationCheckCount = 0;

  constructor(options: {
    agents: BaseAgent[];
    termination: BaseTermination;
    maxIterations?: number;
    name?: string;
    description?: string;
    exampleTasks?: string[];
  }) {
    if (!options.agents || options.agents.length === 0) {
      throw new Error("At least one agent is required");
    }

    this.agents = [...options.agents];
    this.termination = options.termination;
    this.maxIterations = options.maxIterations ?? 50;
    this.name = options.name ?? this.constructor.name;
    this.description = options.description;
    this.exampleTasks = options.exampleTasks ?? [];

    // Validate agent names are unique
    const names = options.agents.map((a) => a.name);
    if (new Set(names).size !== names.length) {
      throw new Error("Agent names must be unique");
    }
  }

  /**
   * Execute the orchestration pattern.
   */
  async run(
    task: string | Message | Message[],
    cancellationToken?: CancellationToken
  ): Promise<OrchestrationResponse> {
    this._resetForRun();

    let finalResult: OrchestrationResponse | null = null;

    try {
      for await (const item of this.runStream(task, cancellationToken)) {
        if (this._isOrchestrationResponse(item)) {
          finalResult = item as OrchestrationResponse;
        }
      }

      return finalResult ?? this._createFallbackResult("No result produced");
    } catch (e) {
      if (e instanceof CancelledError) {
        throw e;
      }
      const elapsed = Math.round(
        (Date.now() - (this.startTime ?? Date.now()))
      );
      return {
        messages: this.sharedMessages,
        finalResult: `Orchestration failed: ${String(e)}`,
        usage: this._emptyUsage(elapsed),
        stopMessage: {
          content: `Error: ${String(e)}`,
          source: "Exception",
        },
        patternMetadata: this._getPatternMetadata(),
      };
    }
  }

  /**
   * Execute orchestration with streaming output.
   */
  async *runStream(
    task: string | Message | Message[],
    cancellationToken?: CancellationToken,
    verbose = false
  ): AsyncGenerator<
    Message | OrchestrationEvent | OrchestrationResponse,
    void,
    undefined
  > {
    this._resetForRun();
    this.startTime = Date.now();

    let stopMessage: StopMessage | null = null;
    const streamedMessages: Message[] = [];
    this._lastTerminationCheckCount = 0;
    const agentUsageStats: Usage[] = [];

    try {
      // Emit orchestration start event
      if (verbose) {
        yield {
          eventType: "orchestration_start" as const,
          timestamp: new Date(),
          source: "orchestrator",
          task: String(task),
          pattern: this.constructor.name,
        };
      }

      // Normalize task to initial messages
      const initialMessages = this._normalizeTaskToMessages(task);
      this.sharedMessages.push(...initialMessages);

      // Yield initial messages
      for (const message of initialMessages) {
        yield message;
        streamedMessages.push(message);
      }

      // Initialize termination with initial messages
      this.termination.check(initialMessages);
      this._lastTerminationCheckCount = streamedMessages.length;

      // Universal orchestration loop
      while (this.iterationCount < this.maxIterations) {
        // Check for cancellation
        if (cancellationToken?.isCancelled()) {
          throw new CancelledError();
        }

        // Check termination BEFORE processing next agent (but not on first iteration)
        if (this.iterationCount > 0 && this.termination.isMet()) {
          stopMessage = {
            content: this.termination.getReason(),
            source: this.termination.constructor.name,
            metadata: this.termination.getMetadata(),
          };
          break;
        }

        // 1. Select next agent (pattern-specific logic)
        const nextAgent = await this.selectNextAgent();

        if (verbose) {
          yield {
            eventType: "agent_selection" as const,
            timestamp: new Date(),
            source: "orchestrator",
            selectedAgent: nextAgent.name,
            selectionReason: `Iteration ${this.iterationCount + 1}`,
          };
        }

        // 2. Prepare context for agent (pattern-specific)
        const context = await this.prepareContextForAgent(nextAgent);

        if (verbose) {
          const contextSize = Array.isArray(context) ? context.length : 1;
          yield {
            eventType: "agent_execution_start" as const,
            timestamp: new Date(),
            source: "orchestrator",
            executingAgent: nextAgent.name,
            contextSize,
          };
        }

        // 3. Execute agent with streaming
        const agentMessages: Message[] = [];
        let result: AgentResponse | null = null;

        try {
          for await (const item of nextAgent.runStream(
            context as string | Message[],
            undefined, // AgentContext
            cancellationToken
          )) {
            // Check for cancellation during agent execution
            if (cancellationToken?.isCancelled()) {
              throw new CancelledError();
            }

            if (this._isMessage(item)) {
              agentMessages.push(item as Message);

              // Don't stream UserMessages - they're just context we sent
              if ((item as Message).role !== "user") {
                yield item as Message;
                streamedMessages.push(item as Message);
              }
            } else if (this._isAgentResponse(item)) {
              result = item as AgentResponse;
            }
            // Other agent events are not forwarded
          }
        } catch (e) {
          if (e instanceof CancelledError) {
            if (verbose) {
              yield {
                eventType: "agent_execution_complete" as const,
                timestamp: new Date(),
                source: "orchestrator",
                executingAgent: nextAgent.name,
                success: false,
                messageCount: agentMessages.length,
              };
            }
            throw e;
          }
          throw e;
        }

        // Check for cancellation after agent execution
        if (cancellationToken?.isCancelled()) {
          throw new CancelledError();
        }

        // Ensure we have a result
        if (result === null) {
          result = {
            context: undefined,
            source: nextAgent.name,
            usage: this._emptyUsage(0),
            timestamp: new Date(),
            finishReason: "completed_without_response",
          };
          // Store the collected messages for update_shared_state
          (result as any)._collectedMessages = agentMessages;
        }

        // Collect agent usage statistics
        agentUsageStats.push(result.usage);

        if (verbose) {
          const msgCount = result.context?.messages?.length ?? agentMessages.length;
          yield {
            eventType: "agent_execution_complete" as const,
            timestamp: new Date(),
            source: "orchestrator",
            executingAgent: nextAgent.name,
            success: true,
            messageCount: msgCount,
          };
        }

        // 4. Update shared state (pattern-specific)
        await this.updateSharedState(result);

        // 5. Check termination with new messages streamed in this iteration
        const newStreamedMessages = streamedMessages.slice(
          this._lastTerminationCheckCount
        );
        this._lastTerminationCheckCount = streamedMessages.length;

        stopMessage = this.termination.check(newStreamedMessages);
        if (stopMessage) {
          break;
        }

        this.iterationCount++;
      }

      // Handle max iterations reached
      if (
        this.iterationCount >= this.maxIterations &&
        stopMessage === null
      ) {
        stopMessage = {
          content: `Maximum iterations reached (${this.maxIterations})`,
          source: "MaxIterations",
        };
      }

      // Ensure we always have a stop_message
      if (stopMessage === null) {
        stopMessage = {
          content: "Orchestration completed normally",
          source: "Completion",
        };
      }

      // Calculate usage statistics
      const elapsed = Date.now() - this.startTime;
      let totalUsage = this._emptyUsage(elapsed);
      for (const agentUsage of agentUsageStats) {
        totalUsage = addUsage(totalUsage, agentUsage);
      }

      // Emit orchestration complete event
      const finalResultStr = this._generateFinalResult();
      if (verbose) {
        yield {
          eventType: "orchestration_complete" as const,
          timestamp: new Date(),
          source: "orchestrator",
          result: finalResultStr,
          stopReason: stopMessage.content,
        };
      }

      // Yield final OrchestrationResponse
      yield {
        messages: this.sharedMessages,
        finalResult: finalResultStr,
        usage: totalUsage,
        stopMessage,
        patternMetadata: this._getPatternMetadata(),
      };
    } catch (e) {
      if (e instanceof CancelledError) {
        const elapsed = Date.now() - (this.startTime ?? Date.now());
        let totalUsage = this._emptyUsage(elapsed);
        for (const agentUsage of agentUsageStats) {
          totalUsage = addUsage(totalUsage, agentUsage);
        }

        if (verbose) {
          yield {
            eventType: "orchestration_complete" as const,
            timestamp: new Date(),
            source: "orchestrator",
            result: "Orchestration cancelled",
            stopReason: "Cancellation",
          };
        }

        yield {
          messages: this.sharedMessages,
          finalResult: "Orchestration was cancelled",
          usage: totalUsage,
          stopMessage: {
            content: "Orchestration cancelled",
            source: "CancellationToken",
          },
          patternMetadata: this._getPatternMetadata(),
        };

        throw e;
      }
      throw e;
    }
  }

  // ---------------------------------------------------------------------------
  // Abstract methods for pattern-specific logic
  // ---------------------------------------------------------------------------

  abstract selectNextAgent(): Promise<BaseAgent>;

  abstract prepareContextForAgent(
    agent: BaseAgent
  ): Promise<string | Message | Message[]>;

  abstract updateSharedState(result: AgentResponse): Promise<void>;

  // ---------------------------------------------------------------------------
  // Helper methods
  // ---------------------------------------------------------------------------

  protected _normalizeTaskToMessages(
    task: string | Message | Message[]
  ): Message[] {
    if (typeof task === "string") {
      return [
        {
          role: "user" as const,
          content: task,
          source: "user",
          timestamp: new Date(),
        },
      ];
    } else if (Array.isArray(task)) {
      return task;
    } else {
      return [task];
    }
  }

  protected _resetForRun(): void {
    this.sharedMessages = [];
    this.iterationCount = 0;
    this.startTime = null;
    this.termination.reset();
    this._lastTerminationCheckCount = 0;
  }

  protected _generateFinalResult(): string {
    if (this.sharedMessages.length === 0) {
      return "No messages generated";
    }

    // Find the last assistant message
    for (let i = this.sharedMessages.length - 1; i >= 0; i--) {
      const msg = this.sharedMessages[i];
      if (msg.role === "assistant") {
        return msg.content;
      }
    }

    return "Task completed";
  }

  getAgentCapabilitiesSummary(): string {
    const lines = this.agents.map((agent) => {
      let line = `- ${agent.name}: ${agent.description}`;
      if (agent.tools && agent.tools.length > 0) {
        const toolNames = agent.tools.map((t) => t.name);
        line += ` | Tools: ${toolNames.join(", ")}`;
      }
      return line;
    });
    return lines.join("\n");
  }

  protected _getPatternMetadata(): Record<string, unknown> {
    return {
      pattern: this.constructor.name,
      iterationsCompleted: this.iterationCount,
      agentsCount: this.agents.length,
      messageCount: this.sharedMessages.length,
    };
  }

  protected _createFallbackResult(reason: string): OrchestrationResponse {
    const elapsed = Math.round(
      Date.now() - (this.startTime ?? Date.now())
    );
    return {
      messages: this.sharedMessages,
      finalResult: reason,
      usage: this._emptyUsage(elapsed),
      stopMessage: { content: reason, source: "Fallback" },
      patternMetadata: this._getPatternMetadata(),
    };
  }

  protected _emptyUsage(durationMs: number): Usage {
    return {
      durationMs,
      llmCalls: 0,
      tokensInput: 0,
      tokensOutput: 0,
      toolCalls: 0,
      memoryOperations: 0,
    };
  }

  // Type guards
  private _isMessage(item: unknown): boolean {
    return (
      item !== null &&
      typeof item === "object" &&
      "content" in (item as Record<string, unknown>) &&
      "role" in (item as Record<string, unknown>)
    );
  }

  private _isAgentResponse(item: unknown): boolean {
    return (
      item !== null &&
      typeof item === "object" &&
      "usage" in (item as Record<string, unknown>) &&
      "finishReason" in (item as Record<string, unknown>)
    );
  }

  private _isOrchestrationResponse(item: unknown): boolean {
    return (
      item !== null &&
      typeof item === "object" &&
      "messages" in (item as Record<string, unknown>) &&
      "finalResult" in (item as Record<string, unknown>) &&
      "stopMessage" in (item as Record<string, unknown>)
    );
  }
}
