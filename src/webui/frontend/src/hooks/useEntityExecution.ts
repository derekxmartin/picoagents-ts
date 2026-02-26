/**
 * useEntityExecution - Unified hook for executing agents, orchestrators, and workflows
 *
 * Consolidates all streaming execution logic into a single, reusable hook.
 * Uses strategy pattern for entity-specific message handling.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { apiClient } from "@/services/api";
import type {
  Message,
  StreamEvent,
  RunEntityRequest,
  SessionInfo,
  ToolApprovalRequest,
  ToolApprovalResponse,
} from "@/types";

export type EntityType = "agent" | "orchestrator" | "workflow";

export interface MessageHandler {
  /**
   * Process a stream event and return updated messages array.
   * Handler maintains internal state for streaming logic.
   */
  handleEvent(
    event: StreamEvent,
    currentMessages: Message[],
    entityName: string
  ): Message[];

  /**
   * Reset handler state for new execution
   */
  reset(): void;
}

export interface UseEntityExecutionOptions {
  entityId: string;
  entityType: EntityType;
  entityName: string;
  currentSession?: SessionInfo;
  onDebugEvent: (event: StreamEvent) => void;
  onSessionChange?: (session: SessionInfo) => void;
  messageHandler: MessageHandler;
  supportsToolApproval?: boolean;
  supportsTokenStreaming?: boolean;
}

export interface UseEntityExecutionReturn {
  messages: Message[];
  isStreaming: boolean;
  sessionTotalUsage: { tokensInput: number; tokensOutput: number };
  pendingApproval: ToolApprovalRequest | null;
  currentAgentSpeaking: string | null;

  handleSendMessage: (
    newMessages: Message[],
    approvalResponses?: ToolApprovalResponse[]
  ) => Promise<void>;
  handleStop: () => void;
  handleClearMessages: () => void;
  handleApprove: (response: ToolApprovalResponse) => void;
  handleReject: (response: ToolApprovalResponse) => void;
}

