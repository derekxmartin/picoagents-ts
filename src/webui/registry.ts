/**
 * Entity registry for PicoAgents WebUI.
 *
 * Manages registered entities and provides access to them for execution.
 */

import type {
  Entity,
  AgentInfo,
  OrchestratorInfo,
  WorkflowInfo,
} from "./models.js";

export class EntityRegistry {
  private _entities = new Map<string, Entity>();
  private _objects = new Map<string, unknown>();

  /**
   * Register an in-memory entity.
   *
   * Introspects the object to determine its type and extract metadata.
   */
  registerEntity(entityId: string, entityObj: unknown): void {
    this._objects.set(entityId, entityObj);

    const info = this._createEntityInfo(entityId, entityObj);
    if (info) {
      this._entities.set(entityId, info);
    }
  }

  /** Get entity information by ID. */
  getEntityInfo(entityId: string): Entity | null {
    return this._entities.get(entityId) ?? null;
  }

  /** Get the actual entity object for execution. */
  getEntityObject(entityId: string): unknown | null {
    return this._objects.get(entityId) ?? null;
  }

  /** List all registered entities. */
  listEntities(): Entity[] {
    return [...this._entities.values()];
  }

  /** Unregister an entity from the registry. */
  unregisterEntity(entityId: string): boolean {
    const hadEntity = this._entities.delete(entityId);
    this._objects.delete(entityId);
    return hadEntity;
  }

  /** Clear all entities. */
  clear(): void {
    this._entities.clear();
    this._objects.clear();
  }

  // ---------------------------------------------------------------------------
  // Introspection
  // ---------------------------------------------------------------------------

  private _createEntityInfo(
    entityId: string,
    obj: unknown
  ): Entity | null {
    if (!obj || typeof obj !== "object") return null;

    const entity = obj as Record<string, unknown>;

    const common = {
      id: entityId,
      name: (entity["name"] as string) ?? entityId,
      description: entity["description"] as string | undefined,
      source: "memory" as const,
      tools: [] as string[],
      exampleTasks: (entity["exampleTasks"] as string[]) ?? [],
    };

    // Extract tools if present
    if (Array.isArray(entity["tools"])) {
      common.tools = (entity["tools"] as Array<Record<string, unknown>>).map(
        (t) => (t["name"] as string) ?? String(t)
      );
    }

    // Detect type by checking for distinguishing properties
    // Orchestrators have an "agents" array
    if (Array.isArray(entity["agents"]) && typeof entity["selectNextAgent"] === "function") {
      const agents = (entity["agents"] as Array<Record<string, unknown>>).map(
        (a) => (a["name"] as string) ?? String(a)
      );
      const orchestratorType =
        (obj as { constructor?: { name?: string } }).constructor?.name
          ?.toLowerCase()
          .replace("orchestrator", "") ?? "custom";
      const termination = entity["termination"] as
        | Record<string, unknown>
        | undefined;
      const terminationConditions = termination
        ? [(termination.constructor as { name?: string })?.name ?? "unknown"]
        : [];

      return {
        ...common,
        type: "orchestrator" as const,
        orchestratorType,
        agents,
        terminationConditions,
      } as OrchestratorInfo;
    }

    // Workflows have a "steps" Map and "edges" array
    if (entity["steps"] instanceof Map && Array.isArray(entity["edges"])) {
      const steps = [...(entity["steps"] as Map<string, unknown>).keys()];
      const metadata = entity["metadata"] as Record<string, unknown> | undefined;
      const startStep = metadata?.["startStep"] as string | undefined;

      return {
        ...common,
        type: "workflow" as const,
        steps,
        startStep,
      } as WorkflowInfo;
    }

    // Agents have modelClient and instructions
    if (
      entity["modelClient"] !== undefined &&
      typeof entity["instructions"] === "string"
    ) {
      const modelClient = entity["modelClient"] as Record<string, unknown> | null;
      const model = modelClient?.["model"] as string | undefined;
      const memory = entity["memory"] as Record<string, unknown> | undefined;
      const memoryType = memory
        ? (memory.constructor as { name?: string })?.name
        : undefined;

      return {
        ...common,
        type: "agent" as const,
        model,
        memoryType,
      } as AgentInfo;
    }

    // Duck-type fallback: has run/runStream → treat as agent
    if (typeof entity["runStream"] === "function" && entity["name"]) {
      return {
        ...common,
        type: "agent" as const,
      } as AgentInfo;
    }

    return null;
  }
}
