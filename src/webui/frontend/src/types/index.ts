/**
 * Main type export file - central hub for all PicoAgents types
 */

export * from "./picoagents";

// Import core types from picoagents for convenience
import type {
  Entity,
  AgentInfo,
  OrchestratorInfo,
  WorkflowInfo,
  SessionInfo,
  Message,
  StreamEvent
} from "./picoagents";

// Application state types
export interface AppState {
  entities: Entity[];
  agents: AgentInfo[];
  orchestrators: OrchestratorInfo[];
  workflows: WorkflowInfo[];
  selectedEntity?: Entity;
  currentSession?: SessionInfo;
  isLoading: boolean;
  error?: string;
}

// Chat UI state
export interface ChatState {
  messages: Message[];
  isStreaming: boolean;
  streamEvents: StreamEvent[];
}

// Legacy support types for backward compatibility
export type AgentType = "agent" | "orchestrator" | "workflow";
export type AgentSource = "directory" | "memory";

// Re-export specific types for external usage
export type {
  Entity,
  AgentInfo,
  OrchestratorInfo,
  WorkflowInfo,
  SessionInfo,
  Message,
  StreamEvent,
  RunEntityRequest,
  HealthResponse
} from "./picoagents";