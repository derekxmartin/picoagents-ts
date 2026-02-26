/**
 * Component configuration system for PicoAgents TypeScript.
 *
 * Provides a flexible component serialization and loading system that allows
 * components to be saved as JSON configurations and loaded back as instances.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Component types
// ---------------------------------------------------------------------------

export type ComponentType =
  | "model"
  | "agent"
  | "tool"
  | "termination"
  | "orchestrator"
  | "step"
  | "workflow"
  | string;

// ---------------------------------------------------------------------------
// ComponentModel — serialized representation
// ---------------------------------------------------------------------------

export const ComponentModelSchema = z.object({
  provider: z
    .string()
    .describe(
      'Fully qualified class identifier for component instantiation. Format: "module/path/ClassName"'
    ),
  componentType: z
    .string()
    .optional()
    .describe("Logical type of the component"),
  version: z
    .number()
    .optional()
    .describe("Version of the component specification schema"),
  componentVersion: z
    .number()
    .optional()
    .describe("Version of the specific component implementation"),
  description: z
    .string()
    .optional()
    .describe("Human-readable description of the component"),
  label: z
    .string()
    .optional()
    .describe("Display name for the component in UIs"),
  config: z
    .record(z.string(), z.unknown())
    .describe("Schema-validated configuration data for component instantiation"),
});

export type ComponentModel = z.infer<typeof ComponentModelSchema>;

// ---------------------------------------------------------------------------
// Well-known providers
// ---------------------------------------------------------------------------

export const WELL_KNOWN_PROVIDERS: Record<string, string> = {
  // LLM Clients
  openai_chat_completion_client: "picoagents/llm/OpenAIChatCompletionClient",
  OpenAIChatCompletionClient: "picoagents/llm/OpenAIChatCompletionClient",
  model_client: "picoagents/llm/OpenAIChatCompletionClient",
  // Agents
  agent: "picoagents/agents/Agent",
  Agent: "picoagents/agents/Agent",
  // Memory
  list_memory: "picoagents/memory/ListMemory",
  ListMemory: "picoagents/memory/ListMemory",
  file_memory: "picoagents/memory/FileMemory",
  FileMemory: "picoagents/memory/FileMemory",
  memory: "picoagents/memory/ListMemory",
  // Workflow
  workflow: "picoagents/workflow/Workflow",
  Workflow: "picoagents/workflow/Workflow",
  picoagent_step: "picoagents/workflow/PicoAgentStep",
  PicoAgentStep: "picoagents/workflow/PicoAgentStep",
};

// ---------------------------------------------------------------------------
// ComponentBase — abstract base for all components
// ---------------------------------------------------------------------------

/**
 * Abstract base class for components that can be serialized to/from config.
 *
 * In TypeScript, we simplify the Python mixin pattern into a single abstract class.
 * Subclasses must implement:
 * - static componentType: ComponentType
 * - static componentVersion: number
 * - toConfig(): Record<string, unknown>
 * - static fromConfig(config: Record<string, unknown>): ComponentBase
 */
export abstract class ComponentBase {
  static componentType: ComponentType;
  static componentVersion: number = 1;
  static componentProviderOverride?: string;
  static componentDescription?: string;
  static componentLabel?: string;

  /**
   * Serialize this component's current configuration.
   */
  abstract toConfig(): Record<string, unknown>;

  /**
   * Dump the component to a ComponentModel that can be loaded back.
   */
  dumpComponent(): ComponentModel {
    const ctor = this.constructor as typeof ComponentBase;

    const provider =
      ctor.componentProviderOverride ?? ctor.name;

    const description =
      ctor.componentDescription ?? undefined;

    const config = this.toConfig();

    return {
      provider,
      componentType: ctor.componentType,
      version: ctor.componentVersion,
      componentVersion: ctor.componentVersion,
      description,
      label: ctor.componentLabel ?? ctor.name,
      config,
    };
  }
}

// ---------------------------------------------------------------------------
// ComponentLoader
// ---------------------------------------------------------------------------

/** Registry for component classes, keyed by provider string. */
const componentRegistry = new Map<string, new (...args: unknown[]) => ComponentBase>();

/**
 * Register a component class so it can be loaded by provider string.
 */
export function registerComponent(
  provider: string,
  componentClass: new (...args: unknown[]) => ComponentBase
): void {
  componentRegistry.set(provider, componentClass);
}

/**
 * Load a component from a ComponentModel or plain config object.
 *
 * Uses the component registry to find the class by provider string.
 * In Node.js, dynamic import() could also be used for module-based loading.
 */
export function loadComponent(
  model: ComponentModel | Record<string, unknown>
): ComponentBase {
  const parsed = ComponentModelSchema.parse(model);

  // Resolve well-known providers
  let provider = parsed.provider;
  if (provider in WELL_KNOWN_PROVIDERS) {
    provider = WELL_KNOWN_PROVIDERS[provider];
  }

  const ComponentClass = componentRegistry.get(provider);
  if (!ComponentClass) {
    throw new Error(
      `Component provider "${provider}" not found in registry. ` +
      `Register it with registerComponent() first.`
    );
  }

  // Check if the class has a static fromConfig method
  const cls = ComponentClass as unknown as {
    fromConfig?: (config: Record<string, unknown>) => ComponentBase;
  };
  if (typeof cls.fromConfig === "function") {
    return cls.fromConfig(parsed.config);
  }

  throw new Error(
    `Component class "${provider}" does not implement static fromConfig()`
  );
}