export function useEntityExecution(
  options: UseEntityExecutionOptions
): UseEntityExecutionReturn {
  const {
    entityId,
    entityType,
    entityName,
    currentSession,
    onDebugEvent,
    onSessionChange,
    messageHandler,
    supportsToolApproval = false,
    supportsTokenStreaming = false,
  } = options;

  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionTotalUsage, setSessionTotalUsage] = useState<{
    tokensInput: number;
    tokensOutput: number;
  }>({ tokensInput: 0, tokensOutput: 0 });
  const [pendingApproval, setPendingApproval] =
    useState<ToolApprovalRequest | null>(null);
  const [pendingApprovalResponses, setPendingApprovalResponses] = useState<
    ToolApprovalResponse[]
  >([]);
  const [currentAgentSpeaking, setCurrentAgentSpeaking] = useState<
    string | null
  >(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Load session messages when currentSession changes
  useEffect(() => {
    const loadSessionMessages = async () => {
      if (currentSession) {
        try {
          const response = await apiClient.getSessionMessages(currentSession.id);
          setMessages(response.messages);

          // Calculate session totals from loaded messages
          const totals = response.messages.reduce(
            (acc, msg) => {
              if (msg.role === "assistant" && (msg as any).usage) {
                const usage = (msg as any).usage;
                return {
                  tokensInput: acc.tokensInput + (usage.tokensInput || 0),
                  tokensOutput: acc.tokensOutput + (usage.tokensOutput || 0),
                };
              }
              return acc;
            },
            { tokensInput: 0, tokensOutput: 0 }
          );

          setSessionTotalUsage(totals);
        } catch (error) {
          console.error("Failed to load session messages:", error);
          setMessages([]);
          setSessionTotalUsage({ tokensInput: 0, tokensOutput: 0 });
        }
      } else {
        // No session - clear messages and usage
        setMessages([]);
        setSessionTotalUsage({ tokensInput: 0, tokensOutput: 0 });
      }
      setPendingApproval(null);
      setPendingApprovalResponses([]);
    };

    loadSessionMessages();
  }, [currentSession?.id]);

  const handleSendMessage = useCallback(
    async (
      newMessages: Message[],
      approvalResponses?: ToolApprovalResponse[]
    ) => {
      // Add new messages to state
      setMessages((prev) => [...prev, ...newMessages]);
      setIsStreaming(true);
      setCurrentAgentSpeaking(null);

      // Create new AbortController for this request
      abortControllerRef.current = new AbortController();

      // Use provided approval responses or fallback to state
      const approvalsToSend =
        approvalResponses ||
        (pendingApprovalResponses.length > 0
          ? pendingApprovalResponses
          : undefined);

      try {
        const request: RunEntityRequest = {
          messages: newMessages, // Send only NEW messages
          sessionId: currentSession?.id, // Backend will append to session
          streamTokens: supportsTokenStreaming,
          approvalResponses: approvalsToSend,
        };

        // Clear pending approvals after sending
        if (approvalsToSend) {
          setPendingApprovalResponses([]);
        }

        // Reset message handler for new execution
        messageHandler.reset();

        // Stream execution
        for await (const event of apiClient.streamEntityExecution(
          entityId,
          request,
          abortControllerRef.current.signal
        )) {
          onDebugEvent(event);

          // Capture sessionId from first event and update parent
          if (!currentSession && event.sessionId && onSessionChange) {
            const newSession: SessionInfo = {
              id: event.sessionId,
              entityId: entityId,
              entityType: entityType,
              createdAt: new Date().toISOString(),
              lastActivity: new Date().toISOString(),
              messageCount: 0,
            };
            onSessionChange(newSession);
          }

          // Track current agent speaking (for orchestrators)
          if (event.type === "agent_selection" && event.data?.selected_agent) {
            setCurrentAgentSpeaking(event.data.selected_agent);
          } else if (event.type === "agent_execution_complete") {
            setCurrentAgentSpeaking(null);
          }

          // Handle tool approval requests
          if (
            supportsToolApproval &&
            event.type === "tool_approval" &&
            event.data?.approval_request
          ) {
            setPendingApproval(event.data.approval_request);
          }

          // Let message handler process the event
          setMessages((prevMessages) =>
            messageHandler.handleEvent(event, prevMessages, entityName)
          );

          // Handle completion - extract usage
          if (event.type === "complete" && event.data?.usage) {
            const usage = event.data.usage;
            setSessionTotalUsage((prev) => ({
              tokensInput: prev.tokensInput + (usage.tokensInput || 0),
              tokensOutput: prev.tokensOutput + (usage.tokensOutput || 0),
            }));
            break;
          }
        }
      } catch (error) {
        console.error("Failed to send message:", error);

        // Check if this was an abort (user clicked stop)
        if (error instanceof Error && error.name === "AbortError") {
          const cancelMessage: Message = {
            role: "assistant",
            content: "Cancelled by user",
            source: "system",
          };
          setMessages((prev) => [...prev.slice(0, -1), cancelMessage]);
        } else {
          const errorMessage: Message = {
            role: "assistant",
            content: `Error: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
            source: "system",
          };
          setMessages((prev) => [...prev.slice(0, -1), errorMessage]);
        }
      } finally {
        setIsStreaming(false);
        setCurrentAgentSpeaking(null);
        abortControllerRef.current = null;
      }
    },
    [
      entityId,
      entityType,
      entityName,
      currentSession,
      pendingApprovalResponses,
      onDebugEvent,
      onSessionChange,
      messageHandler,
      supportsToolApproval,
      supportsTokenStreaming,
    ]
  );

  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      console.log(`🛑 Stopping ${entityType} execution`);
      abortControllerRef.current.abort();
    }
  }, [entityType]);

  const handleClearMessages = useCallback(() => {
    setMessages([]);
    setSessionTotalUsage({ tokensInput: 0, tokensOutput: 0 });
    setCurrentAgentSpeaking(null);
  }, []);

  const handleApprove = useCallback(
    (response: ToolApprovalResponse) => {
      console.log("📝 handleApprove called with:", response);
      setPendingApproval(null);
      handleSendMessage([], [response]);
    },
    [handleSendMessage]
  );

  const handleReject = useCallback(
    (response: ToolApprovalResponse) => {
      console.log("📝 handleReject called with:", response);
      setPendingApproval(null);
      handleSendMessage([], [response]);
    },
    [handleSendMessage]
  );

  return {
    messages,
    isStreaming,
    sessionTotalUsage,
    pendingApproval,
    currentAgentSpeaking,
    handleSendMessage,
    handleStop,
    handleClearMessages,
    handleApprove,
    handleReject,
  };
}
