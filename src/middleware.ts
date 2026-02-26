/**
 * Middleware system for picoagents.
 *
 * Provides middleware infrastructure for intercepting and processing
 * agent operations like model calls, tool calls, and memory access.
 *
 * Middleware uses async generators to support:
 * - Event emission (for observability)
 * - Approval requests (pausing execution)
 * - Streaming transformations
 * - Error recovery
 */

import type { AgentContext } from "./context.js";
import type { AgentEvent } from "./types.js";

// ---------------------------------------------------------------------------
// MiddlewareContext
// ---------------------------------------------------------------------------

export interface MiddlewareContext {
  /** Operation type: "model_call", "tool_call", "memory_access" */
  operation: string;
  /** Name of the agent executing the operation */
  agentName: string;
  /** The agent's context */
  agentContext: AgentContext;
  /** Operation-specific data (messages, tool request, etc.) */
  data: unknown;
  /** Additional metadata for middleware use */
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// BaseMiddleware
// ---------------------------------------------------------------------------

/**
 * Abstract base class for middleware components.
 *
 * Middleware intercepts agent operations and can:
 * - Emit events for observability (logs, metrics, approval requests)
 * - Transform requests/responses
 * - Pause execution (e.g., for approval)
 * - Handle errors with recovery
 */
export abstract class BaseMiddleware {
  /**
   * Process before the operation executes.
   * Must yield events and/or the final MiddlewareContext.
   */
  abstract processRequest(
    context: MiddlewareContext
  ): AsyncGenerator<MiddlewareContext | AgentEvent, void, undefined>;

  /**
   * Process after the operation completes successfully.
   * Must yield events and/or the final result.
   */
  abstract processResponse(
    context: MiddlewareContext,
    result: unknown
  ): AsyncGenerator<unknown | AgentEvent, void, undefined>;

  /**
   * Handle errors from the operation.
   * Yield a value to recover, or re-throw to propagate.
   */
  abstract processError(
    context: MiddlewareContext,
    error: Error
  ): AsyncGenerator<unknown | AgentEvent, void, undefined>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isMiddlewareContext(item: unknown): item is MiddlewareContext {
  return (
    typeof item === "object" &&
    item !== null &&
    "operation" in item &&
    "agentName" in item &&
    "agentContext" in item &&
    "data" in item
  );
}

function isAgentEvent(item: unknown): item is AgentEvent {
  return (
    typeof item === "object" &&
    item !== null &&
    "eventType" in item &&
    "source" in item
  );
}

// ---------------------------------------------------------------------------
// MiddlewareChain
// ---------------------------------------------------------------------------

/**
 * Executes a chain of middleware as async generator pipeline.
 */
export class MiddlewareChain {
  middlewares: BaseMiddleware[];

  constructor(middlewares?: BaseMiddleware[]) {
    this.middlewares = middlewares ?? [];
  }

  add(middleware: BaseMiddleware): void {
    this.middlewares.push(middleware);
  }

  remove(middleware: BaseMiddleware): void {
    const idx = this.middlewares.indexOf(middleware);
    if (idx >= 0) this.middlewares.splice(idx, 1);
  }

  /**
   * Execute the middleware chain with streaming support.
   *
   * 3-phase pipeline:
   *  1. Pre-process through middleware (forward order) — yields events
   *  2. Execute the operation
   *  3. Post-process through middleware (reverse order) — yields events + final result
   */
  async *executeStream(
    operation: string,
    agentName: string,
    agentContext: AgentContext,
    data: unknown,
    func: (data: unknown) => Promise<unknown>,
    metadata?: Record<string, unknown>
  ): AsyncGenerator<unknown | AgentEvent, void, undefined> {
    let ctx: MiddlewareContext = {
      operation,
      agentName,
      agentContext,
      data,
      metadata: metadata ?? {},
    };

    // PHASE 1: Pre-process (forward order)
    for (const middleware of this.middlewares) {
      try {
        let finalCtx: MiddlewareContext | null = null;

        for await (const item of middleware.processRequest(ctx)) {
          if (isMiddlewareContext(item)) {
            finalCtx = item;
          } else if (isAgentEvent(item)) {
            yield item;

            // Check if middleware requested approval (pause)
            if (
              (item as AgentEvent).eventType === "tool_approval"
            ) {
              return; // STOP — wait for approval
            }
          }
        }

        if (finalCtx === null) {
          return; // Middleware didn't yield context — paused
        }
        ctx = finalCtx;
      } catch (e) {
        // Try error handlers (reverse order)
        let recovered = false;
        for (const errorMw of [...this.middlewares].reverse()) {
          try {
            for await (const item of errorMw.processError(
              ctx,
              e as Error
            )) {
              if (isAgentEvent(item)) {
                yield item;
              } else {
                yield item; // Recovery value
                recovered = true;
                return;
              }
            }
          } catch {
            continue;
          }
        }
        if (!recovered) throw e;
      }
    }

    // PHASE 2: Execute actual operation
    let result: unknown;
    try {
      result = await func(ctx.data);
    } catch (e) {
      let recovered = false;
      for (const middleware of [...this.middlewares].reverse()) {
        try {
          for await (const item of middleware.processError(
            ctx,
            e as Error
          )) {
            if (isAgentEvent(item)) {
              yield item;
            } else {
              yield item;
              recovered = true;
              return;
            }
          }
        } catch {
          continue;
        }
      }
      if (!recovered) throw e;
      throw new Error("Middleware recovery logic error");
    }

    // PHASE 3: Post-process (reverse order)
    for (const middleware of [...this.middlewares].reverse()) {
      try {
        let finalResult: unknown = undefined;
        for await (const item of middleware.processResponse(ctx, result)) {
          if (isAgentEvent(item)) {
            yield item;
          } else {
            finalResult = item;
          }
        }
        if (finalResult !== undefined) {
          result = finalResult;
        }
      } catch (e) {
        for (const errorMw of [...this.middlewares].reverse()) {
          try {
            for await (const item of errorMw.processError(
              ctx,
              e as Error
            )) {
              if (isAgentEvent(item)) {
                yield item;
              } else {
                yield item;
                return;
              }
            }
          } catch {
            continue;
          }
        }
        throw e;
      }
    }

    // Yield final result
    yield result;
  }
}

// ==========================================================================
// Concrete Middleware Implementations
// ==========================================================================

/**
 * Logs all agent operations.
 */
export class LoggingMiddleware extends BaseMiddleware {
  private log: (msg: string) => void;

