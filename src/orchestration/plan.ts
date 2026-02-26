/**
 * Plan-based orchestration pattern.
 *
 * Uses LLM-based planning to create step-by-step execution plans
 * with agent assignments and retry logic.
 */

import { z } from "zod";
import type { BaseAgent } from "../agents/base.js";
import type { BaseChatCompletionClient } from "../llm/base.js";
import type { Message } from "../messages.js";
import type { BaseTermination } from "../termination/base.js";
import type { AgentResponse } from "../types.js";
import { BaseOrchestrator } from "./base.js";

// ---------------------------------------------------------------------------
// Structured output schemas
// ---------------------------------------------------------------------------

export const StepProgressEvaluationSchema = z.object({
  stepCompleted: z
    .boolean()
    .describe("Whether the step was successfully completed"),
  failureReason: z
    .string()
    .describe(
      "Brief explanation if step failed, use 'None' if successful"
    ),
  confidenceScore: z
    .number()
    .min(0)
    .max(1)
    .describe("Confidence in the evaluation (0.0 to 1.0)"),
  suggestedImprovements: z
    .array(z.string())
    .describe("Specific suggestions for retry if step failed"),
});

export type StepProgressEvaluation = z.infer<
  typeof StepProgressEvaluationSchema
>;

export const PlanStepSchema = z.object({
  task: z.string().describe("Clear, actionable task description"),
  agentName: z
    .string()
    .describe("Name of the agent that should handle this step"),
  reasoning: z
    .string()
    .describe("Brief explanation for why this agent was chosen"),
});

export type PlanStep = z.infer<typeof PlanStepSchema>;

export const ExecutionPlanSchema = z.object({
  steps: z
    .array(PlanStepSchema)
    .describe("Ordered list of execution steps"),
});

export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

// ---------------------------------------------------------------------------
// PlanBasedOrchestrator
// ---------------------------------------------------------------------------

/**
 * Plan-based orchestrator that creates explicit plans and retries failed steps.
 */
export class PlanBasedOrchestrator extends BaseOrchestrator {
  modelClient: BaseChatCompletionClient;
  maxStepRetries: number;

  // Plan execution state
  executionPlan: ExecutionPlan | null = null;
  currentStepIndex = 0;
  currentStepRetryCount = 0;
  initialTask: string | null = null;

  // Runtime tracking
  stepAttempts: Map<number, AgentResponse[]> = new Map();
  stepResults: Map<number, AgentResponse> = new Map();
  retryInstructions: Map<number, string> = new Map();

  private agentCapabilitiesCache: string | null = null;

  constructor(
    agents: BaseAgent[],
    termination: BaseTermination,
    modelClient: BaseChatCompletionClient,
    maxIterations = 50,
    maxStepRetries = 3
  ) {
    super({ agents, termination, maxIterations });
    this.modelClient = modelClient;
    this.maxStepRetries = maxStepRetries;
  }

  async selectNextAgent(): Promise<BaseAgent> {
    // Create plan on first iteration
    if (!this.executionPlan) {
      if (this.sharedMessages.length > 0) {
        this.initialTask = this.sharedMessages[0].content;
        this.executionPlan = await this.createPlan(this.initialTask);
      } else {
        throw new Error("No initial task found to create plan");
      }
    }

    // Check if we've completed all steps
    if (this.currentStepIndex >= this.executionPlan.steps.length) {
      return this.agents[0]; // Fallback agent
    }

    const currentStep = this.executionPlan.steps[this.currentStepIndex];
    return this._findAgentByName(currentStep.agentName);
  }

  async prepareContextForAgent(
    _agent: BaseAgent
  ): Promise<string | Message | Message[]> {
    if (
      !this.executionPlan ||
      this.currentStepIndex >= this.executionPlan.steps.length
    ) {
      return [...this.sharedMessages];
    }

    const currentStep = this.executionPlan.steps[this.currentStepIndex];

    // Get curated context for this step
    const context = this._extractRelevantContext(currentStep);

    // Add step-specific task message
    context.push({
      role: "user" as const,
      content: this._formatStepTask(currentStep),
      source: "plan_orchestrator",
      timestamp: new Date(),
    });

    return context;
  }

