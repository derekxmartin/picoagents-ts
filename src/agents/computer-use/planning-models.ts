/**
 * Planning models for structured LLM interactions in computer use.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const InterfaceRepresentation = {
  TEXT: "text",
  HTML: "html",
  VISUAL: "visual",
  HYBRID: "hybrid",
} as const;
export type InterfaceRepresentation =
  (typeof InterfaceRepresentation)[keyof typeof InterfaceRepresentation];

export const PlanningStrategy = {
  IMPLICIT: "implicit",
  EXPLICIT: "explicit",
  AUTO: "auto",
} as const;
export type PlanningStrategy =
  (typeof PlanningStrategy)[keyof typeof PlanningStrategy];

// ---------------------------------------------------------------------------
// Structured types for LLM responses
// ---------------------------------------------------------------------------

export interface PageObservation {
  url: string;
  title: string;
  summary: string;
  keyElements: string[];
  taskRelevance: string;
  isTaskComplete: boolean;
  confidence: number; // 0-1
}

export interface NextActionPlan {
  actionType: string;
  selector?: string;
  value?: string;
  coordinates?: [number, number];
  reasoning: string;
  expectedOutcome: string;
  confidence: number;
}

export interface MultiStepPlan {
  steps: NextActionPlan[];
  overallStrategy: string;
  estimatedComplexity: "simple" | "moderate" | "complex";
  requiresExploration: boolean;
}

export interface PlanningDecision {
  chosenStrategy: PlanningStrategy;
  reasoning: string;
  taskComplexity: string;
}

export interface TaskCompletion {
  isComplete: boolean;
  completionConfidence: number; // 0-1
  summary: string;
  remainingWork?: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface DOMFilter {
  maxTextLength: number;
  includeHidden: boolean;
  interactiveOnly: boolean;
  excludeTags: string[];
}

export function createDOMFilter(
  overrides?: Partial<DOMFilter>
): DOMFilter {
  return {
    maxTextLength: 2000,
    includeHidden: false,
    interactiveOnly: false,
    excludeTags: ["script", "style", "meta", "link"],
    ...overrides,
  };
}

export interface InterfaceConfig {
  representation: InterfaceRepresentation;
  domFilter: DOMFilter;
  includeScreenshot: boolean;
  screenshotDescription: boolean;
}

export function createInterfaceConfig(
  overrides?: Partial<InterfaceConfig>
): InterfaceConfig {
  return {
    representation: InterfaceRepresentation.HYBRID,
    domFilter: createDOMFilter(),
    includeScreenshot: true,
    screenshotDescription: true,
    ...overrides,
  };
}
