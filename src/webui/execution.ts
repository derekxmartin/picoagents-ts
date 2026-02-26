/**
 * Execution engine for PicoAgents WebUI.
 *
 * Streams raw PicoAgent events with session context management.
 */

import type { AgentContext } from "../context.js";
import type { Message } from "../messages.js";
import type { AgentResponse, AgentEvent } from "../types.js";
import type { CancellationToken } from "../cancellation-token.js";
import type { WebUIStreamEvent } from "./models.js";
import type { SessionManager } from "./sessions.js";

export class ExecutionEngine {
  constructor(readonly sessionManager: SessionManager) {}

  /**
   * Stream raw PicoAgent events from an agent with session management.
   */
  async *executeAgentStream(
    agent: unknown,
    messages: Message[],
    options?: {
      sessionId?: string;
      streamTokens?: boolean;
      approvalResponses?: Array<{
        requestId: string;
        toolCallId: string;
        approved: boolean;
        reason?: string;
      }>;
      cancellationToken?: CancellationToken;
    }
  ): AsyncGenerator<string> {
    const sessionId =
      options?.sessionId ?? this.sessionManager.createSessionId();
    const entityId =
      (agent as Record<string, unknown>)["id"] as string ??
      (agent as Record<string, unknown>)["name"] as string ??
      "unknown";

    const context = await this.sessionManager.getOrCreate(
      sessionId,
      entityId,
      "agent"
    );

    // Inject approval responses
    if (options?.approvalResponses) {
      for (const response of options.approvalResponses) {
        context.addApprovalResponse(response);
      }
    }

    // Add new messages to context
    for (const msg of messages) {
      context.addMessage(msg);
    }

    try {
      const runStream = (agent as Record<string, unknown>)[
        "runStream"
      ] as (
        task?: unknown,
        ctx?: unknown,
        ct?: CancellationToken
      ) => AsyncIterable<unknown>;

      for await (const event of runStream.call(
        agent,
        null,
        context,
        options?.cancellationToken
      )) {
        // Check if it's an AgentResponse
        if (_isAgentResponse(event)) {
          const eventData = {
            messages: event.context?.messages ?? [],
            usage: event.usage,
            source: event.source,
            finishReason: event.finishReason,
            timestamp: event.timestamp.toISOString(),
          };
          const wrapped: WebUIStreamEvent = {
            sessionId,
            timestamp: new Date(),
            event: eventData,
          };
          yield `data: ${JSON.stringify(wrapped)}\n\n`;
        } else {
          const wrapped: WebUIStreamEvent = {
            sessionId,
            timestamp: new Date(),
            event,
          };
          yield `data: ${JSON.stringify(wrapped)}\n\n`;
        }
      }

      // Update session with final context
      await this.sessionManager.update(sessionId, context);
    } catch (err) {
      const wrapped: WebUIStreamEvent = {
        sessionId,
        timestamp: new Date(),
        event: { type: "error", message: String(err) },
      };
      yield `data: ${JSON.stringify(wrapped)}\n\n`;
    }
  }

  /**
   * Stream raw orchestrator events with session management.
   */
  async *executeOrchestratorStream(
    orchestrator: unknown,
    messages: Message[],
    options?: {
      sessionId?: string;
      cancellationToken?: CancellationToken;
    }
  ): AsyncGenerator<string> {
    const sessionId =
      options?.sessionId ?? this.sessionManager.createSessionId();
    const entityId =
      (orchestrator as Record<string, unknown>)["id"] as string ??
      (orchestrator as Record<string, unknown>)["name"] as string ??
      "unknown";

    const context = await this.sessionManager.getOrCreate(
      sessionId,
      entityId,
      "orchestrator"
    );

    for (const msg of messages) {
      context.addMessage(msg);
    }

    try {
      const runStream = (orchestrator as Record<string, unknown>)[
        "runStream"
      ] as (
        task: unknown,
        ct?: CancellationToken
      ) => AsyncIterable<unknown>;

      for await (const event of runStream.call(
        orchestrator,
        context.messages,
        options?.cancellationToken
      )) {
        const wrapped: WebUIStreamEvent = {
          sessionId,
          timestamp: new Date(),
          event,
        };
        yield `data: ${JSON.stringify(wrapped)}\n\n`;
      }

      await this.sessionManager.update(sessionId, context);
    } catch (err) {
      const wrapped: WebUIStreamEvent = {
        sessionId,
        timestamp: new Date(),
        event: { type: "error", message: String(err) },
      };
      yield `data: ${JSON.stringify(wrapped)}\n\n`;
    }
  }

  /**
   * Stream raw workflow events with session management.
   */
  async *executeWorkflowStream(
    workflow: unknown,
    inputData: unknown,
    options?: {
      sessionId?: string;
      cancellationToken?: CancellationToken;
    }
  ): AsyncGenerator<string> {
    const sessionId =
      options?.sessionId ?? this.sessionManager.createSessionId();
    const entityId =
      (workflow as Record<string, unknown>)["id"] as string ??
      (workflow as Record<string, unknown>)["name"] as string ??
      "unknown";

    const context = await this.sessionManager.getOrCreate(
      sessionId,
      entityId,
      "workflow"
    );

    context.metadata["lastInput"] = inputData;

    try {
      // Import WorkflowRunner dynamically to avoid circular deps
      const { WorkflowRunner } = await import("../workflow/index.js");
      const runner = new WorkflowRunner();

      for await (const event of runner.runStream(
        workflow as Parameters<typeof runner.runStream>[0],
        inputData as Record<string, unknown>,
        options?.cancellationToken
      )) {
        const wrapped: WebUIStreamEvent = {
          sessionId,
          timestamp: new Date(),
          event,
        };
        yield `data: ${JSON.stringify(wrapped)}\n\n`;
      }

      await this.sessionManager.update(sessionId, context);
    } catch (err) {
      const wrapped: WebUIStreamEvent = {
        sessionId,
        timestamp: new Date(),
        event: { type: "error", message: String(err) },
      };
      yield `data: ${JSON.stringify(wrapped)}\n\n`;
    }
  }
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

function _isAgentResponse(item: unknown): item is AgentResponse {
  if (!item || typeof item !== "object") return false;
  const obj = item as Record<string, unknown>;
  return (
    "source" in obj &&
    "usage" in obj &&
    "finishReason" in obj &&
    "timestamp" in obj
  );
}
