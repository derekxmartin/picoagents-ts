import { describe, it, expect, vi } from "vitest";
import { AgentContext } from "../context.js";
import {
  MiddlewareChain,
  LoggingMiddleware,
  RateLimitMiddleware,
  PIIRedactionMiddleware,
  GuardrailMiddleware,
  MetricsMiddleware,
  type MiddlewareContext,
  BaseMiddleware,
} from "../middleware.js";
import type { AgentEvent } from "../types.js";

function makeCtx(
  operation = "model_call",
  data: unknown = []
): MiddlewareContext {
  return {
    operation,
    agentName: "test-agent",
    agentContext: new AgentContext("session-1"),
    data,
    metadata: {},
  };
}

// Helper to collect all items from async generator
async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of gen) items.push(item);
  return items;
}

describe("MiddlewareChain", () => {
  it("should execute function and return result when no middleware", async () => {
    const chain = new MiddlewareChain();
    const func = async (data: unknown) => "result";

    const items = await collect(
      chain.executeStream(
        "model_call",
        "agent",
        new AgentContext("s1"),
        [],
        func
      )
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toBe("result");
  });

  it("should pass through middleware chain", async () => {
    const log = vi.fn();
    const chain = new MiddlewareChain([new LoggingMiddleware(log)]);

    const items = await collect(
      chain.executeStream(
        "model_call",
        "agent",
        new AgentContext("s1"),
        [],
        async () => "done"
      )
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toBe("done");
    expect(log).toHaveBeenCalledTimes(2); // start + complete
  });

  it("should support add and remove middleware", () => {
    const chain = new MiddlewareChain();
    const mw = new LoggingMiddleware();
    chain.add(mw);
    expect(chain.middlewares).toHaveLength(1);
    chain.remove(mw);
    expect(chain.middlewares).toHaveLength(0);
  });
});

describe("LoggingMiddleware", () => {
  it("should log start and completion", async () => {
    const log = vi.fn();
    const mw = new LoggingMiddleware(log);

    const ctx = makeCtx();
    const reqItems = await collect(mw.processRequest(ctx));
    expect(reqItems).toHaveLength(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("Starting model_call")
    );

    const resItems = await collect(mw.processResponse(ctx, "result"));
    expect(resItems).toHaveLength(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("Completed model_call")
    );
  });

  it("should re-throw errors", async () => {
    const mw = new LoggingMiddleware();
    const ctx = makeCtx();

    await expect(async () => {
      await collect(mw.processError(ctx, new Error("boom")));
    }).rejects.toThrow("boom");
  });
});

describe("PIIRedactionMiddleware", () => {
  it("should redact SSN", () => {
    const mw = new PIIRedactionMiddleware();
    expect(mw.redactText("My SSN is 123-45-6789")).toBe(
      "My SSN is [SSN-REDACTED]"
    );
  });

  it("should redact email", () => {
    const mw = new PIIRedactionMiddleware();
    expect(mw.redactText("Email: test@example.com")).toBe(
      "Email: [EMAIL-REDACTED]"
    );
  });

  it("should redact phone", () => {
    const mw = new PIIRedactionMiddleware();
    expect(mw.redactText("Call 555-123-4567")).toBe(
      "Call [PHONE-REDACTED]"
    );
  });

  it("should redact credit card", () => {
    const mw = new PIIRedactionMiddleware();
    expect(mw.redactText("Card: 4111 1111 1111 1111")).toBe(
      "Card: [CC-REDACTED]"
    );
  });

  it("should redact PII in model_call messages", async () => {
    const mw = new PIIRedactionMiddleware();
    const ctx = makeCtx("model_call", [
      { content: "My email is foo@bar.com", role: "user" },
    ]);

    const items = await collect(mw.processRequest(ctx));
    expect(items).toHaveLength(1);
    const data = (items[0] as MiddlewareContext).data as Array<{
      content: string;
    }>;
    expect(data[0].content).toBe("My email is [EMAIL-REDACTED]");
  });
});

describe("GuardrailMiddleware", () => {
  it("should block tools by name", async () => {
    const mw = new GuardrailMiddleware(["dangerous_tool"]);
    const ctx = makeCtx("tool_call", {
      toolName: "dangerous_tool",
      parameters: {},
    });

    await expect(async () => {
      await collect(mw.processRequest(ctx));
    }).rejects.toThrow("blocked by guardrails");
  });

  it("should block patterns in tool parameters", async () => {
    const mw = new GuardrailMiddleware([], ["rm\\s+-rf"]);
    const ctx = makeCtx("tool_call", {
      toolName: "shell",
      parameters: { command: "rm -rf /" },
    });

    await expect(async () => {
      await collect(mw.processRequest(ctx));
    }).rejects.toThrow("blocked pattern");
  });

  it("should allow safe operations", async () => {
    const mw = new GuardrailMiddleware(["dangerous"]);
    const ctx = makeCtx("tool_call", {
      toolName: "safe_tool",
      parameters: { x: 1 },
    });

    const items = await collect(mw.processRequest(ctx));
    expect(items).toHaveLength(1);
  });
});

describe("MetricsMiddleware", () => {
  it("should track operation counts", async () => {
    const mw = new MetricsMiddleware();
    const ctx = makeCtx("model_call");

    await collect(mw.processRequest(ctx));
    await collect(mw.processResponse(ctx, "result"));

    const metrics = mw.getMetrics();
    expect(metrics.totalOperations).toBe(1);
    expect(
      (metrics.operationsByType as Record<string, number>).model_call
    ).toBe(1);
  });

  it("should track errors", async () => {
    const mw = new MetricsMiddleware();
    const ctx = makeCtx();

    try {
      await collect(mw.processError(ctx, new TypeError("oops")));
    } catch {
      // expected
    }

    const metrics = mw.getMetrics();
    expect(
      (metrics.errorsByType as Record<string, number>).TypeError
    ).toBe(1);
  });

  it("should compute average duration", async () => {
    const mw = new MetricsMiddleware();
    const ctx1 = makeCtx();

    await collect(mw.processRequest(ctx1));
    // Simulate some time passing
    ctx1.metadata.metricsStartTime =
      (ctx1.metadata.metricsStartTime as number) - 100;
    await collect(mw.processResponse(ctx1, "result"));

    const metrics = mw.getMetrics();
    expect((metrics.averageDuration as number)).toBeGreaterThanOrEqual(0);
  });
});

describe("RateLimitMiddleware", () => {
  it("should allow calls within limit", async () => {
    const mw = new RateLimitMiddleware(100);
    const ctx = makeCtx();

    const items = await collect(mw.processRequest(ctx));
    expect(items).toHaveLength(1);
  });
});
