/**
 * Integration test: Barrel exports.
 *
 * Verifies that the main index.ts exports all expected symbols.
 */

import { describe, it, expect } from "vitest";
import * as picoagents from "../index.js";

describe("Barrel exports", () => {
  it("should export CancellationToken", () => {
    expect(picoagents.CancellationToken).toBeDefined();
  });

  it("should export component config", () => {
    expect(picoagents.ComponentBase).toBeDefined();
  });

  it("should export middleware classes", () => {
    expect(picoagents.BaseMiddleware).toBeDefined();
    expect(picoagents.MiddlewareChain).toBeDefined();
    expect(picoagents.LoggingMiddleware).toBeDefined();
    expect(picoagents.RateLimitMiddleware).toBeDefined();
    expect(picoagents.PIIRedactionMiddleware).toBeDefined();
    expect(picoagents.GuardrailMiddleware).toBeDefined();
    expect(picoagents.MetricsMiddleware).toBeDefined();
  });

  it("should export instructions", () => {
    expect(picoagents.getInstructions).toBeDefined();
    expect(typeof picoagents.getInstructions()).toBe("string");
    expect(picoagents.TOOL_GUIDES).toBeDefined();
  });

  it("should export hooks", () => {
    expect(picoagents.TerminationCondition).toBeDefined();
    expect(picoagents.MaxRestartsTermination).toBeDefined();
    expect(picoagents.CompletionCheckHook).toBeDefined();
    expect(picoagents.BaseStartHook).toBeDefined();
    expect(picoagents.BaseEndHook).toBeDefined();
  });

  it("should export compaction", () => {
    expect(picoagents.NoCompaction).toBeDefined();
    expect(picoagents.HeadTailCompaction).toBeDefined();
    expect(picoagents.SlidingWindowCompaction).toBeDefined();
  });

  it("should export context", () => {
    expect(picoagents.AgentContext).toBeDefined();
  });

  it("should export tools", () => {
    expect(picoagents.BaseTool).toBeDefined();
    expect(picoagents.FunctionTool).toBeDefined();
    expect(picoagents.createTool).toBeDefined();
    expect(picoagents.ApprovalMode).toBeDefined();
    expect(picoagents.ThinkTool).toBeDefined();
    expect(picoagents.CalculatorTool).toBeDefined();
    expect(picoagents.DateTimeTool).toBeDefined();
  });

  it("should export LLM clients", () => {
    expect(picoagents.BaseChatCompletionClient).toBeDefined();
    expect(picoagents.OpenAIChatCompletionClient).toBeDefined();
    expect(picoagents.AnthropicChatCompletionClient).toBeDefined();
  });

  it("should export memory", () => {
    expect(picoagents.BaseMemory).toBeDefined();
    expect(picoagents.ListMemory).toBeDefined();
    expect(picoagents.FileMemory).toBeDefined();
  });

  it("should export agents", () => {
    expect(picoagents.BaseAgent).toBeDefined();
    expect(picoagents.Agent).toBeDefined();
    expect(picoagents.AgentAsTool).toBeDefined();
    expect(picoagents.AgentError).toBeDefined();
  });

  it("should export computer use", () => {
    expect(picoagents.ActionType).toBeDefined();
    expect(picoagents.BaseInterfaceClient).toBeDefined();
    expect(picoagents.PlaywrightWebClient).toBeDefined();
    expect(picoagents.ComputerUseAgent).toBeDefined();
    expect(picoagents.createPlaywrightTools).toBeDefined();
    expect(picoagents.createDOMFilter).toBeDefined();
    expect(picoagents.createInterfaceConfig).toBeDefined();
  });

  it("should export workflow system", () => {
    expect(picoagents.Workflow).toBeDefined();
    expect(picoagents.WorkflowRunner).toBeDefined();
    expect(picoagents.WorkflowContext).toBeDefined();
    expect(picoagents.StepStatus).toBeDefined();
    expect(picoagents.WorkflowStatus).toBeDefined();
    expect(picoagents.WorkflowEventType).toBeDefined();
    expect(picoagents.InMemoryCheckpointStore).toBeDefined();
  });

  it("should export workflow steps", () => {
    expect(picoagents.BaseStep).toBeDefined();
    expect(picoagents.EchoStep).toBeDefined();
    expect(picoagents.FunctionStep).toBeDefined();
    expect(picoagents.HttpStep).toBeDefined();
    expect(picoagents.TransformStep).toBeDefined();
    expect(picoagents.PicoAgentStep).toBeDefined();
  });

  it("should export workflow defaults", () => {
    expect(picoagents.createEchoChainWorkflow).toBeDefined();
    expect(picoagents.getDefaultSteps).toBeDefined();
  });

  it("should export createEvent", () => {
    expect(picoagents.createEvent).toBeDefined();
  });
});
