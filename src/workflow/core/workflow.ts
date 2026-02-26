/**
 * Workflow definition and validation — DAG-based workflow system.
 */

import { v4 as uuidv4 } from "uuid";
import type { BaseStep } from "../steps/base-step.js";
import {
  type Edge,
  type EdgeCondition,
  type WorkflowExecution,
  type WorkflowMetadata,
  type WorkflowValidationResult,
  createEdge,
  createEdgeCondition,
  createValidationResult,
  StepStatus,
} from "./models.js";

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export class Workflow {
  id: string;
  metadata: WorkflowMetadata;
  steps: Map<string, BaseStep>;
  edges: Edge[];
  initialState: Record<string, unknown>;
  startStepId?: string;
  endStepIds: string[];

  constructor(
    metadata: WorkflowMetadata,
    initialState?: Record<string, unknown>,
    workflowId?: string
  ) {
    this.id = workflowId ?? uuidv4();
    this.metadata = metadata;
    this.steps = new Map();
    this.edges = [];
    this.initialState = initialState ?? {};
    this.endStepIds = [];
  }

  // -------------------------------------------------------------------------
  // Builder methods (return this for chaining)
  // -------------------------------------------------------------------------

  addStep(step: BaseStep): this {
    this.steps.set(step.stepId, step);
    return this;
  }

  addEdge(
    fromStep: string | BaseStep,
    toStep: string | BaseStep,
    condition?: Partial<EdgeCondition>
  ): this {
    const fromId = typeof fromStep === "string" ? fromStep : fromStep.stepId;
    const toId = typeof toStep === "string" ? toStep : toStep.stepId;

    // Auto-register step objects
    if (typeof fromStep !== "string") this.steps.set(fromId, fromStep);
    if (typeof toStep !== "string") this.steps.set(toId, toStep);

    this.edges.push(createEdge(fromId, toId, condition));
    return this;
  }

  setStartStep(step: string | BaseStep): this {
    const stepId = typeof step === "string" ? step : step.stepId;
    if (!this.steps.has(stepId)) {
      throw new Error(`Step ${stepId} not found in workflow`);
    }
    this.startStepId = stepId;
    return this;
  }

  addEndStep(step: string | BaseStep): this {
    const stepId = typeof step === "string" ? step : step.stepId;
    if (!this.steps.has(stepId)) {
      throw new Error(`Step ${stepId} not found in workflow`);
    }
    if (!this.endStepIds.includes(stepId)) {
      this.endStepIds.push(stepId);
    }
    return this;
  }

  chain(...steps: BaseStep[]): this {
    if (steps.length < 2) {
      throw new Error("chain() requires at least 2 steps");
    }
    for (let i = 0; i < steps.length - 1; i++) {
      this.addEdge(steps[i], steps[i + 1]);
    }
    this.setStartStep(steps[0]);
    this.addEndStep(steps[steps.length - 1]);
    return this;
  }

  // -------------------------------------------------------------------------
  // Graph queries
  // -------------------------------------------------------------------------

  getStepDependencies(stepId: string): string[] {
    return this.edges
      .filter((e) => e.toStep === stepId)
      .map((e) => e.fromStep);
  }

  getStepDependents(stepId: string): string[] {
    return this.edges
      .filter((e) => e.fromStep === stepId)
      .map((e) => e.toStep);
  }

  getReadySteps(execution: WorkflowExecution): string[] {
    const ready: string[] = [];

    for (const stepId of this.steps.keys()) {
      const stepExec = execution.stepExecutions[stepId];

      // Skip if already running, completed, or failed
      if (
        stepExec &&
        ([StepStatus.RUNNING, StepStatus.COMPLETED, StepStatus.FAILED] as string[]).includes(
          stepExec.status
        )
      ) {
        continue;
      }

      const dependencies = this.getStepDependencies(stepId);

      if (!dependencies.length && !stepExec) {
        // No dependencies and not started — ready if it's the start step
        if (stepId === this.startStepId) ready.push(stepId);
      } else if (dependencies.length) {
        const incomingEdges = this.edges.filter((e) => e.toStep === stepId);
        const isFanIn = incomingEdges.every(
          (e) => e.condition.type === "always"
        );

        if (isFanIn) {
          // AND logic: all deps must be completed
          const allComplete = dependencies.every((dep) => {
            const de = execution.stepExecutions[dep];
            return de && de.status === StepStatus.COMPLETED;
          });
          if (allComplete) ready.push(stepId);
        } else {
          // OR logic: any completed dep with passing condition
          const anyReady = incomingEdges.some((edge) => {
            const de = execution.stepExecutions[edge.fromStep];
            return (
              de &&
              de.status === StepStatus.COMPLETED &&
              this.evaluateEdgeCondition(edge, execution)
            );
          });
          if (anyReady) ready.push(stepId);
        }
      }
    }

    return ready;
  }

  // -------------------------------------------------------------------------
  // Edge condition evaluation
  // -------------------------------------------------------------------------

  evaluateEdgeCondition(edge: Edge, execution: WorkflowExecution): boolean {
    const cond = edge.condition;
    if (cond.type === "always") return true;

    if (cond.type === "output_based") {
      const fromExec = execution.stepExecutions[edge.fromStep];
      if (!fromExec?.outputData) return false;
      if (cond.field && cond.operator && cond.value !== undefined) {
        const fieldValue = fromExec.outputData[cond.field];
        return this.compareValues(fieldValue, cond.operator, cond.value);
      }
    }

    if (cond.type === "state_based") {
      if (cond.field && cond.operator && cond.value !== undefined) {
        const fieldValue = execution.state[cond.field];
        return this.compareValues(fieldValue, cond.operator, cond.value);
      }
    }

    return true; // default for unsupported
  }

  private compareValues(
    left: unknown,
    operator: string,
    right: unknown
  ): boolean {
    try {
      switch (operator) {
        case "==":
          return left === right;
        case "!=":
          return left !== right;
        case ">":
          return (left as number) > (right as number);
        case "<":
          return (left as number) < (right as number);
        case ">=":
          return (left as number) >= (right as number);
        case "<=":
          return (left as number) <= (right as number);
        case "in":
          return Array.isArray(right) && right.includes(left);
        case "not_in":
          return Array.isArray(right) && !right.includes(left);
        default:
          return true;
      }
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  validateWorkflow(): WorkflowValidationResult {
    const result = createValidationResult();

    if (this.steps.size === 0) {
      result.errors.push("Workflow has no steps");
      result.isValid = false;
    }

    if (!this.startStepId) {
      result.errors.push("No start step specified");
      result.isValid = false;
    } else if (!this.steps.has(this.startStepId)) {
      result.errors.push(
        `Start step ${this.startStepId} not found in workflow`
      );
      result.isValid = false;
    }

    if (!this.endStepIds.length) {
      result.warnings.push(
        "No end steps specified - workflow may run indefinitely"
      );
    } else {
      for (const endId of this.endStepIds) {
        if (!this.steps.has(endId)) {
          result.errors.push(`End step ${endId} not found in workflow`);
          result.isValid = false;
        }
      }
    }

    for (const edge of this.edges) {
      if (!this.steps.has(edge.fromStep)) {
        result.errors.push(
          `Edge references non-existent step: ${edge.fromStep}`
        );
        result.isValid = false;
      }
      if (!this.steps.has(edge.toStep)) {
        result.errors.push(
          `Edge references non-existent step: ${edge.toStep}`
        );
        result.isValid = false;
      }
    }

    // Cycle detection
    const [hasCycles, cycleInfo] = this.detectCycles();
    result.hasCycles = hasCycles;
    if (hasCycles) {
      result.errors.push(`Workflow contains cycles: ${cycleInfo}`);
      result.isValid = false;
    }

    // Unreachable steps
    result.unreachableSteps = this.findUnreachableSteps();
    if (result.unreachableSteps.length) {
      result.warnings.push(
        `Unreachable steps found: ${result.unreachableSteps}`
      );
    }

    // Check steps with no outgoing edges and not end steps
    for (const stepId of this.steps.keys()) {
      if (!this.endStepIds.includes(stepId)) {
        const outgoing = this.edges.filter((e) => e.fromStep === stepId);
        if (!outgoing.length) {
          result.warnings.push(
            `Step '${stepId}' has no outgoing edges but is not marked as an end step`
          );
        }
      }
    }

    return result;
  }

  private detectCycles(): [boolean, string | undefined] {
    if (!this.startStepId) return [false, undefined];

    const visited = new Set<string>();
    const recStack = new Set<string>();

    const dfs = (
      stepId: string,
      path: string[]
    ): [boolean, string | undefined] => {
      if (recStack.has(stepId)) {
        const cycleStart = path.indexOf(stepId);
        const cycle = [...path.slice(cycleStart), stepId].join(" -> ");
        return [true, cycle];
      }
      if (visited.has(stepId)) return [false, undefined];

      visited.add(stepId);
      recStack.add(stepId);

      for (const next of this.getStepDependents(stepId)) {
        const [hasCycle, info] = dfs(next, [...path, stepId]);
        if (hasCycle) return [true, info];
      }

      recStack.delete(stepId);
      return [false, undefined];
    };

    return dfs(this.startStepId, []);
  }

  private findUnreachableSteps(): string[] {
    if (!this.startStepId) return [...this.steps.keys()];

    const reachable = new Set<string>();
    const toVisit = [this.startStepId];

    while (toVisit.length) {
      const current = toVisit.pop()!;
      if (reachable.has(current)) continue;
      reachable.add(current);
      toVisit.push(...this.getStepDependents(current));
    }

    return [...this.steps.keys()].filter((id) => !reachable.has(id));
  }

  // -------------------------------------------------------------------------
  // Structure hash for checkpoint compatibility
  // -------------------------------------------------------------------------

  computeStructureHash(): string {
    return computeWorkflowStructureHash(
      this.steps,
      this.edges,
      this.startStepId,
      this.endStepIds
    );
  }

  // -------------------------------------------------------------------------
  // Execution plan (visualization)
  // -------------------------------------------------------------------------

  getExecutionPlan(): Record<string, unknown> {
    return {
      workflowId: this.id,
      metadata: { ...this.metadata },
      steps: Object.fromEntries(
        [...this.steps.entries()].map(([id, step]) => [id, step.getSchema()])
      ),
      edges: this.edges.map((e) => ({ ...e })),
      startStep: this.startStepId,
      endSteps: this.endStepIds,
      validation: this.validateWorkflow(),
    };
  }
}

// ---------------------------------------------------------------------------
// Structure hash helper
// ---------------------------------------------------------------------------

export function computeWorkflowStructureHash(
  steps: Map<string, BaseStep>,
  edges: Edge[],
  startStepId?: string,
  endStepIds: string[] = []
): string {
  const structure = {
    steps: Object.fromEntries(
      [...steps.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, step]) => [
          id,
          {
            type: step.constructor.name,
            inputTypeName: step.inputTypeName,
            outputTypeName: step.outputTypeName,
          },
        ])
    ),
    edges: [...edges]
      .sort((a, b) =>
        a.fromStep === b.fromStep
          ? a.toStep.localeCompare(b.toStep)
          : a.fromStep.localeCompare(b.fromStep)
      )
      .map((e) => ({
        from: e.fromStep,
        to: e.toStep,
        conditionType: e.condition.type,
      })),
    startStep: startStepId,
    endSteps: [...endStepIds].sort(),
  };

  // Simple hash — use crypto if available, else fall back to basic hash
  const jsonStr = JSON.stringify(structure);
  let hash = 0;
  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(16).padStart(16, "0").slice(0, 16);
}
