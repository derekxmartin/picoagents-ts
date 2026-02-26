/**
 * Default workflow and step templates for demonstration.
 */

import { createStepMetadata, createWorkflowMetadata } from "./core/models.js";
import { Workflow } from "./core/workflow.js";
import { EchoStep } from "./steps/echo-step.js";

/**
 * Create a simple echo chain workflow for demonstration.
 */
export function createEchoChainWorkflow(): Workflow {
  const metadata = createWorkflowMetadata("echo-chain", {
    description: "Simple echo chain workflow for testing",
    version: "1.0.0",
  });

  const step1 = new EchoStep("step-1", createStepMetadata("Echo Step 1"), {
    prefix: "Step 1: ",
  });
  const step2 = new EchoStep("step-2", createStepMetadata("Echo Step 2"), {
    prefix: "Step 2: ",
  });
  const step3 = new EchoStep("step-3", createStepMetadata("Echo Step 3"), {
    prefix: "Step 3: ",
  });

  const workflow = new Workflow(metadata);
  workflow.chain(step1, step2, step3);

  return workflow;
}

/**
 * Get default step templates for demonstration.
 */
export function getDefaultSteps(): EchoStep[] {
  return [
    new EchoStep("echo-step", createStepMetadata("Echo Step"), {
      prefix: "Echo: ",
    }),
  ];
}
