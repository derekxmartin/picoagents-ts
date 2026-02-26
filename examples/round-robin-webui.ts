/**
 * Round-Robin Orchestrator with WebUI
 *
 * Three agents take turns collaborating on tasks:
 *   - Researcher: gathers information and facts
 *   - Analyst: evaluates and synthesizes findings
 *   - Writer: drafts polished responses
 *
 * Uses a mock LLM so you can run this without API keys.
 * Launch it and open http://localhost:8080 in your browser.
 *
 * Usage:
 *   npx tsx examples/round-robin-webui.ts
 */

import {
  Agent,
  AgentContext,
  MaxMessageTermination,
  RoundRobinOrchestrator,
  type BaseChatCompletionClient,
  type Message,
  type ChatCompletionResult,
  type ChatCompletionChunk,
  type Usage,
} from "../src/index.js";
import { serve as serveWebUI } from "../src/webui/index.js";

// ---------------------------------------------------------------------------
// Mock LLM that generates contextual responses per agent role
// ---------------------------------------------------------------------------

function createMockUsage(): Usage {
  return {
    durationMs: 50 + Math.floor(Math.random() * 100),
    llmCalls: 1,
    tokensInput: 20 + Math.floor(Math.random() * 30),
    tokensOutput: 40 + Math.floor(Math.random() * 60),
    toolCalls: 0,
    memoryOperations: 0,
  };
}

const { BaseChatCompletionClient: BaseLLM } = await import("../src/llm/base.js");

class MockLLM extends BaseLLM {
  private responseMap: Record<string, string[]>;
  private callCounts = new Map<string, number>();

  constructor(role: string) {
    super("mock-llm-" + role);

    // Each role has a set of canned responses it cycles through
    this.responseMap = {
      researcher: [
        "Based on my research, here are the key findings:\n\n1. The topic has significant historical context dating back several decades.\n2. Current trends show a shift toward more collaborative approaches.\n3. Industry experts suggest that innovation in this area is accelerating.\n4. There are three main schools of thought on this subject.\n\nI recommend the team consider these findings as we formulate our response.",

        "After further investigation, I found additional relevant data:\n\n- Recent studies confirm the earlier hypothesis with 87% confidence.\n- Comparable projects in related fields have achieved notable success.\n- The main challenges identified are scalability and adoption.\n- Several case studies provide useful precedents.\n\nThis should give us a solid foundation to work with.",

        "My research into the latest developments reveals:\n\n1. A breakthrough approach was published last quarter.\n2. Community feedback has been overwhelmingly positive.\n3. Implementation costs are lower than initially estimated.\n4. Cross-disciplinary applications are emerging rapidly.\n\nThese findings strengthen our overall analysis.",
      ],
      analyst: [
        "Analyzing the researcher's findings, I see several important patterns:\n\n**Strengths:**\n- The evidence base is comprehensive and well-sourced.\n- Multiple data points converge on the same conclusion.\n\n**Considerations:**\n- We should account for potential biases in the source data.\n- The timeline for implementation needs careful planning.\n\n**Recommendation:** Proceed with a phased approach that validates assumptions at each stage.",

        "Building on the analysis so far, here's my synthesis:\n\n**Key Insight:** The data suggests a clear path forward with manageable risks.\n\n**Risk Assessment:**\n- Low risk: core approach is proven\n- Medium risk: scaling challenges exist\n- Mitigation: incremental rollout with checkpoints\n\nThe writer should emphasize the phased approach in the final response.",

        "My evaluation of all gathered information:\n\n**Overall Assessment:** Strong - the research supports our direction.\n\n**Priority Actions:**\n1. Address the scalability concern first\n2. Leverage the case study precedents\n3. Plan for cross-disciplinary opportunities\n\nI'm confident we can deliver a well-reasoned final response.",
      ],
      writer: [
        "Here is the polished response incorporating all team findings:\n\n---\n\n# Executive Summary\n\nOur collaborative analysis reveals a promising path forward. Drawing on comprehensive research and careful evaluation, we recommend a phased approach that balances innovation with practical considerations.\n\n## Key Points\n\n1. **Strong Foundation** — Multiple data sources confirm the viability of the proposed direction.\n2. **Managed Risk** — A phased rollout strategy mitigates the primary concerns around scalability.\n3. **Growth Potential** — Cross-disciplinary applications offer significant upside.\n\n## Next Steps\n\nWe propose beginning with a pilot phase, followed by iterative expansion based on validated results.\n\n---\n\nThis response is ready for review.",

        "Based on the team's thorough analysis, here is the refined output:\n\n---\n\n# Comprehensive Report\n\nAfter careful research and analysis, our team has developed a robust recommendation.\n\n## Findings\n\nThe evidence strongly supports moving forward. Key data points align across multiple studies, and industry precedents validate our approach.\n\n## Strategic Recommendation\n\nWe recommend an incremental strategy:\n- **Phase 1:** Validate core assumptions (weeks 1-4)\n- **Phase 2:** Scale proven approaches (weeks 5-8)\n- **Phase 3:** Expand to adjacent opportunities (weeks 9-12)\n\n## Conclusion\n\nThe opportunity is clear, the risks are manageable, and the team is aligned. We're ready to proceed.\n\n---",

        "Final polished deliverable from the team:\n\n---\n\n# Summary & Recommendations\n\nOur multi-perspective analysis has yielded a clear and actionable recommendation.\n\n## What We Found\n\n- Research confirms a solid foundation for the initiative\n- Analysis identifies manageable risks with clear mitigation paths  \n- The timeline is achievable with proper planning\n\n## Our Recommendation\n\nProceed with confidence using a phased approach. The data supports our direction, and the team is aligned on strategy.\n\n---\n\nThe team has completed its collaborative review.",
      ],
    };
  }

