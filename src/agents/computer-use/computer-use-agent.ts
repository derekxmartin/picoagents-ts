/**
 * ComputerUseAgent — extends Agent with browser automation capabilities.
 *
 * Integrates with a BaseInterfaceClient to capture screenshots
 * and inject them as multi-modal messages into the conversation.
 */

import { Agent } from "../agent.js";
import { AgentContext } from "../../context.js";
import type { CancellationToken } from "../../cancellation-token.js";
import type {
  Message,
  UserMessage,
  MultiModalMessage,
} from "../../messages.js";
import type {
  AgentResponse,
  AgentEvent,
  ChatCompletionChunk,
} from "../../types.js";
import type { BaseChatCompletionClient } from "../../llm/base.js";
import type { BaseTool } from "../../tools/base.js";
import type { BaseInterfaceClient } from "./interface-clients.js";
import { createPlaywrightTools } from "./playwright-tools.js";

// ---------------------------------------------------------------------------
// ComputerUseAgent
// ---------------------------------------------------------------------------

export class ComputerUseAgent extends Agent {
  interfaceClient: BaseInterfaceClient;
  useScreenshots: boolean;
  maxActions: number;
  private isInitialized = false;

  constructor(options: {
    interfaceClient: BaseInterfaceClient;
    modelClient: BaseChatCompletionClient;
    name?: string;
    description?: string;
    instructions?: string;
    useScreenshots?: boolean;
    maxActions?: number;
    tools?: BaseTool[];
    maxIterations?: number;
  }) {
    const interfaceTools =
      options.tools ?? createPlaywrightTools(options.interfaceClient);

    const instructions =
      options.instructions ?? defaultInstructions(interfaceTools);

    super({
      name: options.name ?? "computer-use-agent",
      description:
        options.description ??
        "An agent that can interact with web pages using browser automation",
      instructions,
      modelClient: options.modelClient,
      tools: interfaceTools,
      maxIterations: options.maxIterations ?? 20,
    });

    this.interfaceClient = options.interfaceClient;
    this.useScreenshots = options.useScreenshots ?? true;
    this.maxActions = options.maxActions ?? 50;
  }

  async *runStream(
    task?: string | UserMessage | Message[],
    context?: AgentContext,
    cancellationToken?: CancellationToken,
    verbose = false,
    streamTokens = false
  ): AsyncGenerator<
    Message | AgentEvent | AgentResponse | ChatCompletionChunk,
    void,
    undefined
  > {
    // Initialize interface if needed
    if (!this.isInitialized) {
      await this.interfaceClient.initialize();
      this.isInitialized = true;
    }

    // Capture initial screenshot if screenshots are enabled
    if (this.useScreenshots) {
      try {
        const screenshot = await this.interfaceClient.getScreenshot();
        const state = await this.interfaceClient.getState("text");

        // Yield initial state as a user message
        const stateMsg: UserMessage = {
          role: "user",
          content: `Current page: ${state.url}\nTitle: ${state.title}\n\nPage content:\n${state.content.slice(0, 2000)}`,
          source: "interface",
          timestamp: new Date(),
        };
        yield stateMsg;
      } catch {
        // Ignore screenshot errors
      }
    }

    // Delegate to parent's runStream
    yield* super.runStream(task, context, cancellationToken, verbose, streamTokens);
  }

  async reset(): Promise<void> {
    await super.reset();
    if (this.isInitialized) {
      await this.interfaceClient.close();
      this.isInitialized = false;
    }
  }

  async close(): Promise<void> {
    if (this.isInitialized) {
      await this.interfaceClient.close();
      this.isInitialized = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Default instructions
// ---------------------------------------------------------------------------

function defaultInstructions(tools: BaseTool[]): string {
  const toolNames = tools.map((t) => t.name).join(", ");
  return `You are a computer use agent that interacts with web pages to complete tasks.

Available tools: ${toolNames}

Guidelines:
1. Use observe_page first to understand the current page state
2. Plan your actions carefully before executing them
3. Use CSS selectors when possible, fall back to text content for clicking
4. After each action, observe the page to verify the result
5. If an action fails, try alternative approaches
6. Focus on completing the task efficiently
7. Report when the task is complete or if you cannot complete it

Always explain your reasoning before taking actions.`;
}
