/**
 * Core data types and models for the picoagents framework using Zod.
 *
 * This module defines all the structured types used throughout the framework
 * for type safety and data validation.
 */

import { z } from "zod";
import type { Message } from "./messages.js";
import type { AgentContext, ToolApprovalRequest } from "./context.js";

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

export const UsageSchema = z.object({
  durationMs: z.number().describe("Total execution time in milliseconds"),
  llmCalls: z.number().default(0).describe("Number of LLM API calls made"),
  tokensInput: z.number().default(0).describe("Total input tokens consumed"),
  tokensOutput: z
    .number()
    .default(0)
    .describe("Total output tokens generated"),
  toolCalls: z.number().default(0).describe("Number of tool executions"),
  memoryOperations: z
    .number()
    .default(0)
    .describe("Number of memory read/write operations"),
  costEstimate: z
    .number()
    .optional()
    .describe("Estimated cost in USD"),
});

export type Usage = z.infer<typeof UsageSchema>;

/** Aggregate two Usage objects (takes max duration for parallel execution). */
export function addUsage(a: Usage, b: Usage): Usage {
  return {
    durationMs: Math.max(a.durationMs, b.durationMs),
    llmCalls: a.llmCalls + b.llmCalls,
    tokensInput: a.tokensInput + b.tokensInput,
    tokensOutput: a.tokensOutput + b.tokensOutput,
    toolCalls: a.toolCalls + b.toolCalls,
    memoryOperations: a.memoryOperations + b.memoryOperations,
    costEstimate:
      (a.costEstimate ?? 0) + (b.costEstimate ?? 0) || undefined,
  };
}

// ---------------------------------------------------------------------------
// ToolResult
// ---------------------------------------------------------------------------

export const ToolResultSchema = z.object({
  success: z.boolean().describe("Whether tool execution succeeded"),
  result: z.unknown().describe("The actual result data"),
  error: z.string().optional().describe("Error message if failed"),
  metadata: z
    .record(z.string(), z.unknown())
    .default({})
    .describe("Execution time, etc."),
});

export type ToolResult = z.infer<typeof ToolResultSchema>;

// ---------------------------------------------------------------------------
// AgentResponse
// ---------------------------------------------------------------------------

export interface AgentResponse {
  context: AgentContext | undefined;
  source: string;
  usage: Usage;
  timestamp: Date;
  finishReason: string;
}

export function getMessages(response: AgentResponse): Message[] {
  return response.context?.messages ?? [];
}

export function needsApproval(response: AgentResponse): boolean {
  return response.context?.waitingForApproval ?? false;
}

export function getApprovalRequests(
  response: AgentResponse
): ToolApprovalRequest[] {
  return response.context?.pendingApprovalRequests ?? [];
}

export function getFinalContent(response: AgentResponse): string {
  const msgs = getMessages(response);
  if (msgs.length > 0) {
    const content = msgs[msgs.length - 1].content;
    return content.length > 50 ? content.slice(0, 50) + "..." : content;
  }
  return "No messages";
}

export function formatAgentResponse(response: AgentResponse): string {
  const msgs = getMessages(response);
  const durationS = response.usage.durationMs / 1000;

  const tokensIn =
    response.usage.tokensInput >= 1000
      ? `${(response.usage.tokensInput / 1000).toFixed(1)}k`
      : String(response.usage.tokensInput);
  const tokensOut =
    response.usage.tokensOutput >= 1000
      ? `${(response.usage.tokensOutput / 1000).toFixed(1)}k`
      : String(response.usage.tokensOutput);

  const costStr = response.usage.costEstimate
    ? `, cost: $${response.usage.costEstimate.toFixed(4)}`
    : "";

  const approvalStr = needsApproval(response)
    ? ` | ${getApprovalRequests(response).length} approvals needed`
    : ` | finish: ${response.finishReason}`;

  const messagesStr = msgs
    .map((m) => `[${m.source}] ${m.content}`)
    .join("\n");
  const usageLine = `[usage] duration: ${durationS.toFixed(1)}s, tokens: in:${tokensIn}, out:${tokensOut}${costStr}${approvalStr}`;

  return `${messagesStr}\n\n${usageLine}`;
}

// ---------------------------------------------------------------------------
// ChatCompletionResult
// ---------------------------------------------------------------------------

