/**
 * PicoAgents-TS — A lightweight, type-safe framework for building AI agents with LLMs.
 *
 * TypeScript port of the Python picoagents framework (v0.4.0).
 * Supports tool calling, memory, streaming, workflows, and computer use.
 */

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------
export { CancellationToken } from "./cancellation-token.js";

// ---------------------------------------------------------------------------
// Component configuration
// ---------------------------------------------------------------------------
export {
  type ComponentModel,
  ComponentBase,
  type ComponentType,
} from "./component-config.js";

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
export {
  type MiddlewareContext,
  BaseMiddleware,
  MiddlewareChain,
  LoggingMiddleware,
  RateLimitMiddleware,
  PIIRedactionMiddleware,
  GuardrailMiddleware,
  MetricsMiddleware,
} from "./middleware.js";

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------
export {
  getInstructions,
  TASK_COMPLETION_BLOCK,
  EFFICIENCY_BLOCK,
  BEST_PRACTICES_BLOCK,
  ANTI_HALLUCINATION_BLOCK,
  TOOL_GUIDES,
} from "./instructions.js";

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
export {
  type LoopContext,
  TerminationCondition,
  MaxRestartsTermination,
  CompletionCheckHook,
  CompositeTermination,
  BaseStartHook,
  BaseEndHook,
  PlanningHook,
} from "./hooks.js";

// ---------------------------------------------------------------------------
// Compaction
// ---------------------------------------------------------------------------
export {
  type CompactionStrategy,
  NoCompaction,
  HeadTailCompaction,
  SlidingWindowCompaction,
} from "./compaction.js";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
export {
  AgentContext,
  type ToolApprovalRequest,
  type ToolApprovalResponse,
} from "./context.js";

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
export type {
  SystemMessage,
  UserMessage,
  AssistantMessage,
  ToolMessage,
  MultiModalMessage,
  ToolCallRequest,
  Message,
} from "./messages.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type {
  Usage,
  ToolResult,
  AgentResponse,
  ChatCompletionResult,
  ChatCompletionChunk,
  AgentEvent,
} from "./types.js";
export { createEvent } from "./types.js";

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
export {
  BaseTool,
  ApprovalMode,
  FunctionTool,
  createTool,
  ThinkTool,
  CalculatorTool,
  DateTimeTool,
  JSONParserTool,
  RegexTool,
  TaskStatusTool,
} from "./tools/index.js";

// ---------------------------------------------------------------------------
// LLM clients
// ---------------------------------------------------------------------------
export {
  BaseChatCompletionClient,
  OpenAIChatCompletionClient,
  AnthropicChatCompletionClient,
} from "./llm/index.js";

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------
export {
  BaseMemory,
  type MemoryContent,
  type MemoryQueryResult,
  ListMemory,
  FileMemory,
} from "./memory/index.js";

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------
export {
  BaseAgent,
  Agent,
  AgentAsTool,
  AgentError,
  AgentExecutionError,
  AgentConfigurationError,
  AgentToolError,
  AgentMemoryError,
  AgentTimeoutError,
} from "./agents/index.js";

// ---------------------------------------------------------------------------
// Computer use
// ---------------------------------------------------------------------------
export {
  ActionType,
  type Action,
  type ActionResult,
  type InterfaceState,
  BaseInterfaceClient,
  PlaywrightWebClient,
  InterfaceRepresentation,
  PlanningStrategy,
  type PageObservation,
  type NextActionPlan,
  type MultiStepPlan,
  type PlanningDecision,
  type TaskCompletion,
  type DOMFilter,
  createDOMFilter,
  type InterfaceConfig,
  createInterfaceConfig,
  createPlaywrightTools,
  ComputerUseAgent,
} from "./agents/computer-use/index.js";

// ---------------------------------------------------------------------------
// Workflow system
// ---------------------------------------------------------------------------
export {
  // Core
  Workflow,
  WorkflowRunner,
  WorkflowContext,
  StepStatus,
  WorkflowStatus,
  WorkflowEventType,
  type Edge,
  type EdgeCondition,
  type StepExecution,
  type WorkflowExecution,
  type StepMetadata,
  type WorkflowMetadata,
  type WorkflowValidationResult,
  type WorkflowEvent,
  createEdge,
  createEdgeCondition,
  createStepExecution,
  createWorkflowExecution,
  createStepMetadata,
  createWorkflowMetadata,
  createValidationResult,
  // Checkpoint
  type WorkflowCheckpoint,
  type CheckpointMetadata,
  type CheckpointValidationResult,
  type CheckpointConfig,
  CheckpointStore,
  InMemoryCheckpointStore,
  createCheckpointFromExecution,
  createCheckpointConfig,
  // Steps
  BaseStep,
  EchoStep,
  FunctionStep,
  HttpStep,
  TransformStep,
  PicoAgentStep,
  // Defaults
  createEchoChainWorkflow,
  getDefaultSteps,
} from "./workflow/index.js";

// ---------------------------------------------------------------------------
// Termination conditions (orchestration-level)
// ---------------------------------------------------------------------------
export {
  BaseTermination,
  type StopMessage,
  MaxMessageTermination,
  TextMentionTermination,
  TimeoutTermination,
  TokenUsageTermination,
  CancellationTermination,
  ExternalTermination,
  FunctionCallTermination,
  HandoffTermination,
  CompositeTermination as OrchestrationCompositeTermination,
} from "./termination/index.js";

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
export {
  BaseOrchestrator,
  RoundRobinOrchestrator,
  AIOrchestrator,
  AgentSelectionSchema,
  type AgentSelection,
  PlanBasedOrchestrator,
  StepProgressEvaluationSchema,
  type StepProgressEvaluation,
  PlanStepSchema,
  type PlanStep,
  ExecutionPlanSchema,
  type ExecutionPlan,
} from "./orchestration/index.js";

// Orchestration types
export type {
  OrchestrationResponse,
  OrchestrationEvent,
  OrchestrationStartEvent,
  AgentSelectionEvent,
  AgentExecutionStartEvent,
  AgentExecutionCompleteEvent,
  OrchestrationCompleteEvent,
} from "./types.js";

// ---------------------------------------------------------------------------
// WebUI
// ---------------------------------------------------------------------------
export {
  PicoAgentsWebUIServer,
  createApp as createWebUIApp,
  EntityRegistry,
  SessionManager,
  InMemorySessionStore,
  ExecutionEngine,
  WebUIServer,
  serve as serveWebUI,
} from "./webui/index.js";

export type {
  Entity,
  EntityInfo,
  AgentInfo,
  OrchestratorInfo,
  WorkflowInfo,
  WebUIStreamEvent,
  RunEntityRequest,
  HealthResponse,
  StatsResponse,
  SessionInfo,
  SessionStore,
  ServeOptions,
} from "./webui/index.js";