  async updateSharedState(result: AgentResponse): Promise<void> {
    const messages = result.context?.messages ?? [];
    // Extract new messages excluding UserMessage context
    const newMessages = messages.filter((msg) => msg.role !== "user");
    this.sharedMessages.push(...newMessages);

    if (
      !this.executionPlan ||
      this.currentStepIndex >= this.executionPlan.steps.length
    ) {
      return;
    }

    // Track attempt
    if (!this.stepAttempts.has(this.currentStepIndex)) {
      this.stepAttempts.set(this.currentStepIndex, []);
    }
    this.stepAttempts.get(this.currentStepIndex)!.push(result);

    // Evaluate step progress
    const currentStep = this.executionPlan.steps[this.currentStepIndex];
    const progressEval = await this.evaluateStepProgress(
      currentStep,
      result
    );

    if (progressEval.stepCompleted) {
      this.stepResults.set(this.currentStepIndex, result);
      this.currentStepIndex++;
      this.currentStepRetryCount = 0;
    } else {
      this.currentStepRetryCount++;

      if (this.currentStepRetryCount <= this.maxStepRetries) {
        this.retryInstructions.set(
          this.currentStepIndex,
          this._createRetryInstructions(currentStep, progressEval)
        );
      } else {
        // Max retries exceeded — move on
        this.currentStepIndex++;
        this.currentStepRetryCount = 0;
      }
    }
  }

  async createPlan(task: string): Promise<ExecutionPlan> {
    const capabilities = this._getCachedCapabilities();

    const planningPrompt = `You are a helpful assistant that breaks down tasks into executable steps.

Available agents and their capabilities:
${capabilities}

User task: ${task}

Generate a concise set of step-by-step execution plan. For each step:
- Assign it to the agent best suited for that type of work
- Provide clear, actionable task description
- Explain briefly why that agent was chosen

Keep it simple and focused. Multiple steps can use the same agent if appropriate.
The plans need not be too long - if only 2 or 3 steps are needed, that's perfectly fine.`;

    try {
      const result = await this.modelClient.create(
        [
          {
            role: "user" as const,
            content: planningPrompt,
            source: "planner",
            timestamp: new Date(),
          },
        ],
        { outputSchema: ExecutionPlanSchema as unknown as Record<string, unknown> }
      );

      if (result.structuredOutput) {
        return result.structuredOutput as ExecutionPlan;
      }
      return this._createFallbackPlan(task);
    } catch (e) {
      console.warn(`Plan generation failed: ${e}`);
      return this._createFallbackPlan(task);
    }
  }

  async evaluateStepProgress(
    step: PlanStep,
    result: AgentResponse
  ): Promise<StepProgressEvaluation> {
    const messages = result.context?.messages ?? [];
    let agentOutput = "";
    for (const msg of messages) {
      if (msg.role !== "user") {
        agentOutput += `${msg.content}\n`;
      }
    }

    if (!agentOutput.trim()) {
      return {
        stepCompleted: false,
        failureReason: "No meaningful output detected",
        confidenceScore: 0.9,
        suggestedImprovements: [
          "Provide more specific instructions",
          "Add examples of expected output",
        ],
      };
    }

    const evaluationPrompt = `Evaluate whether the following step was successfully completed based on the agent's output.

Step Task: ${step.task}
Expected Agent: ${step.agentName}
Reasoning: ${step.reasoning}

Agent's Output:
${agentOutput}

Evaluate:
1. Was the step task completed successfully?
2. If not, what was the main failure reason?
3. How confident are you in this assessment (0.0 to 1.0)?
4. If the step failed, provide 2-3 specific suggestions for improvement.

Consider the step successful if the agent made meaningful progress toward the stated goal, even if not perfect.`;

    try {
      const evalResult = await this.modelClient.create(
        [
          {
            role: "user" as const,
            content: evaluationPrompt,
            source: "step_evaluator",
            timestamp: new Date(),
          },
        ],
        { outputSchema: StepProgressEvaluationSchema as unknown as Record<string, unknown> }
      );

      if (evalResult.structuredOutput) {
        return evalResult.structuredOutput as StepProgressEvaluation;
      }
      return this._fallbackStepEvaluation(agentOutput);
    } catch (e) {
      console.warn(`LLM step evaluation failed: ${e}`);
      return this._fallbackStepEvaluation(agentOutput);
    }
  }

  override getAgentCapabilitiesSummary(): string {
    return this._getCachedCapabilities();
  }

