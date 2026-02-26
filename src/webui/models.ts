/**
 * WebUI-specific models - reuse PicoAgents types everywhere else!
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Entity Info Types
// ---------------------------------------------------------------------------

export const EntityInfoSchema = z.object({
  id: z.string().describe("Unique identifier for the entity"),
  name: z.string().optional().describe("Human-readable name"),
  description: z.string().optional().describe("Entity description"),
  type: z.string().describe("Entity type (agent, orchestrator, workflow)"),
  source: z
    .string()
    .describe("Source of discovery (directory, memory)"),
  tools: z
    .array(z.string())
    .default([])
    .describe("Available tools/functions"),
  exampleTasks: z
    .array(z.string())
    .default([])
    .describe("Example tasks to help users discover capabilities"),
});

export type EntityInfo = z.infer<typeof EntityInfoSchema>;

export const AgentInfoSchema = EntityInfoSchema.extend({
  type: z.literal("agent").default("agent"),
  model: z.string().optional().describe("LLM model being used"),
  memoryType: z.string().optional().describe("Type of memory system"),
});

export type AgentInfo = z.infer<typeof AgentInfoSchema>;

export const OrchestratorInfoSchema = EntityInfoSchema.extend({
  type: z.literal("orchestrator").default("orchestrator"),
  orchestratorType: z
    .string()
    .describe("Type of orchestrator (round_robin, ai, plan)"),
  agents: z
    .array(z.string())
    .default([])
    .describe("Participating agent names"),
  terminationConditions: z
    .array(z.string())
    .default([])
    .describe("Active termination conditions"),
});

export type OrchestratorInfo = z.infer<typeof OrchestratorInfoSchema>;

export const WorkflowInfoSchema = EntityInfoSchema.extend({
  type: z.literal("workflow").default("workflow"),
  steps: z
    .array(z.string())
    .default([])
    .describe("Workflow step IDs"),
  inputSchema: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Input schema definition"),
  startStep: z.string().optional().describe("Starting step ID"),
});

export type WorkflowInfo = z.infer<typeof WorkflowInfoSchema>;

/** Union type for all entity discovery info */
export type Entity = AgentInfo | OrchestratorInfo | WorkflowInfo;

// ---------------------------------------------------------------------------
// WebUI Stream Event
// ---------------------------------------------------------------------------

export interface WebUIStreamEvent {
  sessionId: string;
  timestamp: Date;
  event: unknown;
}

// ---------------------------------------------------------------------------
// Request/Response types
// ---------------------------------------------------------------------------

export interface RunEntityRequest {
  messages?: Array<{ role: string; content: string; source?: string }>;
  inputData?: unknown;
  sessionId?: string;
  streamTokens?: boolean;
  approvalResponses?: Array<{
    requestId: string;
    toolCallId: string;
    approved: boolean;
    reason?: string;
  }>;
}

export interface HealthResponse {
  status: string;
  entitiesCount: number;
}

export interface StatsResponse {
  entities: {
    total: number;
    byType: {
      agents: number;
      orchestrators: number;
      workflows: number;
    };
  };
  sessions: {
    totalSessions: number;
    totalMessages: number;
  };
}

export interface SessionInfo {
  id: string;
  entityId: string;
  entityType: string;
  createdAt: string;
  messageCount: number;
  lastActivity: string;
}
