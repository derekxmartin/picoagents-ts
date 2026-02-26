/**
 * PicoAgents WebUI — Web interface for PicoAgents entities.
 *
 * Provides a web-based interface for discovering, running, and interacting with
 * PicoAgents agents, orchestrators, and workflows.
 */

import { serve as honoServe } from "@hono/node-server";
import { PicoAgentsWebUIServer, createApp } from "./server.js";

// Re-export public API
export {
  PicoAgentsWebUIServer,
  createApp,
} from "./server.js";

export {
  EntityRegistry,
} from "./registry.js";

export {
  SessionManager,
} from "./sessions.js";

export {
  type SessionStore,
  InMemorySessionStore,
} from "./session-store.js";

export {
  ExecutionEngine,
} from "./execution.js";

export type {
  Entity,
  EntityInfo,
  AgentInfo,
  OrchestratorInfo,
  WorkflowInfo,
  WebUIStreamEvent,
  RunEntityRequest,
  HealthResponse,
  StatsResponse,
  SessionInfo,
} from "./models.js";

// ---------------------------------------------------------------------------
// High-level API
// ---------------------------------------------------------------------------

export interface ServeOptions {
  entities?: unknown[];
  port?: number;
  host?: string;
}

/**
 * Serve entities via web interface.
 *
 * Simple API for serving agents, orchestrators, and workflows.
 *
 * @example
 * ```ts
 * import { Agent } from "picoagents-ts";
 * import { serve } from "picoagents-ts/webui";
 *
 * const agent = new Agent({ name: "assistant", ... });
 * serve({ entities: [agent], port: 8080 });
 * ```
 */
export function serve(options?: ServeOptions): {
  server: ReturnType<typeof honoServe>;
  webui: PicoAgentsWebUIServer;
} {
  const { entities, port = 8080, host = "127.0.0.1" } = options ?? {};

  const webuiServer = new PicoAgentsWebUIServer();

  // Register provided entities
  if (entities) {
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i] as Record<string, unknown>;
      const entityId = (entity["name"] as string) ?? `entity_${i}`;
      webuiServer.registry.registerEntity(entityId, entity);
    }
  }

  const app = webuiServer.createApp();

  const httpServer = honoServe({
    fetch: app.fetch,
    port,
    hostname: host,
  });

  console.log(`PicoAgents WebUI running at http://${host}:${port}`);

  return { server: httpServer, webui: webuiServer };
}

/**
 * Programmatic interface to the WebUI server.
 */
export class WebUIServer {
  private _server: PicoAgentsWebUIServer;
  readonly port: number;
  readonly host: string;
  private _httpServer?: ReturnType<typeof honoServe>;

  constructor(options?: {
    port?: number;
    host?: string;
    enableCors?: boolean;
    corsOrigins?: string[];
  }) {
    this._server = new PicoAgentsWebUIServer({
      enableCors: options?.enableCors,
      corsOrigins: options?.corsOrigins,
    });
    this.port = options?.port ?? 8080;
    this.host = options?.host ?? "127.0.0.1";
  }

  /** Register an in-memory entity. */
  registerEntity(entityId: string, entityObj: unknown): void {
    this._server.registry.registerEntity(entityId, entityObj);
  }

  /** Get the Hono application instance. */
  getApp() {
    return this._server.createApp();
  }

  /** Start the WebUI server. */
  start(): void {
    const entitiesCount = this._server.registry.listEntities().length;
    console.log(`Serving ${entitiesCount} entities`);

    const app = this._server.createApp();
    this._httpServer = honoServe({
      fetch: app.fetch,
      port: this.port,
      hostname: this.host,
    });

    console.log(`PicoAgents WebUI running at http://${this.host}:${this.port}`);
  }

  /** Stop the WebUI server. */
  stop(): void {
    if (this._httpServer) {
      (this._httpServer as { close?: () => void }).close?.();
      this._httpServer = undefined;
    }
  }
}
