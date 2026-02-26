/**
 * Orchestration module for multi-agent coordination.
 *
 * Provides patterns for coordinating multiple agents:
 * - RoundRobinOrchestrator: Cycles through agents in fixed order
 * - AIOrchestrator: LLM-driven agent selection
 * - PlanBasedOrchestrator: LLM-generated execution plans with retry logic
 */

export { BaseOrchestrator } from "./base.js";
export { RoundRobinOrchestrator } from "./round-robin.js";
export {
  AIOrchestrator,
  AgentSelectionSchema,
  type AgentSelection,
} from "./ai.js";
export {
  PlanBasedOrchestrator,
  StepProgressEvaluationSchema,
  type StepProgressEvaluation,
  PlanStepSchema,
  type PlanStep,
  ExecutionPlanSchema,
  type ExecutionPlan,
} from "./plan.js";