  constructor(log?: (msg: string) => void) {
    super();
    this.log = log ?? console.log;
  }

  async *processRequest(
    context: MiddlewareContext
  ): AsyncGenerator<MiddlewareContext | AgentEvent, void, undefined> {
    this.log(
      `[${context.agentName}] Starting ${context.operation}`
    );
    context.metadata.startTime = Date.now();
    yield context;
  }

  async *processResponse(
    context: MiddlewareContext,
    result: unknown
  ): AsyncGenerator<unknown | AgentEvent, void, undefined> {
    const duration =
      Date.now() - ((context.metadata.startTime as number) ?? 0);
    this.log(
      `[${context.agentName}] Completed ${context.operation} in ${duration}ms`
    );
    yield result;
  }

  async *processError(
    _context: MiddlewareContext,
    error: Error
  ): AsyncGenerator<unknown | AgentEvent, void, undefined> {
    // Intentionally empty — just re-throw
    throw error;
    // TypeScript requires a yield for the generator type
    yield undefined as never;
  }
}

/**
 * Rate limits operations per agent.
 */
export class RateLimitMiddleware extends BaseMiddleware {
  private maxCalls: number;
  private callTimes: number[] = [];

  constructor(maxCallsPerMinute = 60) {
    super();
    this.maxCalls = maxCallsPerMinute;
  }

  async *processRequest(
    context: MiddlewareContext
  ): AsyncGenerator<MiddlewareContext | AgentEvent, void, undefined> {
    let now = Date.now();

    // Remove calls outside 60-second window
    this.callTimes = this.callTimes.filter((t) => now - t < 60_000);

    if (this.callTimes.length >= this.maxCalls) {
      const oldest = this.callTimes[0];
      const waitTime = 60_000 - (now - oldest);
      if (waitTime > 0) {
        await new Promise((r) => setTimeout(r, waitTime));
        now = Date.now();
      }
    }

    this.callTimes.push(now);
    yield context;
  }

  async *processResponse(
    _context: MiddlewareContext,
    result: unknown
  ): AsyncGenerator<unknown | AgentEvent, void, undefined> {
    yield result;
  }

  async *processError(
    _context: MiddlewareContext,
    error: Error
  ): AsyncGenerator<unknown | AgentEvent, void, undefined> {
    throw error;
    yield undefined as never;
  }
}

/**
 * Redacts personally identifiable information from inputs and outputs.
 */
export class PIIRedactionMiddleware extends BaseMiddleware {
  private patterns: Array<[RegExp, string]>;

  constructor(patterns?: Record<string, string>) {
    super();
    const raw = patterns ?? {
      "\\b\\d{3}-\\d{2}-\\d{4}\\b": "[SSN-REDACTED]",
      "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}\\b":
        "[EMAIL-REDACTED]",
      "\\b\\d{3}[-.]?\\d{3}[-.]?\\d{4}\\b": "[PHONE-REDACTED]",
      "\\b\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}\\b":
        "[CC-REDACTED]",
    };
    this.patterns = Object.entries(raw).map(([p, r]) => [
      new RegExp(p, "g"),
      r,
    ]);
  }

  redactText(text: string): string {
    let result = text;
    for (const [pattern, replacement] of this.patterns) {
      // Reset lastIndex for global regex
      pattern.lastIndex = 0;
      result = result.replace(pattern, replacement);
    }
    return result;
  }