  async create(
    messages: Message[],
    _options?: Record<string, unknown>
  ): Promise<ChatCompletionResult> {
    // Determine which role this LLM serves based on the model name
    const role = this.model.replace("mock-llm-", "");
    const responses = this.responseMap[role] ?? this.responseMap["writer"]!;
    const count = this.callCounts.get(role) ?? 0;
    this.callCounts.set(role, count + 1);
    const response = responses[count % responses.length]!;

    // Simulate a small delay
    await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));

    return {
      message: {
        role: "assistant" as const,
        content: response,
        source: role,
        timestamp: new Date(),
      },
      usage: createMockUsage(),
      model: this.model,
      finishReason: "stop",
    };
  }

  async *createStream(
    messages: Message[],
    options?: Record<string, unknown>
  ): AsyncGenerator<ChatCompletionChunk, void, undefined> {
    const result = await this.create(messages, options);
    // Stream content word by word
    const words = result.message.content.split(" ");
    let accumulated = "";
    for (let i = 0; i < words.length; i++) {
      accumulated += (i > 0 ? " " : "") + words[i];
      yield {
        content: words[i] + (i < words.length - 1 ? " " : ""),
        isComplete: i === words.length - 1,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Create agents
// ---------------------------------------------------------------------------

const researcher = new Agent({
  name: "researcher",
  description: "Research specialist who gathers information, facts, and relevant data on any topic.",
  instructions:
    "You are a thorough researcher. When given a task, gather relevant information, " +
    "identify key facts, and present your findings in a structured format. " +
    "Focus on comprehensiveness and accuracy.",
  modelClient: new MockLLM("researcher") as unknown as BaseChatCompletionClient,
  exampleTasks: [
    "Research the history of artificial intelligence",
    "Find recent trends in renewable energy",
    "Investigate best practices for remote team collaboration",
  ],
});

const analyst = new Agent({
  name: "analyst",
  description: "Analytical thinker who evaluates findings, identifies patterns, and synthesizes insights.",
  instructions:
    "You are a skilled analyst. Review the research provided by teammates, " +
    "identify patterns and insights, evaluate strengths and risks, " +
    "and provide clear recommendations. Be objective and data-driven.",
  modelClient: new MockLLM("analyst") as unknown as BaseChatCompletionClient,
  exampleTasks: [
    "Analyze the competitive landscape for a new product",
    "Evaluate the pros and cons of different approaches",
    "Synthesize findings from multiple data sources",
  ],
});

const writer = new Agent({
  name: "writer",
  description: "Expert writer who crafts polished, well-structured responses from team inputs.",
  instructions:
    "You are an expert writer. Take the research and analysis from your teammates " +
    "and craft a polished, well-structured final response. Use clear language, " +
    "proper formatting, and ensure the output is ready for presentation.",
  modelClient: new MockLLM("writer") as unknown as BaseChatCompletionClient,
  exampleTasks: [
    "Write an executive summary from research findings",
    "Draft a project proposal based on analysis",
    "Create a comprehensive report on a topic",
  ],
});

// ---------------------------------------------------------------------------
// Create orchestrator
// ---------------------------------------------------------------------------

const termination = new MaxMessageTermination(12);

const orchestrator = new RoundRobinOrchestrator(
  [researcher, analyst, writer],
  termination,
  50
);
// Set name and description for the WebUI display
(orchestrator as unknown as Record<string, unknown>).name = "research-team";
(orchestrator as unknown as Record<string, unknown>).description =
  "A round-robin team of Researcher → Analyst → Writer that collaborates on any task. " +
  "Each agent takes a turn, building on the previous agent's work.";
(orchestrator as unknown as Record<string, unknown>).exampleTasks = [
  "Write a research report on the future of AI agents",
  "Analyze the benefits of microservices architecture",
  "Create a strategy document for entering a new market",
];

// ---------------------------------------------------------------------------
// Launch WebUI
// ---------------------------------------------------------------------------

console.log("=".repeat(60));
console.log("  PicoAgents Round-Robin Orchestrator Demo");
console.log("=".repeat(60));
console.log();
console.log("Entities registered:");
console.log("  - researcher (agent)");
console.log("  - analyst (agent)");
console.log("  - writer (agent)");
console.log("  - research-team (round-robin orchestrator)");
console.log();

const { server } = serveWebUI({
  entities: [researcher, analyst, writer, orchestrator],
  port: 8080,
  host: "127.0.0.1",
});

console.log();
console.log("Open your browser to http://localhost:8080");
console.log("Select 'research-team' from the entity list to try the orchestrator.");
console.log("Or select any individual agent to chat directly.");
console.log();
console.log("Press Ctrl+C to stop.");
