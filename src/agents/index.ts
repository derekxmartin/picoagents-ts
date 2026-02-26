/**
 * Agent module exports.
 */

export { BaseAgent } from "./base.js";
export { Agent } from "./agent.js";
export { AgentAsTool, type ResultStrategy } from "./agent-as-tool.js";
export {
  AgentError,
  AgentExecutionError,
  AgentConfigurationError,
  AgentToolError,
  AgentMemoryError,
  AgentTimeoutError,
} from "./errors.js";

// Computer use
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
  createNavigateTool,
  createClickTool,
  createTypeTool,
  createSelectTool,
  createPressTool,
  createHoverTool,
  createScrollTool,
  createObservePageTool,
  createPlaywrightTools,
  ComputerUseAgent,
} from "./computer-use/index.js";
