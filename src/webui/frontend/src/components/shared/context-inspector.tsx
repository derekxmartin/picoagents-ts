/**
 * ContextInspector - Advanced context window visualization for understanding agent conversations
 *
 * Educational tool that helps users understand:
 * - What goes into the context window
 * - How tokens are distributed across message types
 * - How context grows over time
 * - Which components dominate token usage
 */

import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  BarChart3,
  Clock,
  MessageSquare,
  Wrench,
  User,
  Bot,
  Eye,
  Play
} from "lucide-react";
import type { Message } from "@/types";

interface ContextInspectorProps {
  messages: Message[];
  isOpen: boolean;
  onClose: () => void;
}

interface MessageWithTokens {
  role: string;
  content: string;
  source: string;
  usage?: {
    tokensInput?: number;
    tokensOutput?: number;
    durationMs?: number;
    llmCalls?: number;
    toolCalls?: number;
    memoryOperations?: number;
    costEstimate?: number;
  };
  estimatedTokens?: number;
  cumulativeTokens?: number;
}

// Rough token estimation (4 chars ≈ 1 token)
const estimateTokens = (text: string): number => {
  return Math.ceil(text.length / 4);
};

export function ContextInspector({ messages, isOpen, onClose }: ContextInspectorProps) {
  const [selectedTurn, setSelectedTurn] = useState<number>(messages.length - 1);

  // Enrich messages with token estimates and cumulative totals
  const enrichedMessages = useMemo((): MessageWithTokens[] => {
    let cumulative = 0;
    return messages.map((msg) => {
      let estimated = 0;

      // Estimate tokens for message content
      if (msg.content) {
        estimated += estimateTokens(msg.content);
      }

      // Add tokens for tool calls (rough estimate)
      if (msg.role === 'assistant' && (msg as any).toolCalls) {
        const toolCalls = (msg as any).toolCalls;
        estimated += toolCalls.length * 50; // ~50 tokens per tool call
      }

      cumulative += estimated;

      return {
        ...msg,
        estimatedTokens: estimated,
        cumulativeTokens: cumulative,
      };
    });
  }, [messages]);

  // Calculate statistics
  const stats = useMemo(() => {
    const userMsgs = enrichedMessages.filter(m => m.role === 'user');
    const assistantMsgs = enrichedMessages.filter(m => m.role === 'assistant');
    const toolMsgs = enrichedMessages.filter(m => m.role === 'tool');

    const userTokens = userMsgs.reduce((sum, m) => sum + (m.estimatedTokens || 0), 0);
    const assistantTokens = assistantMsgs.reduce((sum, m) => sum + (m.estimatedTokens || 0), 0);
    const toolTokens = toolMsgs.reduce((sum, m) => sum + (m.estimatedTokens || 0), 0);

    // Calculate actual usage from assistant messages
    const actualTokensInput = assistantMsgs.reduce((sum, m) => {
      const usage = (m as any).usage;
      return sum + (usage?.tokensInput || 0);
    }, 0);

    const actualTokensOutput = assistantMsgs.reduce((sum, m) => {
      const usage = (m as any).usage;
      return sum + (usage?.tokensOutput || 0);
    }, 0);

    const toolCalls = assistantMsgs.reduce((sum, m) => {
      const calls = (m as any).toolCalls;
      return sum + (calls?.length || 0);
    }, 0);

    const totalEstimated = userTokens + assistantTokens + toolTokens;

    return {
      totalMessages: enrichedMessages.length,
      userMessages: userMsgs.length,
      assistantMessages: assistantMsgs.length,
      toolMessages: toolMsgs.length,
      userTokens,
      assistantTokens,
      toolTokens,
      totalEstimated,
      actualTokensInput,
      actualTokensOutput,
      toolCalls,
    };
  }, [enrichedMessages]);

  // Messages up to selected turn (simulating context window)
  const contextAtTurn = useMemo(() => {
    return enrichedMessages.slice(0, selectedTurn + 1);
  }, [enrichedMessages, selectedTurn]);

  const contextTokens = useMemo(() => {
    return contextAtTurn.reduce((sum, m) => sum + (m.estimatedTokens || 0), 0);
  }, [contextAtTurn]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] p-0">
        <DialogHeader className="p-6 pb-4" onClose={onClose}>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Context Inspector
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-2">
            Understand what goes into your agent's context window and how tokens are distributed
          </p>
        </DialogHeader>

        <Tabs defaultValue="timeline" className="flex-1">
          <div className="px-6">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="timeline" className="gap-2">
                <MessageSquare className="h-4 w-4" />
                Timeline
              </TabsTrigger>
              <TabsTrigger value="stats" className="gap-2">
                <BarChart3 className="h-4 w-4" />
                Statistics
              </TabsTrigger>
              <TabsTrigger value="turn-by-turn" className="gap-2">
                <Play className="h-4 w-4" />
                Turn-by-Turn
              </TabsTrigger>
            </TabsList>
          </div>

          <ScrollArea className="h-[60vh] mt-4">
            {/* Timeline View */}
            <TabsContent value="timeline" className="px-6 pb-6 mt-0">
              <div className="space-y-3">
                {enrichedMessages.map((msg, idx) => {
                  const usage = (msg as any).usage;
                  return (
                    <div
                      key={idx}
                      className={`border rounded-lg p-4 ${
                        msg.role === 'user'
                          ? 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900'
                          : msg.role === 'assistant'
                          ? 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900'
                          : msg.role === 'tool'
                          ? 'bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900'
                          : 'bg-gray-50 dark:bg-gray-950/20 border-gray-200 dark:border-gray-900'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <div className="mt-1">
                            {msg.role === 'user' && <User className="h-4 w-4 text-blue-600" />}
                            {msg.role === 'assistant' && <Bot className="h-4 w-4 text-green-600" />}
                            {msg.role === 'tool' && <Wrench className="h-4 w-4 text-orange-600" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge variant="outline" className="text-xs">
                                {msg.role}
                              </Badge>
                              {msg.role === 'tool' && (msg as any).toolName && (
                                <Badge variant="secondary" className="text-xs">
                                  {(msg as any).toolName}
                                </Badge>
                              )}
                              <span className="text-xs text-muted-foreground">
                                #{idx + 1}
                              </span>
                            </div>
                            <p className="text-sm break-words whitespace-pre-wrap">
                              {msg.content.slice(0, 200)}
                              {msg.content.length > 200 && '...'}
                            </p>
                            {msg.role === 'assistant' && (msg as any).toolCalls && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {(msg as any).toolCalls.map((tc: any, tcIdx: number) => (
                                  <Badge key={tcIdx} variant="outline" className="text-xs">
                                    <Wrench className="h-3 w-3 mr-1" />
                                    {tc.toolName}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 text-xs">
                          <Badge variant="secondary" className="font-mono">
                            ~{msg.estimatedTokens} tokens
                          </Badge>
                          {usage && (
                            <>
                              <Badge className="font-mono bg-blue-600">
                                In: {usage.tokensInput}
                              </Badge>
                              <Badge className="font-mono bg-green-600">
                                Out: {usage.tokensOutput}
                              </Badge>
                            </>
                          )}
                          <span className="text-muted-foreground">
                            Σ {msg.cumulativeTokens}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </TabsContent>

            {/* Statistics View */}
            <TabsContent value="stats" className="px-6 pb-6 mt-0">
              <div className="grid grid-cols-2 gap-6">
                {/* Message Distribution */}
                <div className="space-y-4">
                  <h3 className="font-semibold text-sm">Message Distribution</h3>
                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm flex items-center gap-2">
                          <User className="h-4 w-4 text-blue-600" />
                          User Messages
                        </span>
                        <span className="text-sm font-mono">{stats.userMessages}</span>
                      </div>
                      <div className="h-2 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-600"
                          style={{ width: `${(stats.userMessages / stats.totalMessages) * 100}%` }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm flex items-center gap-2">
                          <Bot className="h-4 w-4 text-green-600" />
                          Assistant Messages
                        </span>
                        <span className="text-sm font-mono">{stats.assistantMessages}</span>
                      </div>
                      <div className="h-2 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-600"
                          style={{ width: `${(stats.assistantMessages / stats.totalMessages) * 100}%` }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm flex items-center gap-2">
                          <Wrench className="h-4 w-4 text-orange-600" />
                          Tool Results
                        </span>
                        <span className="text-sm font-mono">{stats.toolMessages}</span>
                      </div>
                      <div className="h-2 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-orange-600"
                          style={{ width: `${(stats.toolMessages / stats.totalMessages) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Token Distribution (Estimated) */}
                <div className="space-y-4">
                  <h3 className="font-semibold text-sm">Estimated Token Distribution</h3>
                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm">User Content</span>
                        <span className="text-sm font-mono">~{stats.userTokens}</span>
                      </div>
                      <div className="h-2 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-600"
                          style={{ width: `${(stats.userTokens / stats.totalEstimated) * 100}%` }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm">Assistant Content</span>
                        <span className="text-sm font-mono">~{stats.assistantTokens}</span>
                      </div>
                      <div className="h-2 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-600"
                          style={{ width: `${(stats.assistantTokens / stats.totalEstimated) * 100}%` }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm">Tool Results</span>
                        <span className="text-sm font-mono">~{stats.toolTokens}</span>
                      </div>
                      <div className="h-2 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-orange-600"
                          style={{ width: `${(stats.toolTokens / stats.totalEstimated) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Actual LLM Usage */}
                <div className="col-span-2 border rounded-lg p-4 bg-muted/50">
                  <h3 className="font-semibold text-sm mb-3">Actual LLM Token Usage</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-blue-600">
                        {stats.actualTokensInput.toLocaleString()}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">Input Tokens</div>
                      <div className="text-xs text-muted-foreground">(Context sent to LLM)</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-600">
                        {stats.actualTokensOutput.toLocaleString()}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">Output Tokens</div>
                      <div className="text-xs text-muted-foreground">(Generated by LLM)</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-orange-600">
                        {stats.toolCalls}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">Tool Calls</div>
                      <div className="text-xs text-muted-foreground">(Functions invoked)</div>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Turn-by-Turn View */}
            <TabsContent value="turn-by-turn" className="px-6 pb-6 mt-0">
              <div className="space-y-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-sm">Replay Conversation</h3>
                    <Badge variant="secondary">
                      Turn {selectedTurn + 1} of {enrichedMessages.length}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    <Slider
                      value={[selectedTurn]}
                      onValueChange={(val) => setSelectedTurn(val[0])}
                      max={enrichedMessages.length - 1}
                      min={0}
                      step={1}
                      className="w-full"
                    />
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Start</span>
                      <span className="font-mono">
                        Context: {contextTokens.toLocaleString()} estimated tokens
                      </span>
                      <span>End</span>
                    </div>
                  </div>
                </div>

                <div className="border rounded-lg p-4 bg-muted/30">
                  <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Context at Turn {selectedTurn + 1}
                  </h4>
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {contextAtTurn.map((msg, idx) => (
                      <div
                        key={idx}
                        className={`text-xs p-2 rounded ${
                          idx === selectedTurn ? 'ring-2 ring-primary' : ''
                        } ${
                          msg.role === 'user'
                            ? 'bg-blue-100 dark:bg-blue-950/40'
                            : msg.role === 'assistant'
                            ? 'bg-green-100 dark:bg-green-950/40'
                            : 'bg-orange-100 dark:bg-orange-950/40'
                        }`}
                      >
                        <div className="font-mono font-semibold mb-1">
                          {msg.role.toUpperCase()} | ~{msg.estimatedTokens} tokens
                        </div>
                        <div className="text-xs opacity-80">
                          {msg.content.slice(0, 100)}
                          {msg.content.length > 100 && '...'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="border rounded-lg p-3">
                    <div className="text-muted-foreground mb-1">Messages in Context</div>
                    <div className="text-2xl font-bold">{contextAtTurn.length}</div>
                  </div>
                  <div className="border rounded-lg p-3">
                    <div className="text-muted-foreground mb-1">Estimated Tokens</div>
                    <div className="text-2xl font-bold font-mono">{contextTokens}</div>
                  </div>
                </div>
              </div>
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