  protected override _getPatternMetadata(): Record<string, unknown> {
    const base = super._getPatternMetadata();

    if (this.executionPlan) {
      const completedSteps = this.stepResults.size;
      const failedSteps = Math.max(
        0,
        this.currentStepIndex - completedSteps
      );

      return {
        ...base,
        plan: this.executionPlan,
        currentStepIndex: this.currentStepIndex,
        stepsCompleted: completedSteps,
        stepsFailed: failedSteps,
        totalRetries: Array.from(this.stepAttempts.values()).reduce(
          (sum, attempts) => sum + Math.max(0, attempts.length - 1),
          0
        ),
        currentStepRetryCount: this.currentStepRetryCount,
      };
    }

    return base;
  }

  protected override _resetForRun(): void {
    super._resetForRun();
    this.executionPlan = null;
    this.currentStepIndex = 0;
    this.currentStepRetryCount = 0;
    this.initialTask = null;
    this.stepAttempts = new Map();
    this.stepResults = new Map();
    this.retryInstructions = new Map();
    this.agentCapabilitiesCache = null;
  }

  // Private helpers

  private _getCachedCapabilities(): string {
    if (this.agentCapabilitiesCache === null) {
      this.agentCapabilitiesCache =
        super.getAgentCapabilitiesSummary();
    }
    return this.agentCapabilitiesCache;
  }

  private _findAgentByName(name: string): BaseAgent {
    const nameLower = name.toLowerCase().trim();

    for (const agent of this.agents) {
      if (agent.name.toLowerCase() === nameLower) return agent;
    }
    for (const agent of this.agents) {
      if (
        nameLower.includes(agent.name.toLowerCase()) ||
        agent.name.toLowerCase().includes(nameLower)
      ) {
        return agent;
      }
    }

    console.warn(
      `Agent '${name}' not found, using fallback: ${this.agents[0].name}`
    );
    return this.agents[0];
  }

  private _extractRelevantContext(_step: PlanStep): Message[] {
    // Curate context for focused execution (last 5 messages)
    return this.sharedMessages.length > 5
      ? this.sharedMessages.slice(-5)
      : [...this.sharedMessages];
  }

  private _formatStepTask(step: PlanStep): string {
    let baseTask = `STEP ${this.currentStepIndex + 1}: ${step.task}`;

    if (
      this.currentStepRetryCount > 0 &&
      this.retryInstructions.has(this.currentStepIndex)
    ) {
      const retryInfo = this.retryInstructions.get(
        this.currentStepIndex
      )!;
      baseTask += `\n\nRETRY INSTRUCTIONS (Attempt ${this.currentStepRetryCount + 1}):\n${retryInfo}`;
    }

    return baseTask;
  }

  private _createRetryInstructions(
    _step: PlanStep,
    progressEval: StepProgressEvaluation
  ): string {
    let instructions = `Previous attempt failed: ${progressEval.failureReason ?? "Unknown reason"}\n`;

    const attemptCount =
      this.stepAttempts.get(this.currentStepIndex)?.length ?? 0;
    if (attemptCount > 0) {
      instructions += `This is retry attempt ${attemptCount + 1}. Please try a different approach.`;
    }

    return instructions;
  }

  private _createFallbackPlan(task: string): ExecutionPlan {
    return {
      steps: [
        {
          task: `Complete the task: ${task}`,
          agentName: this.agents[0].name,
          reasoning: "Single step plan fallback",
        },
      ],
    };
  }

  private _fallbackStepEvaluation(
    agentOutput: string
  ): StepProgressEvaluation {
    const outputLower = agentOutput.toLowerCase();
    const hasMeaningfulContent = agentOutput.trim().length > 20;
    const hasErrorIndicators = [
      "error",
      "failed",
      "cannot",
      "unable",
      "sorry",
    ].some((w) => outputLower.includes(w));

    if (hasMeaningfulContent && !hasErrorIndicators) {
      return {
        stepCompleted: true,
        failureReason: "None",
        confidenceScore: 0.7,
        suggestedImprovements: [],
      };
    }
    return {
      stepCompleted: false,
      failureReason:
        "Output suggests task was not completed successfully",
      confidenceScore: 0.6,
      suggestedImprovements: [
        "Provide clearer instructions",
        "Break task into smaller parts",
        "Add specific examples",
      ],
    };
  }
}
