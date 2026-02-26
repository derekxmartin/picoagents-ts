/**
 * Concrete Agent implementation.
 *
 * Implements the full tool-calling loop with LLM reasoning, tool execution,
 * memory management, middleware, compaction, and hooks.
 */

import { AgentContext } from "../context.js";
import type { CancellationToken } from "../cancellation-token.js";
import { CancelledError } from "../cancellation-token.js";
import type {
  Message,
  UserMessage,
  AssistantMessage,
  ToolMessage,
  ToolCallRequest,
} from "../messages.js";
import type {
  AgentResponse,
  AgentEvent,
  ChatCompletionChunk,
  Usage,
} from "../types.js";
import { createEvent } from "../types.js";
import { ApprovalMode } from "../tools/base.js";
import type { LoopContext } from "../hooks.js";
import { BaseAgent } from "./base.js";

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class Agent extends BaseAgent {
  static override componentType = "agent" as const;
  static override componentVersion = 1;
  static componentProviderOverride = "picoagents/agents/Agent";

  // -------------------------------------------------------------------------
  // run() — non-streaming entry point
  // -------------------------------------------------------------------------

  async run(
    task?: string | UserMessage | Message[],
    context?: AgentContext,
    cancellationToken?: CancellationToken
  ): Promise<AgentResponse> {
    const workingContext = context ?? new AgentContext({ sessionId: this.context.sessionId });

    // Add task to context
    if (task) {
      const taskMsgs = this.convertTaskToMessages(task);
      for (const msg of taskMsgs) workingContext.addMessage(msg);
    }

    let finalResponse: AgentResponse | undefined;
    const startTime = Date.now();

    try {
      for await (const item of this.runStream(
        undefined,
        workingContext,
        cancellationToken,
        false,
        false
      )) {
        if (isAgentResponse(item)) {
          finalResponse = item;
        }
      }

      if (finalResponse) return finalResponse;

      return {
        context: workingContext,
        source: this.name,
        finishReason: "no_response",
        usage: makeUsage(Date.now() - startTime),
        timestamp: new Date(),
      };
    } catch (e) {
      const errorMsg: AssistantMessage = {
        role: "assistant",
        content: `Error: ${(e as Error).message}`,
        source: this.name,
        timestamp: new Date(),
      };
      workingContext.addMessage(errorMsg);
      return {
        context: workingContext,
        source: this.name,
        finishReason: "error",
        usage: makeUsage(Date.now() - startTime),
        timestamp: new Date(),
      };
    }
  }

  // -------------------------------------------------------------------------
  // runStream() — streaming entry point (core tool-calling loop)
  // -------------------------------------------------------------------------

  async *runStream(
    task?: string | UserMessage | Message[],
    context?: AgentContext,
    cancellationToken?: CancellationToken,
    verbose = false,
    streamTokens = false
  ): AsyncGenerator<
    Message | AgentEvent | AgentResponse | ChatCompletionChunk,
    void,
    undefined
  > {
    const startTime = Date.now();
    const messagesYielded: Message[] = [];
    let llmCalls = 0;
    let tokensInput = 0;
    let tokensOutput = 0;

    const workingContext =
      context ?? new AgentContext({ sessionId: this.context.sessionId });
    const originalContext = this.context;
    this.context = workingContext;

    try {
      // Check cancellation
      if (cancellationToken?.isCancelled()) throw new CancelledError();

      // 1. Add task to context
      if (task) {
        const taskMsgs = this.convertTaskToMessages(task);
        for (const msg of taskMsgs) workingContext.addMessage(msg);

        const userMsg = taskMsgs[0];
        yield userMsg;
        messagesYielded.push(userMsg);

        if (verbose) {
          yield createEvent({
            eventType: "task_start",
            source: this.name,
            task: userMsg.content,
          });
        }
      }

      // 2. Prepare LLM messages
      let llmMessages = await this.prepareLlmMessages([]);

      // Start hooks
      let loopCtx: LoopContext | undefined;
      if (this.startHooks.length > 0 || this.endHooks.length > 0) {
        loopCtx = {
          agentContext: workingContext,
          llmMessages,
          agentName: this.name,
          iteration: 0,
          restartCount: 0,
          metadata: {},
        };
        for (const hook of this.startHooks) {
          const injection = await hook.onStart(loopCtx);
          if (injection) {
            const hookMsg: UserMessage = {
              role: "user",
              content: injection,
              source: "hook",
              timestamp: new Date(),
            };
            workingContext.addMessage(hookMsg);
            llmMessages.push(hookMsg);
          }
        }
      }

      // 3. Main loop
      let assistantMessage: AssistantMessage = {
        role: "assistant",
        content: "Task completed",
        source: this.name,
        timestamp: new Date(),
      };
      let llmFinishReason = "stop";

      let iteration = 0;
      while (iteration < this.maxIterations) {
        try {
          if (cancellationToken?.isCancelled()) throw new CancelledError();

          // Compaction
          if (this.compaction) {
            llmMessages = this.compaction.compact(llmMessages);
          }

          const tools =
            this.tools.length > 0 ? this.getToolsForLlm() : undefined;

          if (verbose) {
            yield createEvent({
              eventType: "model_call",
              source: this.name,
              inputMessages: llmMessages,
              model: this.modelClient.model,
            });
          }

          // Make LLM call
          const completionResult = await this.modelClient.create(
            llmMessages,
            { tools, outputSchema: this.outputSchema }
          );

          const originalMessage = completionResult.message;
          llmFinishReason = completionResult.finishReason;

          assistantMessage = {
            role: "assistant",
            content: originalMessage.content,
            source: this.name,
            timestamp: new Date(),
            toolCalls: originalMessage.toolCalls,
            structuredContent: completionResult.structuredOutput,
            usage: completionResult.usage,
          };

          llmCalls += 1;
          tokensInput += completionResult.usage.tokensInput;
          tokensOutput += completionResult.usage.tokensOutput;

          // Yield non-tool-call assistant messages
          if (!assistantMessage.toolCalls) {
            yield assistantMessage;
            messagesYielded.push(assistantMessage);
          }

          if (verbose) {
            yield createEvent({
              eventType: "model_response",
              source: this.name,
              response: assistantMessage.content,
              hasToolCalls: !!assistantMessage.toolCalls,
            });
          }

          // Add to context + working messages
          workingContext.addMessage(assistantMessage);
          llmMessages.push(assistantMessage);

          // 4. Handle tool calls
          if (assistantMessage.toolCalls) {
            let approvalNeeded = false;

            // Execute tool calls (parallel if multiple)
            const toolCallResults = await Promise.all(
              assistantMessage.toolCalls.map(async (tc) => {
                const items: Array<Message | AgentEvent> = [];
                for await (const item of this.executeToolCall(
                  tc,
                  llmMessages,
                  cancellationToken
                )) {
                  items.push(item);
                }
                return items;
              })
            );

            // Yield all items
            for (const items of toolCallResults) {
              for (const item of items) {
                yield item;
                if (isMessage(item)) {
                  messagesYielded.push(item);
                }
                if (
                  isAgentEvent(item) &&
                  item.eventType === "tool_approval"
                ) {
                  approvalNeeded = true;
                }
              }
            }

            if (approvalNeeded) {
              llmFinishReason = "approval_needed";
              break;
            }

            if (!this.summarizeToolResult) break;

            iteration++;
            continue;
          }

          // No tool calls — check end hooks
          let shouldContinue = false;
          if (loopCtx) {
            loopCtx.iteration = iteration;
            loopCtx.llmMessages = llmMessages;

            for (const hook of this.endHooks) {
              const injection = await hook.onEnd(loopCtx);
              if (injection) {
                const resumeMsg: UserMessage = {
                  role: "user",
                  content: injection,
                  source: "hook",
                  timestamp: new Date(),
                };
                workingContext.addMessage(resumeMsg);
                llmMessages.push(resumeMsg);
                loopCtx.restartCount += 1;
                shouldContinue = true;
                break;
              }
            }
          }

          if (shouldContinue) {
            iteration++;
            continue;
          }
          break;
        } catch (e) {
          if (e instanceof CancelledError) throw e;

          yield createEvent({
            eventType: "error",
            source: this.name,
            errorMessage: (e as Error).message,
            errorType: (e as Error).constructor.name,
            isRecoverable: true,
          });

          const errorMessage: AssistantMessage = {
            role: "assistant",
            content: `I encountered an error: ${(e as Error).message}`,
            source: this.name,
            timestamp: new Date(),
          };
          yield errorMessage;
          messagesYielded.push(errorMessage);
          break;
        }
      }

      // Determine finish reason
      const finishReason =
        iteration >= this.maxIterations
          ? "max_iterations"
          : llmFinishReason;

      // Final AgentResponse
      const durationMs = Date.now() - startTime;
      const toolCallCount = messagesYielded.filter(
        (m) => m.role === "tool"
      ).length;

      const response: AgentResponse = {
        context: workingContext,
        source: this.name,
        finishReason,
        usage: {
          durationMs,
          llmCalls,
          tokensInput,
          tokensOutput,
          toolCalls: toolCallCount,
          memoryOperations: 0,
        },
        timestamp: new Date(),
      };
      yield response;
    } catch (e) {
      if (e instanceof CancelledError) {
        yield createEvent({
          eventType: "error",
          source: this.name,
          errorMessage: "Agent execution was cancelled",
          errorType: "CancelledError",
          isRecoverable: false,
        });

        const cancelMsg: AssistantMessage = {
          role: "assistant",
          content: "Agent execution was cancelled",
          source: this.name,
          timestamp: new Date(),
        };
        yield cancelMsg;
        messagesYielded.push(cancelMsg);

        const cancelResponse: AgentResponse = {
          context: workingContext,
          source: this.name,
          finishReason: "cancelled",
          usage: makeUsage(Date.now() - startTime, llmCalls, tokensInput, tokensOutput),
          timestamp: new Date(),
        };
        yield cancelResponse;
        throw e;
      }

      // Fatal error
      yield createEvent({
        eventType: "error",
        source: this.name,
        errorMessage: (e as Error).message,
        errorType: (e as Error).constructor.name,
        isRecoverable: false,
      });

      const errorMsg: AssistantMessage = {
        role: "assistant",
        content: `Fatal error: ${(e as Error).message}`,
        source: this.name,
        timestamp: new Date(),
      };
      yield errorMsg;
      messagesYielded.push(errorMsg);

      const errorResponse: AgentResponse = {
        context: workingContext,
        source: this.name,
        finishReason: "error",
        usage: makeUsage(Date.now() - startTime, llmCalls, tokensInput, tokensOutput),
        timestamp: new Date(),
      };
      yield errorResponse;
    } finally {
      this.context = originalContext;
    }
  }

  // -------------------------------------------------------------------------
  // Tool execution
  // -------------------------------------------------------------------------

  private async *executeToolCall(
    toolCall: ToolCallRequest,
    llmMessages: Message[],
    cancellationToken?: CancellationToken
  ): AsyncGenerator<Message | AgentEvent, void, undefined> {
    if (cancellationToken?.isCancelled()) throw new CancelledError();

    // Emit tool call event
    yield createEvent({
      eventType: "tool_call",
      source: this.name,
      toolName: toolCall.toolName,
      parameters: toolCall.parameters,
      callId: toolCall.callId,
    });

    try {
      const tool = this.findTool(toolCall.toolName);

      if (!tool) {
        const result = makeToolMessage(
          `Tool '${toolCall.toolName}' not found`,
          toolCall,
          this.name,
          false,
          `Tool '${toolCall.toolName}' not found`
        );
        this.context.addMessage(result);
        llmMessages.push(result);
        yield result;
        return;
      }

      // Check approval
      if (tool.approvalMode === ApprovalMode.ALWAYS) {
        const existingApproval = this.context.getApprovalResponse(
          toolCall.callId
        );

        if (!existingApproval) {
          const approvalRequest = this.context.addApprovalRequest(
            toolCall,
            toolCall.toolName
          );

          yield createEvent({
            eventType: "tool_approval",
            source: this.name,
            approvalRequest,
          });
          return; // Pause
        }

        if (!existingApproval.approved) {
          const result = makeToolMessage(
            `Tool execution denied: ${existingApproval.reason ?? "User declined approval"}`,
            toolCall,
            this.name,
            false,
            "Approval denied"
          );
          this.context.addMessage(result);
          llmMessages.push(result);
          yield result;
          return;
        }
      }

      // Execute the tool
      const toolResult = await tool.execute(toolCall.parameters);

      const result = makeToolMessage(
        toolResult.success
          ? String(toolResult.result)
          : `Error: ${toolResult.error}`,
        toolCall,
        this.name,
        toolResult.success,
        toolResult.error
      );

      // Emit tool response event
      yield createEvent({
        eventType: "tool_call_response",
        source: this.name,
        callId: toolCall.callId,
        result: toolResult,
      });

      this.context.addMessage(result);
      llmMessages.push(result);
      yield result;
    } catch (e) {
      if (e instanceof CancelledError) {
        const errorResult = makeToolMessage(
          "Tool execution was cancelled",
          toolCall,
          this.name,
          false,
          "Tool execution was cancelled"
        );
        this.context.addMessage(errorResult);
        llmMessages.push(errorResult);
        yield errorResult;
        throw e;
      }

      const errorMsg = `Tool execution failed: ${(e as Error).message}`;
      const errorResult = makeToolMessage(
        errorMsg,
        toolCall,
        this.name,
        false,
        errorMsg
      );
      this.context.addMessage(errorResult);
      llmMessages.push(errorResult);
      yield errorResult;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUsage(
  durationMs: number,
  llmCalls = 0,
  tokensInput = 0,
  tokensOutput = 0,
  toolCalls = 0
): Usage {
  return {
    durationMs,
    llmCalls,
    tokensInput,
    tokensOutput,
    toolCalls,
    memoryOperations: 0,
  };
}

function makeToolMessage(
  content: string,
  toolCall: ToolCallRequest,
  source: string,
  success: boolean,
  error?: string
): ToolMessage {
  return {
    role: "tool",
    content,
    source,
    timestamp: new Date(),
    toolCallId: toolCall.callId,
    toolName: toolCall.toolName,
    success,
    error,
  };
}

function isAgentResponse(item: unknown): item is AgentResponse {
  return (
    typeof item === "object" &&
    item !== null &&
    "finishReason" in item &&
    "usage" in item &&
    "source" in item
  );
}

function isMessage(item: unknown): item is Message {
  return (
    typeof item === "object" &&
    item !== null &&
    "role" in item &&
    "content" in item
  );
}

function isAgentEvent(item: unknown): item is AgentEvent {
  return (
    typeof item === "object" &&
    item !== null &&
    "eventType" in item
  );
}
