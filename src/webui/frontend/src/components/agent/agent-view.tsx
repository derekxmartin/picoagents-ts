/**
 * AgentView - Single agent chat interface for PicoAgents
 * Features: Chat interface, message streaming, PicoAgents message format
 */

import { useState, useCallback, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChatBase } from "@/components/shared/chat-base";
import { SessionSwitcher } from "@/components/shared/session-switcher";
import { ToolApprovalBanner } from "@/components/shared/tool-approval-banner";
import { ExampleTasksDisplay } from "@/components/shared/example-tasks-display";
import { ContextInspector } from "@/components/shared/context-inspector";
import {
  Bot,
  Brain,
  Wrench,
  Database,
  ChevronDown,
  ChevronUp,
  ArrowUp,
  ArrowDown,
  Eye,
} from "lucide-react";
import { apiClient } from "@/services/api";
import { useEntityExecution } from "@/hooks/useEntityExecution";
import { AgentMessageHandler } from "@/hooks/messageHandlers";
import type {
  AgentInfo,
  Message,
  StreamEvent,
  SessionInfo,
} from "@/types";

interface AgentViewProps {
  selectedAgent: AgentInfo;
  currentSession?: SessionInfo;
  onSessionChange: (session: SessionInfo) => void;
  onDebugEvent: (event: StreamEvent) => void;
}

export function AgentView({
  selectedAgent,
  currentSession,
  onSessionChange,
  onDebugEvent
}: AgentViewProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isContextInspectorOpen, setIsContextInspectorOpen] = useState(false);

  // Create message handler (memoize to avoid recreating)
  const messageHandler = useMemo(() => new AgentMessageHandler(), []);

  // Use unified execution hook
  const {
    messages,
    isStreaming,
    sessionTotalUsage,
    pendingApproval,
    handleSendMessage,
    handleStop,
    handleClearMessages,
    handleApprove,
    handleReject,
  } = useEntityExecution({
    entityId: selectedAgent.id,
    entityType: "agent",
    entityName: selectedAgent.name || selectedAgent.id,
    currentSession,
    onDebugEvent,
    onSessionChange,
    messageHandler,
    supportsToolApproval: true,
    supportsTokenStreaming: true,
  });

  // Handle local session switching from SessionSwitcher
  const handleLocalSessionChange = useCallback(async (sessionId: string | undefined) => {
    if (sessionId) {
      try {
        // Fetch the full session info
        const sessions = await apiClient.getSessions(selectedAgent.id);
        const session = sessions.find(s => s.id === sessionId);
        if (session) {
          onSessionChange(session);
        }
      } catch (error) {
        console.error("Failed to load session:", error);
      }
    }
  }, [selectedAgent.id, onSessionChange]);

  return (
    <div className="flex flex-col h-full">
      {/* Agent Info Header */}
      <div className="border-b">
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bot className="h-6 w-6 text-blue-600" />
              <div className="flex-1">
                <h2 className="text-lg font-semibold">
                  {selectedAgent.name || selectedAgent.id}
                </h2>
                {selectedAgent.description && (
                  <p className="text-sm text-muted-foreground">
                    {selectedAgent.description}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Session switcher and metadata badges */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <SessionSwitcher
                entityId={selectedAgent.id}
                currentSessionId={currentSession?.id}
                onSessionChange={handleLocalSessionChange}
              />
              <div className="h-4 w-px bg-border" />
              <div className="flex flex-wrap gap-2">
                {selectedAgent.model && (
                  <Badge variant="secondary" className="text-xs">
                    <Brain className="h-3 w-3 mr-1" />
                    {selectedAgent.model}
                  </Badge>
                )}
                <Badge variant="secondary" className="text-xs">
                  <Wrench className="h-3 w-3 mr-1" />
                  {selectedAgent.tools.length} tools
                </Badge>
                {selectedAgent.memoryType && (
                  <Badge variant="secondary" className="text-xs">
                    <Database className="h-3 w-3 mr-1" />
                    {selectedAgent.memoryType}
                  </Badge>
                )}
                <Badge variant="secondary" className="text-xs">
                  {selectedAgent.source}
                </Badge>
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
            {/* Detailed metadata cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2">
              {/* Model */}
              {selectedAgent.model && (
                <div className="bg-card border border-muted rounded p-2 shadow-sm">
                  <div className="flex items-center gap-2">
                    <Brain className="h-4 w-4 text-purple-600 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground">Model</div>
                      <div className="text-sm font-medium truncate">
                        {selectedAgent.model}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Tools */}
              <div className="bg-card border border-muted rounded p-2 shadow-sm">
                <div className="flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-orange-600 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">Tools</div>
                    <div className="text-sm font-medium">
                      {selectedAgent.tools.length} available
                    </div>
                  </div>
                </div>
              </div>

              {/* Memory */}
              {selectedAgent.memoryType && (
                <div className="bg-card border border-muted rounded p-2 shadow-sm">
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-green-600 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground">
                        Memory
                      </div>
                      <div className="text-sm font-medium truncate">
                        {selectedAgent.memoryType}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Source */}
              <div className="bg-card border border-muted rounded p-2 shadow-sm">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 rounded-full bg-gray-600 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">Source</div>
                    <div className="text-sm font-medium truncate">
                      {selectedAgent.source}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Tools List */}
            {selectedAgent.tools.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Wrench className="h-4 w-4" />
                  <span>Available Tools ({selectedAgent.tools.length})</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedAgent.tools.map((tool) => (
                    <Badge key={tool} variant="outline">
                      {tool}
                    </Badge>
                  ))}
                </div>
              </div>
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
          placeholder={`Chat with ${selectedAgent.name || selectedAgent.id}...`}
          emptyStateTitle="Agent Chat"
          emptyStateDescription={`Start a conversation with this agent. It has access to ${selectedAgent.tools.length} tools and can help you with various tasks.`}
          emptyStateCustom={
            selectedAgent.exampleTasks && selectedAgent.exampleTasks.length > 0 ? (
              <ExampleTasksDisplay
                tasks={selectedAgent.exampleTasks}
                entityName={selectedAgent.name || selectedAgent.id}
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
          beforeInput={
            <ToolApprovalBanner
              request={pendingApproval}
              onApprove={handleApprove}
              onReject={handleReject}
            />
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
