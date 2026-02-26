/**
 * Base agent abstract class defining the core agent interface.
 *
 * All agents in the picoagents framework must inherit from this base class
 * and implement its abstract methods.
 */

import { ComponentBase } from "../component-config.js";
import { AgentContext } from "../context.js";
import type { CancellationToken } from "../cancellation-token.js";
import type { BaseChatCompletionClient } from "../llm/base.js";
import type { BaseMemory } from "../memory/base.js";
import type { BaseTool } from "../tools/base.js";
import type { BaseMiddleware } from "../middleware.js";
import { MiddlewareChain } from "../middleware.js";
import type { CompactionStrategy } from "../compaction.js";
import type { BaseStartHook, BaseEndHook } from "../hooks.js";
import type {
  Message,
  UserMessage,
  AssistantMessage,
  ToolMessage,
  SystemMessage,
} from "../messages.js";
import type {
  AgentResponse,
  AgentEvent,
  ChatCompletionChunk,
  Usage,
} from "../types.js";
import { AgentConfigurationError, AgentExecutionError } from "./errors.js";

// ---------------------------------------------------------------------------
// BaseAgent
// ---------------------------------------------------------------------------

export abstract class BaseAgent extends ComponentBase {
  static override componentType = "agent" as const;

  name: string;
  description: string;
  instructions: string;
  modelClient: BaseChatCompletionClient;
  tools: BaseTool[];
  memory?: BaseMemory;
  context: AgentContext;
  middlewareChain: MiddlewareChain;
  maxIterations: number;
  outputSchema?: Record<string, unknown>;
  summarizeToolResult: boolean;
  requiredTools: string[];
  exampleTasks: string[];
  compaction?: CompactionStrategy;
  startHooks: BaseStartHook[];
  endHooks: BaseEndHook[];

  constructor(options: {
    name: string;
    description: string;
    instructions: string;
    modelClient: BaseChatCompletionClient;
    tools?: BaseTool[];
    memory?: BaseMemory;
    context?: AgentContext;
    middlewares?: BaseMiddleware[];
    maxIterations?: number;
    outputSchema?: Record<string, unknown>;
    summarizeToolResult?: boolean;
    requiredTools?: string[];
    exampleTasks?: string[];
    compaction?: CompactionStrategy;
    startHooks?: BaseStartHook[];
    endHooks?: BaseEndHook[];
  }) {
    super();
    this.name = options.name;
    this.description = options.description;
    this.instructions = options.instructions;
    this.modelClient = options.modelClient;
    this.tools = options.tools ?? [];
    this.memory = options.memory;
    this.context = options.context ?? new AgentContext();
    this.middlewareChain = new MiddlewareChain(options.middlewares);
    this.maxIterations = options.maxIterations ?? 10;
    this.outputSchema = options.outputSchema;
    this.summarizeToolResult = options.summarizeToolResult ?? true;
    this.requiredTools = options.requiredTools ?? [];
    this.exampleTasks = options.exampleTasks ?? [];
    this.compaction = options.compaction;
    this.startHooks = options.startHooks ?? [];
    this.endHooks = options.endHooks ?? [];

    this.validateConfiguration();
  }

  private validateConfiguration(): void {
    if (!this.name || typeof this.name !== "string") {
      throw new AgentConfigurationError(
        "Agent name must be a non-empty string"
      );
    }
    if (!this.description) {
      throw new AgentConfigurationError(
        "Agent description cannot be empty"
      );
    }
    if (!this.instructions) {
      throw new AgentConfigurationError(
        "Agent instructions cannot be empty"
      );
    }
    if (!this.modelClient) {
      throw new AgentConfigurationError("Model client is required");
    }
  }

  // -------------------------------------------------------------------------
  // Tool helpers
  // -------------------------------------------------------------------------

  findTool(name: string): BaseTool | undefined {
    return this.tools.find((t) => t.name === name);
  }

  getToolsForLlm(): Record<string, unknown>[] {
    return this.tools.map((t) => t.toLlmFormat());
  }

  // -------------------------------------------------------------------------
  // Abstract methods
  // -------------------------------------------------------------------------

  abstract run(
    task?: string | UserMessage | Message[],
    context?: AgentContext,
    cancellationToken?: CancellationToken
  ): Promise<AgentResponse>;

  abstract runStream(
    task?: string | UserMessage | Message[],
    context?: AgentContext,
    cancellationToken?: CancellationToken,
    verbose?: boolean,
    streamTokens?: boolean
  ): AsyncGenerator<
    Message | AgentEvent | AgentResponse | ChatCompletionChunk,
    void,
    undefined
  >;

  // -------------------------------------------------------------------------
  // Message preparation
  // -------------------------------------------------------------------------

  convertTaskToMessages(
    task: string | UserMessage | Message[]
  ): Message[] {
    if (typeof task === "string") {
      return [
        {
          role: "user",
          content: task,
          source: "user",
          timestamp: new Date(),
        } as UserMessage,
      ];
    }
    if (Array.isArray(task)) return task;
    // UserMessage
    return [task];
  }

  async prepareLlmMessages(
    taskMessages: Message[]
  ): Promise<Message[]> {
    const messages: Message[] = [];

    // System message with instructions
    let systemContent = this.instructions;

    // Add forced tool use instruction
    if (this.requiredTools.length > 0) {
      const toolList = this.requiredTools.join(", ");
      systemContent += `\n\nIMPORTANT: You MUST use these tools in your response: ${toolList}. Do not respond without calling these tools.`;
    }

    // Add memory context if available
    if (this.memory) {
      try {
        const memoryResult = await this.memory.getContext(5);
        if (memoryResult.results.length > 0) {
          const contextItems = memoryResult.results.map((mc) =>
            typeof mc.content === "string"
              ? mc.content
              : JSON.stringify(mc.content)
          );
          systemContent +=
            "\n\nRelevant context from memory:\n" +
            contextItems.join("\n");
        }
      } catch {
        // Don't fail if memory access fails
      }
    }

    messages.push({
      role: "system",
      content: systemContent,
      source: "system",
      timestamp: new Date(),
    } as SystemMessage);

    // Add message history from context
    messages.push(...this.context.messages);

    // Add current task messages
    messages.push(...taskMessages);

    return messages;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async reset(): Promise<void> {
    this.context.reset();
  }

  getInfo(): Record<string, unknown> {
    return {
      name: this.name,
      description: this.description,
      type: this.constructor.name,
      model: this.modelClient.model,
      toolsCount: this.tools.length,
      hasMemory: this.memory !== undefined,
      hasMiddlewares: this.middlewareChain.middlewares.length > 0,
      messageHistoryLength: this.context.messageCount,
    };
  }

  asTool(
    taskParameterName = "task",
    resultStrategy: string | ((msgs: Message[]) => string) = "last"
  ): import("./agent-as-tool.js").AgentAsTool {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AgentAsTool } = require("./agent-as-tool.js");
    return new AgentAsTool(this, taskParameterName, resultStrategy);
  }

  toConfig(): Record<string, unknown> {
    return {
      name: this.name,
      description: this.description,
      instructions: this.instructions,
      maxIterations: this.maxIterations,
      summarizeToolResult: this.summarizeToolResult,
    };
  }
}