  async *processRequest(
    context: MiddlewareContext
  ): AsyncGenerator<MiddlewareContext | AgentEvent, void, undefined> {
    if (context.operation === "model_call" && Array.isArray(context.data)) {
      context.data = (context.data as Array<{ content?: string }>).map(
        (msg) => {
          if (msg.content) {
            const redacted = this.redactText(msg.content);
            if (redacted !== msg.content) {
              return { ...msg, content: redacted };
            }
          }
          return msg;
        }
      );
    }
    yield context;
  }

  async *processResponse(
    context: MiddlewareContext,
    result: unknown
  ): AsyncGenerator<unknown | AgentEvent, void, undefined> {
    if (context.operation === "model_call") {
      const r = result as { message?: { content?: string } };
      if (r?.message?.content) {
        const redacted = this.redactText(r.message.content);
        if (redacted !== r.message.content) {
          yield {
            ...r,
            message: { ...r.message, content: redacted },
          };
          return;
        }
      }
    }
    yield result;
  }

  async *processError(
    _context: MiddlewareContext,
    error: Error
  ): AsyncGenerator<unknown | AgentEvent, void, undefined> {
    throw error;
    yield undefined as never;
  }
}

/**
 * Enforces safety guardrails on operations.
 */
export class GuardrailMiddleware extends BaseMiddleware {
  private blockedTools: string[];
  private blockedPatterns: RegExp[];

  constructor(
    blockedTools?: string[],
    blockedPatterns?: string[]
  ) {
    super();
    this.blockedTools = blockedTools ?? [];
    this.blockedPatterns = (blockedPatterns ?? []).map(
      (p) => new RegExp(p)
    );
  }

  async *processRequest(
    context: MiddlewareContext
  ): AsyncGenerator<MiddlewareContext | AgentEvent, void, undefined> {
    if (context.operation === "tool_call") {
      const data = context.data as {
        toolName?: string;
        parameters?: Record<string, unknown>;
      };
      if (data.toolName && this.blockedTools.includes(data.toolName)) {
        throw new Error(
          `Tool '${data.toolName}' is blocked by guardrails`
        );
      }

      const paramsStr = JSON.stringify(data.parameters ?? {});
      for (const pattern of this.blockedPatterns) {
        if (pattern.test(paramsStr)) {
          throw new Error(
            `Tool parameters match blocked pattern: ${pattern.source}`
          );
        }
      }
    } else if (
      context.operation === "model_call" &&
      Array.isArray(context.data)
    ) {
      for (const msg of context.data) {
        const content = (msg as { content?: string }).content;
        if (content) {
          for (const pattern of this.blockedPatterns) {
            if (pattern.test(content)) {
              throw new Error(
                `Message contains blocked pattern: ${pattern.source}`
              );
            }
          }
        }
      }
    }
    yield context;
  }

  async *processResponse(
    _context: MiddlewareContext,
    result: unknown
  ): AsyncGenerator<unknown | AgentEvent, void, undefined> {
    yield result;
  }

  async *processError(
    _context: MiddlewareContext,
    error: Error
  ): AsyncGenerator<unknown | AgentEvent, void, undefined> {
    throw error;
    yield undefined as never;
  }
}

/**
 * Collects metrics about agent operations.
 */
export class MetricsMiddleware extends BaseMiddleware {
  metrics = {
    totalOperations: 0,
    operationsByType: {} as Record<string, number>,
    errorsByType: {} as Record<string, number>,
    totalDuration: 0,
    operationDurations: [] as Array<[string, number]>,
  };

  async *processRequest(
    context: MiddlewareContext
  ): AsyncGenerator<MiddlewareContext | AgentEvent, void, undefined> {
    this.metrics.totalOperations += 1;
    this.metrics.operationsByType[context.operation] =
      (this.metrics.operationsByType[context.operation] ?? 0) + 1;
    context.metadata.metricsStartTime = Date.now();
    yield context;
  }

  async *processResponse(
    context: MiddlewareContext,
    result: unknown
  ): AsyncGenerator<unknown | AgentEvent, void, undefined> {
    const duration =
      Date.now() -
      ((context.metadata.metricsStartTime as number) ?? 0);
    this.metrics.totalDuration += duration;
    this.metrics.operationDurations.push([context.operation, duration]);

    // Keep only last 100
    if (this.metrics.operationDurations.length > 100) {
      this.metrics.operationDurations =
        this.metrics.operationDurations.slice(-100);
    }
    yield result;
  }

  async *processError(
    _context: MiddlewareContext,
    error: Error
  ): AsyncGenerator<unknown | AgentEvent, void, undefined> {
    const errorType = error.constructor.name;
    this.metrics.errorsByType[errorType] =
      (this.metrics.errorsByType[errorType] ?? 0) + 1;
    throw error;
    yield undefined as never;
  }

  getMetrics(): Record<string, unknown> {
    const avgDuration =
      this.metrics.totalOperations > 0
        ? this.metrics.totalDuration / this.metrics.totalOperations
        : 0;
    return {
      ...this.metrics,
      averageDuration: avgDuration,
    };
  }
}
