/**
 * Message Handlers - Strategy pattern for entity-specific message accumulation
 *
 * Each entity type (agent, orchestrator, workflow) has unique streaming behavior.
 * Handlers encapsulate this logic and maintain state across stream events.
 */

import type { Message, StreamEvent } from "@/types";
import type { MessageHandler } from "./useEntityExecution";

/**
 * Agent Message Handler
 * Single streaming message - appends tokens and finalizes on completion
 */
export class AgentMessageHandler implements MessageHandler {
  private currentMessage: Message | null = null;

  handleEvent(
    event: StreamEvent,
    currentMessages: Message[],
    entityName: string
  ): Message[] {
    switch (event.type) {
      case "token_chunk":
        // Handle streaming token chunks
        if (event.data?.content) {
          if (!this.currentMessage) {
            // Initialize streaming message
            this.currentMessage = {
              role: "assistant",
              content: "",
              source: entityName,
            };
            return [...currentMessages, this.currentMessage];
          }

          // Append token to current message
          this.currentMessage = {
            ...this.currentMessage,
            content: this.currentMessage.content + event.data.content,
          };

          return [...currentMessages.slice(0, -1), this.currentMessage];
        }
        break;

      case "message":
        // Fallback for non-streaming mode
        if (event.data?.role === "assistant" && event.data?.content) {
          this.currentMessage = {
            role: "assistant",
            content: event.data.content,
            source: event.data.source || entityName,
          };
          return [...currentMessages.slice(0, -1), this.currentMessage];
        }
        break;

      case "complete":
        // Finalize message with usage and full content
        if (event.data?.messages) {
          const lastMessage =
            event.data.messages[event.data.messages.length - 1];
          if (lastMessage?.role === "assistant") {
            this.currentMessage = {
              role: "assistant",
              content: lastMessage.content,
              source: lastMessage.source || entityName,
            };

            // Attach usage if available
            if (event.data?.usage) {
              (this.currentMessage as any).usage = {
                tokensInput: event.data.usage.tokensInput || 0,
                tokensOutput: event.data.usage.tokensOutput || 0,
                durationMs: event.data.usage.durationMs || 0,
                llmCalls: event.data.usage.llmCalls || 0,
                toolCalls: event.data.usage.toolCalls || 0,
                memoryOperations: event.data.usage.memoryOperations || 0,
                costEstimate: event.data.usage.costEstimate,
              };
            }

            return [...currentMessages.slice(0, -1), this.currentMessage];
          }
        }
        break;
    }

    return currentMessages;
  }

  reset(): void {
    this.currentMessage = null;
  }
}

/**
 * Orchestrator Message Handler
 * Multiple agent messages - creates new message for each agent that speaks
 */
export class OrchestratorMessageHandler implements MessageHandler {
  private agentMessages: Map<string, Message> = new Map();
  private messageOrder: string[] = []; // Track order of agents

  handleEvent(
    event: StreamEvent,
    currentMessages: Message[],
    _entityName: string
  ): Message[] {
    // Handle raw message events from orchestrator stream
    // Backend yields individual Message objects with proper source (agent name)
    if (event.type === "message" && event.data) {
      const data = event.data as any;

      // Check if this is an assistant message (from an agent)
      if (data.role === "assistant" && data.source && data.content !== undefined) {
        const agentName = data.source;
        const content = data.content;

        // Get or create message for this agent
        let agentMsg = this.agentMessages.get(agentName);

        if (!agentMsg) {
          // New agent speaking - create new message
          agentMsg = {
            role: "assistant",
            content: "",
            source: agentName,
          };
          this.agentMessages.set(agentName, agentMsg);
          this.messageOrder.push(agentName);
        }

        // Update content (may be incremental or full update)
        agentMsg.content = content;

        // Attach usage if present in the event data
        if (data.usage) {
          (agentMsg as any).usage = data.usage;
        }

        // Rebuild messages array in correct order
        const orderedMessages: Message[] = [];

        // Keep all non-assistant messages and assistant messages not from agents
        for (const msg of currentMessages) {
          if (msg.role !== "assistant" || !this.agentMessages.has(msg.source)) {
            orderedMessages.push(msg);
          }
        }

        // Add agent messages in order they first spoke
        for (const agentName of this.messageOrder) {
          const msg = this.agentMessages.get(agentName);
          if (msg && msg.content) {
            // Only add if has content
            orderedMessages.push(msg);
          }
        }

        return orderedMessages;
      }
    }

    // Handle complete event - might have usage aggregation
    if (event.type === "complete") {
      // Orchestrators may send final OrchestrationResponse
      // Messages are already in the array, just attach final usage if needed
      if (event.data?.usage && this.messageOrder.length > 0) {
        // Get last agent message and ensure it has usage
        const lastAgentName = this.messageOrder[this.messageOrder.length - 1];
        const lastMsg = this.agentMessages.get(lastAgentName);

        if (lastMsg && !(lastMsg as any).usage) {
          (lastMsg as any).usage = event.data.usage;

          // Rebuild to trigger update
          const orderedMessages: Message[] = [];
          for (const msg of currentMessages) {
            if (msg.role !== "assistant" || !this.agentMessages.has(msg.source)) {
              orderedMessages.push(msg);
            }
          }
          for (const agentName of this.messageOrder) {
            const msg = this.agentMessages.get(agentName);
            if (msg && msg.content) {
              orderedMessages.push(msg);
            }
          }
          return orderedMessages;
        }
      }
    }

    return currentMessages;
  }

  reset(): void {
    this.agentMessages.clear();
    this.messageOrder = [];
  }
}

/**
 * Workflow Message Handler
 * Similar to agent but may have workflow-specific events
 */
export class WorkflowMessageHandler implements MessageHandler {
  private currentMessage: Message | null = null;

  handleEvent(
    event: StreamEvent,
    currentMessages: Message[],
    entityName: string
  ): Message[] {
    // For now, use same logic as agent
    // Can be extended for workflow-specific behavior
    switch (event.type) {
      case "message":
        if (event.data?.content) {
          if (!this.currentMessage) {
            this.currentMessage = {
              role: "assistant",
              content: "",
              source: entityName,
            };
            return [...currentMessages, this.currentMessage];
          }

          this.currentMessage = {
            ...this.currentMessage,
            content: this.currentMessage.content + event.data.content,
          };

          return [...currentMessages.slice(0, -1), this.currentMessage];
        }
        break;

      case "complete":
        if (event.data?.result) {
          this.currentMessage = {
            role: "assistant",
            content: event.data.result,
            source: entityName,
          };
          return [...currentMessages.slice(0, -1), this.currentMessage];
        }
        break;
    }

    return currentMessages;
  }

  reset(): void {
    this.currentMessage = null;
  }
}

/**
 * Factory function to create appropriate handler for entity type
 */
export function createMessageHandler(entityType: "agent" | "orchestrator" | "workflow"): MessageHandler {
  switch (entityType) {
    case "agent":
      return new AgentMessageHandler();
    case "orchestrator":
      return new OrchestratorMessageHandler();
    case "workflow":
      return new WorkflowMessageHandler();
    default:
      return new AgentMessageHandler();
  }
}
