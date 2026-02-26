/**
 * OrchestratorView - Chat interface for multi-agent orchestration
 * Features: Multi-agent conversation display, termination conditions, agent tracking
 */

import { useState, useCallback, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChatBase } from "@/components/shared/chat-base";
import { SessionSwitcher } from "@/components/shared/session-switcher";
import { ExampleTasksDisplay } from "@/components/shared/example-tasks-display";
import { ContextInspector } from "@/components/shared/context-inspector";
import { Users, Bot, MessageSquare, StopCircle, ArrowUp, ArrowDown, Eye, ChevronDown, ChevronUp } from "lucide-react";
import { apiClient } from "@/services/api";
import { useEntityExecution } from "@/hooks/useEntityExecution";
import { OrchestratorMessageHandler } from "@/hooks/messageHandlers";
import type {
  OrchestratorInfo,
  Message,
  StreamEvent,
  SessionInfo,
} from "@/types";

interface OrchestratorViewProps {
  selectedOrchestrator: OrchestratorInfo;
  currentSession?: SessionInfo;
  onSessionChange: (session: SessionInfo) => void;
  onDebugEvent: (event: StreamEvent) => void;
}

export function OrchestratorView({
  selectedOrchestrator,
  currentSession,
  onSessionChange,
  onDebugEvent,
}: OrchestratorViewProps) {
  const [isContextInspectorOpen, setIsContextInspectorOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // Create message handler (memoize to avoid recreating)
  const messageHandler = useMemo(() => new OrchestratorMessageHandler(), []);

  // Use unified execution hook
  const {
    messages,
    isStreaming,
    sessionTotalUsage,
    currentAgentSpeaking,
    handleSendMessage,
    handleStop,
    handleClearMessages,
  } = useEntityExecution({
    entityId: selectedOrchestrator.id,
    entityType: "orchestrator",
    entityName: selectedOrchestrator.name || selectedOrchestrator.id,
    currentSession,
    onDebugEvent,
    onSessionChange,
    messageHandler,
    supportsToolApproval: false, // Orchestrators don't have tool approval
    supportsTokenStreaming: false, // Orchestrators stream complete messages
  });

  // Handle local session switching from SessionSwitcher
  const handleLocalSessionChange = useCallback(async (sessionId: string | undefined) => {
    if (sessionId) {
      try {
        const sessions = await apiClient.getSessions(selectedOrchestrator.id);
        const session = sessions.find(s => s.id === sessionId);
        if (session) {
          onSessionChange(session);
        }
      } catch (error) {
        console.error("Failed to load session:", error);
      }
    }
  }, [selectedOrchestrator.id, onSessionChange]);

  const getOrchestratorTypeColor = (type: string) => {
    switch (type.toLowerCase()) {
      case "round_robin":
      case "roundrobinorchestrator":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
      case "ai":
      case "aiorchestrator":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300";
      case "plan":
      case "planorchestrator":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
      case "handoff":
      case "handofforchestrator":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Orchestrator Info Header */}
      <div className="border-b">
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Users className="h-6 w-6 text-blue-600" />
              <div className="flex-1">
                <h2 className="text-lg font-semibold">
                  {selectedOrchestrator.name || selectedOrchestrator.id}
                </h2>
                {selectedOrchestrator.description && (
                  <p className="text-sm text-muted-foreground">
                    {selectedOrchestrator.description}
                  </p>
                )}
              </div>
            </div>
            <Badge className={getOrchestratorTypeColor(selectedOrchestrator.orchestratorType)}>
              {selectedOrchestrator.orchestratorType}
            </Badge>
          </div>

          {/* Session switcher and metadata badges */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <SessionSwitcher
                entityId={selectedOrchestrator.id}
                currentSessionId={currentSession?.id}
                onSessionChange={handleLocalSessionChange}
              />
              <div className="h-4 w-px bg-border" />
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="text-xs">
                  <Users className="h-3 w-3 mr-1" />
                  {selectedOrchestrator.agents.length} agents
                </Badge>
                {selectedOrchestrator.terminationConditions.length > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    <StopCircle className="h-3 w-3 mr-1" />
                    {selectedOrchestrator.terminationConditions.length} conditions
                  </Badge>
                )}
                {/* Session token usage */}
                {(sessionTotalUsage.tokensInput > 0 || sessionTotalUsage.tokensOutput > 0) && (
                  <>
                    <Badge variant="outline" className="text-xs gap-1">
                      <ArrowUp className="h-3 w-3" />
                      {sessionTotalUsage.tokensInput.toLocaleString()}
                      <ArrowDown className="h-3 w-3" />
                      {sessionTotalUsage.tokensOutput.toLocaleString()}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsContextInspectorOpen(true)}
                      className="h-7 px-2 text-xs gap-1"
                      title="Inspect context window"
                    >
                      <Eye className="h-3 w-3" />
                      Inspect
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Expand/collapse button */}
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1 hover:bg-accent rounded-md transition-colors"
              aria-label={isExpanded ? "Hide details" : "Show details"}
            >
              {isExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        {/* Expandable detailed view */}
        {isExpanded && (
          <div className="px-4 pb-3 space-y-2 border-t bg-muted/50">
            {/* Agent Participants */}
            <div className="space-y-2 pt-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Bot className="h-4 w-4" />
                <span>Participating Agents ({selectedOrchestrator.agents.length})</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedOrchestrator.agents.map((agentName) => (
                  <Badge
                    key={agentName}
                    variant={currentAgentSpeaking === agentName ? "default" : "outline"}
                    className={currentAgentSpeaking === agentName ? "animate-pulse" : ""}
                  >
                    {agentName}
                    {currentAgentSpeaking === agentName && (
                      <MessageSquare className="h-3 w-3 ml-1" />
                    )}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Termination Conditions */}
            {selectedOrchestrator.terminationConditions.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <StopCircle className="h-4 w-4" />
                  <span>Termination Conditions</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedOrchestrator.terminationConditions.map((condition) => (
                    <Badge key={condition} variant="secondary">
                      {condition}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Current Agent Speaking Indicator */}
            {currentAgentSpeaking && (
              <Card className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 bg-blue-600 rounded-full animate-pulse" />
                    <span className="text-sm font-medium">
                      {currentAgentSpeaking} is responding...
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* Chat Interface */}
      <div className="flex-1 min-h-0">
        <ChatBase
          messages={messages}
          onSendMessage={handleSendMessage}
          onClearMessages={handleClearMessages}
          onStop={handleStop}
          isStreaming={isStreaming}
          sessionTotalUsage={sessionTotalUsage}
          placeholder={`Start a conversation with ${selectedOrchestrator.agents.length} agents via ${selectedOrchestrator.orchestratorType} orchestration...`}
          emptyStateTitle="Multi-Agent Orchestration"
          emptyStateDescription={`This orchestrator will coordinate conversations between ${selectedOrchestrator.agents.join(", ")} using ${selectedOrchestrator.orchestratorType} pattern.`}
          emptyStateCustom={
            selectedOrchestrator.exampleTasks && selectedOrchestrator.exampleTasks.length > 0 ? (
              <ExampleTasksDisplay
                tasks={selectedOrchestrator.exampleTasks}
                entityName={selectedOrchestrator.name || selectedOrchestrator.id}
                onTaskClick={(task) => {
                  const userMessage: Message = {
                    role: "user",
                    content: task,
                    source: "user",
                  };
                  handleSendMessage([userMessage]);
                }}
              />
            ) : null
          }
        />

        {/* Context Inspector */}
        <ContextInspector
          messages={messages}
          isOpen={isContextInspectorOpen}
          onClose={() => setIsContextInspectorOpen(false)}
        />
      </div>
    </div>
  );
}