export interface ChatCompletionResult {
  message: import("./messages.js").AssistantMessage;
  usage: Usage;
  model: string;
  finishReason: string;
  structuredOutput?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ChatCompletionChunk
// ---------------------------------------------------------------------------

export interface ChatCompletionChunk {
  content: string;
  isComplete: boolean;
  toolCallChunk?: Record<string, unknown>;
  usage?: Usage;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

interface BaseEvent {
  timestamp: Date;
  source: string;
  eventType: string;
}

// Execution Events
export interface TaskStartEvent extends BaseEvent {
  eventType: "task_start";
  task: string;
}

export interface TaskCompleteEvent extends BaseEvent {
  eventType: "task_complete";
  result: string;
}

export interface ModelCallEvent extends BaseEvent {
  eventType: "model_call";
  inputMessages: Message[];
  model: string;
}

export interface ModelResponseEvent extends BaseEvent {
  eventType: "model_response";
  response: string;
  hasToolCalls: boolean;
}

export interface ModelStreamChunkEvent extends BaseEvent {
  eventType: "model_stream_chunk";
  chunk: string;
  isFinal: boolean;
}

// Tool Events
export interface ToolCallEvent extends BaseEvent {
  eventType: "tool_call";
  toolName: string;
  parameters: Record<string, unknown>;
  callId: string;
}

export interface ToolCallResponseEvent extends BaseEvent {
  eventType: "tool_call_response";
  callId: string;
  result?: ToolResult;
}

export interface ToolApprovalEvent extends BaseEvent {
  eventType: "tool_approval";
  approvalRequest: ToolApprovalRequest;
}

export interface ToolValidationEvent extends BaseEvent {
  eventType: "tool_validation";
  toolName: string;
  isValid: boolean;
  errors?: string[];
}

// Memory Events
export interface MemoryUpdateEvent extends BaseEvent {
  eventType: "memory_update";
  operation: string;
  contentSummary: string;
}

export interface MemoryRetrievalEvent extends BaseEvent {
  eventType: "memory_retrieval";
  query: string;
  resultsCount: number;
}

// Error Events
export interface ErrorEvent extends BaseEvent {
  eventType: "error";
  errorMessage: string;
  errorType: string;
  isRecoverable: boolean;
}

export interface FatalErrorEvent extends BaseEvent {
  eventType: "fatal_error";
  errorMessage: string;
  errorType: string;
  isRecoverable: false;
}

// Union type for all agent events
export type AgentEvent =
  | TaskStartEvent
  | TaskCompleteEvent
  | ModelCallEvent
  | ModelResponseEvent
  | ModelStreamChunkEvent
  | ToolCallEvent
  | ToolCallResponseEvent
  | ToolApprovalEvent
  | ToolValidationEvent
  | MemoryUpdateEvent
  | MemoryRetrievalEvent
  | ErrorEvent
  | FatalErrorEvent;

// ---------------------------------------------------------------------------
// Event factory helpers
// ---------------------------------------------------------------------------

export function createEvent(
  event: { eventType: string; source: string; timestamp?: Date } & Record<string, unknown>
): AgentEvent {
  return {
    timestamp: new Date(),
    ...event,
  } as AgentEvent;
}

// ---------------------------------------------------------------------------
// Orchestration Types
// ---------------------------------------------------------------------------

import type { StopMessage } from "./termination/base.js";

/** Result returned by orchestrators. */
export interface OrchestrationResponse {
  messages: Message[];
  finalResult: string;
  usage: Usage;
  stopMessage: StopMessage;
  patternMetadata: Record<string, unknown>;
}

// Orchestration Events

export interface OrchestrationStartEvent extends BaseEvent {
  eventType: "orchestration_start";
  task: string;
  pattern: string;
}

export interface AgentSelectionEvent extends BaseEvent {
  eventType: "agent_selection";
  selectedAgent: string;
  selectionReason: string;
}

export interface AgentExecutionStartEvent extends BaseEvent {
  eventType: "agent_execution_start";
  executingAgent: string;
  contextSize?: number;
}

export interface AgentExecutionCompleteEvent extends BaseEvent {
  eventType: "agent_execution_complete";
  executingAgent: string;
  success: boolean;
  messageCount?: number;
}

export interface OrchestrationCompleteEvent extends BaseEvent {
  eventType: "orchestration_complete";
  result: string;
  stopReason: string;
}

/** Union type for all orchestration events. */
export type OrchestrationEvent =
  | OrchestrationStartEvent
  | AgentSelectionEvent
  | AgentExecutionStartEvent
  | AgentExecutionCompleteEvent
  | OrchestrationCompleteEvent;
