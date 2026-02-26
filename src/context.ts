/**
 * Agent context management for picoagents.
 *
 * Provides the AgentContext class that manages conversation history,
 * metadata, shared state, and tool approval workflows.
 */

import { z } from "zod";
import type {
  Message,
  AssistantMessage,
  UserMessage,
  ToolCallRequest,
} from "./messages.js";

// ---------------------------------------------------------------------------
// Tool Approval Types
// ---------------------------------------------------------------------------

export const ToolApprovalRequestSchema = z.object({
  requestId: z.string().describe("Unique approval request ID"),
  toolCallId: z.string().describe("ID of the tool call needing approval"),
  toolName: z.string().describe("Name of the tool"),
  parameters: z
    .record(z.string(), z.unknown())
    .describe("Tool parameters"),
  originalToolCall: z.object({
    toolName: z.string(),
    parameters: z.record(z.string(), z.unknown()),
    callId: z.string(),
  }),
});

export type ToolApprovalRequest = z.infer<typeof ToolApprovalRequestSchema>;

export const ToolApprovalResponseSchema = z.object({
  requestId: z.string().describe("Approval request ID"),
  toolCallId: z.string().describe("Tool call ID"),
  approved: z.boolean().describe("Whether execution was approved"),
  reason: z.string().optional().describe("Reason for approval/rejection"),
});

export type ToolApprovalResponse = z.infer<typeof ToolApprovalResponseSchema>;

// ---------------------------------------------------------------------------
// Helper to create an approval response from a request
// ---------------------------------------------------------------------------

export function createApprovalResponse(
  request: ToolApprovalRequest,
  approved: boolean,
  reason?: string
): ToolApprovalResponse {
  return {
    requestId: request.requestId,
    toolCallId: request.toolCallId,
    approved,
    reason,
  };
}

// ---------------------------------------------------------------------------
// AgentContext
// ---------------------------------------------------------------------------

export class AgentContext {
  messages: Message[] = [];
  metadata: Record<string, unknown> = {};
  sharedState: Record<string, unknown> = {};
  environment: Record<string, unknown> = {};
  sessionId?: string;
  createdAt: Date = new Date();

  // Approval workflow state
  pendingApprovalRequests: ToolApprovalRequest[] = [];
  approvalResponses: Map<string, ToolApprovalResponse> = new Map();
  pendingToolCalls: Map<string, ToolCallRequest> = new Map();

  constructor(init?: {
    messages?: Message[];
    metadata?: Record<string, unknown>;
    sharedState?: Record<string, unknown>;
    environment?: Record<string, unknown>;
    sessionId?: string;
  }) {
    if (init?.messages) this.messages = [...init.messages];
    if (init?.metadata) this.metadata = { ...init.metadata };
    if (init?.sharedState) this.sharedState = { ...init.sharedState };
    if (init?.environment) this.environment = { ...init.environment };
    if (init?.sessionId) this.sessionId = init.sessionId;
  }

  // -- Message operations --

  addMessage(message: Message): void {
    this.messages.push(message);
  }

  getLastUserMessage(): UserMessage | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      if (msg.role === "user" && !("mimeType" in msg)) {
        return msg as UserMessage;
      }
    }
    return undefined;
  }

  getLastAssistantMessage(): AssistantMessage | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      if (msg.role === "assistant" && !("mimeType" in msg)) {
        return msg as AssistantMessage;
      }
    }
    return undefined;
  }

  clearMessages(): void {
    this.messages.length = 0;
  }

  reset(): void {
    this.messages.length = 0;
    this.sharedState = {};
    this.metadata = {};
    // Keep environment and sessionId as they're typically persistent
  }

  get messageCount(): number {
    return this.messages.length;
  }

  get isEmpty(): boolean {
    return this.messages.length === 0;
  }

  // -- Approval workflow --

  get waitingForApproval(): boolean {
    return this.pendingApprovalRequests.length > 0;
  }

  addApprovalRequest(
    toolCall: ToolCallRequest,
    toolName: string
  ): ToolApprovalRequest {
    const request: ToolApprovalRequest = {
      requestId: `approval_${toolCall.callId}`,
      toolCallId: toolCall.callId,
      toolName,
      parameters: toolCall.parameters,
      originalToolCall: toolCall,
    };
    this.pendingApprovalRequests.push(request);
    this.pendingToolCalls.set(toolCall.callId, toolCall);
    return request;
  }

  addApprovalResponse(response: ToolApprovalResponse): void {
    this.approvalResponses.set(response.toolCallId, response);
    // Remove from pending
    this.pendingApprovalRequests = this.pendingApprovalRequests.filter(
      (req) => req.toolCallId !== response.toolCallId
    );
  }

  getApprovalResponse(
    toolCallId: string
  ): ToolApprovalResponse | undefined {
    return this.approvalResponses.get(toolCallId);
  }

  getApprovedToolCalls(): ToolCallRequest[] {
    const approved: ToolCallRequest[] = [];
    const processedIds: string[] = [];

    for (const [callId, response] of this.approvalResponses) {
      if (response.approved && this.pendingToolCalls.has(callId)) {
        approved.push(this.pendingToolCalls.get(callId)!);
        processedIds.push(callId);
      }
    }

    // Clear processed approvals
    for (const callId of processedIds) {
      this.approvalResponses.delete(callId);
      this.pendingToolCalls.delete(callId);
    }

    return approved;
  }

  getRejectedToolCalls(): Array<[string, ToolCallRequest]> {
    const rejected: Array<[string, ToolCallRequest]> = [];
    const processedIds: string[] = [];

    for (const [callId, response] of this.approvalResponses) {
      if (!response.approved && this.pendingToolCalls.has(callId)) {
        rejected.push([callId, this.pendingToolCalls.get(callId)!]);
        processedIds.push(callId);
      }
    }

    // Clear processed rejections
    for (const callId of processedIds) {
      this.approvalResponses.delete(callId);
      this.pendingToolCalls.delete(callId);
    }

    return rejected;
  }

  // -- Serialization --

  toDict(): Record<string, unknown> {
    return {
      messages: this.messages,
      metadata: this.metadata,
      sharedState: this.sharedState,
      environment: this.environment,
      sessionId: this.sessionId,
      createdAt: this.createdAt.toISOString(),
      pendingApprovalRequests: this.pendingApprovalRequests,
    };
  }

  static fromMessages(messages: Message[]): AgentContext {
    return new AgentContext({ messages });
  }

  toString(): string {
    const approvalInfo = this.waitingForApproval
      ? `, ${this.pendingApprovalRequests.length} pending approvals`
      : "";
    return `AgentContext(messages=${this.messageCount}, session=${this.sessionId}${approvalInfo})`;
  }
}
