import { describe, it, expect } from "vitest";
import { EchoStep } from "../steps/echo-step.js";
import { FunctionStep } from "../steps/function-step.js";
import { TransformStep } from "../steps/transform-step.js";
import { createStepMetadata, WorkflowContext, StepStatus } from "../core/models.js";

describe("EchoStep", () => {
  it("should echo message with prefix", async () => {
    const step = new EchoStep("echo-1", createStepMetadata("Echo"), {
      prefix: "Hello: ",
    });
    const ctx = new WorkflowContext();
    const result = await step.execute({ message: "world" }, ctx);
    expect(result.message).toBe("Hello: world");
  });

  it("should use suffix", async () => {
    const step = new EchoStep("echo-2", createStepMetadata("Echo"), {
      prefix: "",
      suffix: "!",
    });
    const ctx = new WorkflowContext();
    const result = await step.execute({ text: "hello" }, ctx);
    expect(result.message).toBe("hello!");
  });

  it("should store echo info in context", async () => {
    const step = new EchoStep("echo-3", createStepMetadata("Echo"));
    const ctx = new WorkflowContext();
    await step.execute({ message: "test" }, ctx);
    const info = ctx.get("echo-3_echo_info") as Record<string, unknown>;
    expect(info.original).toBe("test");
  });

  it("should handle delay", async () => {
    const step = new EchoStep("echo-4", createStepMetadata("Echo"), {
      delaySeconds: 0.01,
    });
    const ctx = new WorkflowContext();
    const start = Date.now();
    await step.execute({ message: "delayed" }, ctx);
    expect(Date.now() - start).toBeGreaterThanOrEqual(5);
  });

  it("run() wraps execute with status tracking", async () => {
    const step = new EchoStep("echo-5", createStepMetadata("Echo"));
    const result = await step.run({ message: "test" }, { workflow_state: {} });
    expect(result.message).toBe("Echo: test");
    expect(step.status).toBe(StepStatus.COMPLETED);
    expect(step.duration).toBeGreaterThanOrEqual(0);
  });
});

describe("FunctionStep", () => {
  it("should execute sync function", async () => {
    const step = new FunctionStep(
      "fn-1",
      createStepMetadata("Func"),
      (input: Record<string, unknown>) => ({
        result: `processed: ${input.value}`,
      })
    );
    const ctx = new WorkflowContext();
    const result = await step.execute({ value: "hello" }, ctx);
    expect(result.result).toBe("processed: hello");
  });

  it("should execute async function", async () => {
    const step = new FunctionStep(
      "fn-2",
      createStepMetadata("AsyncFunc"),
      async (input: Record<string, unknown>) => {
        await new Promise((r) => setTimeout(r, 10));
        return { result: `async: ${input.value}` };
      }
    );
    const ctx = new WorkflowContext();
    const result = await step.execute({ value: "test" }, ctx);
    expect(result.result).toBe("async: test");
  });
});

describe("TransformStep", () => {
  it("should map fields", async () => {
    const step = new TransformStep(
      "transform-1",
      createStepMetadata("Transform"),
      { output_field: "input_field" }
    );
    const ctx = new WorkflowContext();
    const result = await step.execute(
      { input_field: "hello" },
      ctx
    );
    expect(result.output_field).toBe("hello");
  });

  it("should handle static values", async () => {
    const step = new TransformStep(
      "transform-2",
      createStepMetadata("Transform"),
      { greeting: "static:Hello World" }
    );
    const ctx = new WorkflowContext();
    const result = await step.execute({}, ctx);
    expect(result.greeting).toBe("Hello World");
  });

  it("should handle dict mappings", async () => {
    const step = new TransformStep(
      "transform-3",
      createStepMetadata("Transform"),
      {
        combined: {
          name: "name",
          greeting: "static:Hello",
        },
      }
    );
    const ctx = new WorkflowContext();
    const result = await step.execute({ name: "Alice" }, ctx);
    const combined = result.combined as Record<string, unknown>;
    expect(combined.name).toBe("Alice");
    expect(combined.greeting).toBe("Hello");
  });
});
