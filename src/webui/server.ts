/**
 * Hono server for PicoAgents WebUI.
 *
 * Provides REST API endpoints and serves the frontend UI.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { RunEntityRequest, HealthResponse, StatsResponse } from "./models.js";
import { EntityRegistry } from "./registry.js";
import { SessionManager } from "./sessions.js";
import { ExecutionEngine } from "./execution.js";

export class PicoAgentsWebUIServer {
  readonly registry: EntityRegistry;
  readonly sessionManager: SessionManager;
  readonly executionEngine: ExecutionEngine;

  constructor(
    options?: {
      enableCors?: boolean;
      corsOrigins?: string[];
    }
  ) {
    this.registry = new EntityRegistry();
    this.sessionManager = new SessionManager();
    this.executionEngine = new ExecutionEngine(this.sessionManager);
  }

  createApp(): Hono {
    const app = new Hono();

    // CORS middleware
    app.use(
      "/api/*",
      cors({
        origin: "*",
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowHeaders: ["Content-Type"],
      })
    );

    this._registerRoutes(app);
    this._mountFrontend(app);
    return app;
  }

  private _registerRoutes(app: Hono): void {
    // Health check
    app.get("/api/health", (c) => {
      const entities = this.registry.listEntities();
      const response: HealthResponse = {
        status: "healthy",
        entitiesCount: entities.length,
      };
      return c.json(response);
    });

    // List entities
    app.get("/api/entities", (c) => {
      try {
        const entities = this.registry.listEntities();
        return c.json(entities);
      } catch (err) {
        return c.json({ error: String(err) }, 500);
      }
    });

    // Get entity by ID
    app.get("/api/entities/:id", (c) => {
      const entityId = c.req.param("id");
      const info = this.registry.getEntityInfo(entityId);
      if (!info) {
        return c.json({ error: `Entity ${entityId} not found` }, 404);
      }
      return c.json(info);
    });

    // Delete entity
    app.delete("/api/entities/:id", (c) => {
      const entityId = c.req.param("id");
      const removed = this.registry.unregisterEntity(entityId);
      if (!removed) {
        return c.json({ error: `Entity ${entityId} not found` }, 404);
      }
      return c.json({
        status: "success",
        entityId,
        message: "Entity removed successfully",
      });
    });

    // Run entity (streaming)
    app.post("/api/entities/:id/run/stream", async (c) => {
      const entityId = c.req.param("id");
      const entityObj = this.registry.getEntityObject(entityId);
      if (!entityObj) {
        return c.json({ error: `Entity ${entityId} not found` }, 404);
      }

      const entityInfo = this.registry.getEntityInfo(entityId);
      if (!entityInfo) {
        return c.json({ error: `Entity info for ${entityId} not found` }, 404);
      }

      const body = (await c.req.json()) as RunEntityRequest;

      return streamSSE(c, async (stream) => {
        try {
          let eventGenerator: AsyncGenerator<string>;

          if (entityInfo.type === "agent") {
            if (!body.messages && !body.approvalResponses) {
              await stream.writeSSE({
                data: JSON.stringify({
                  sessionId: body.sessionId ?? "",
                  timestamp: new Date().toISOString(),
                  event: { type: "error", message: "Messages required for agent execution" },
                }),
                event: "error",
              });
              return;
            }

            const messages = (body.messages ?? []).map((m) => ({
              role: m.role as "user",
              content: m.content,
              source: m.source ?? "user",
              timestamp: new Date(),
            }));

            eventGenerator = this.executionEngine.executeAgentStream(
              entityObj,
              messages as import("../messages.js").Message[],
              {
                sessionId: body.sessionId,
                streamTokens: body.streamTokens ?? true,
                approvalResponses: body.approvalResponses,
              }
            );
          } else if (entityInfo.type === "orchestrator") {
            if (!body.messages) {
              await stream.writeSSE({
                data: JSON.stringify({
                  sessionId: body.sessionId ?? "",
                  timestamp: new Date().toISOString(),
                  event: { type: "error", message: "Messages required for orchestrator execution" },
                }),
                event: "error",
              });
              return;
            }

            const messages = body.messages.map((m) => ({
              role: m.role as "user",
              content: m.content,
              source: m.source ?? "user",
              timestamp: new Date(),
            }));

            eventGenerator = this.executionEngine.executeOrchestratorStream(
              entityObj,
              messages as import("../messages.js").Message[],
              {
                sessionId: body.sessionId,
              }
            );
          } else if (entityInfo.type === "workflow") {
            if (body.inputData === undefined) {
              await stream.writeSSE({
                data: JSON.stringify({
                  sessionId: body.sessionId ?? "",
                  timestamp: new Date().toISOString(),
                  event: { type: "error", message: "Input data required for workflow execution" },
                }),
                event: "error",
              });
              return;
            }

            eventGenerator = this.executionEngine.executeWorkflowStream(
              entityObj,
              body.inputData,
              {
                sessionId: body.sessionId,
              }
            );
          } else {
            await stream.writeSSE({
              data: JSON.stringify({
                sessionId: body.sessionId ?? "",
                timestamp: new Date().toISOString(),
                event: { type: "error", message: `Unknown entity type: ${(entityInfo as { type: string }).type}` },
              }),
              event: "error",
            });
            return;
          }

          for await (const sseData of eventGenerator) {
            // sseData is already formatted as "data: ...\n\n"
            // Extract the JSON part
            const jsonStr = sseData.replace(/^data: /, "").replace(/\n\n$/, "");
            await stream.writeSSE({ data: jsonStr, event: "message" });
          }
        } catch (err) {
          await stream.writeSSE({
            data: JSON.stringify({
              sessionId: body.sessionId ?? "",
              timestamp: new Date().toISOString(),
              event: { type: "error", message: String(err) },
            }),
            event: "error",
          });
        }
      });
    });

    // Session routes
    app.get("/api/sessions", async (c) => {
      const entityId = c.req.query("entityId");
      const sessions = await this.sessionManager.list(entityId);
      return c.json(sessions);
    });

    app.post("/api/sessions", async (c) => {
      const body = (await c.req.json()) as {
        entityId?: string;
        entityType?: string;
      };
      if (!body.entityId) {
        return c.json({ error: "entityId is required" }, 400);
      }
      const sessionId = this.sessionManager.createSessionId();
      const context = await this.sessionManager.getOrCreate(
        sessionId,
        body.entityId,
        body.entityType ?? "agent"
      );
      return c.json({
        id: sessionId,
        entityId: body.entityId,
        entityType: body.entityType ?? "agent",
        createdAt: context.createdAt.toISOString(),
        messageCount: 0,
        lastActivity: context.createdAt.toISOString(),
      });
    });

    app.get("/api/sessions/:id", async (c) => {
      const sessionId = c.req.param("id");
      const context = await this.sessionManager.get(sessionId);
      if (!context) {
        return c.json({ error: `Session ${sessionId} not found` }, 404);
      }
      return c.json(context.toDict());
    });

    app.get("/api/sessions/:id/messages", async (c) => {
      const sessionId = c.req.param("id");
      const context = await this.sessionManager.get(sessionId);
      if (!context) {
        return c.json({ error: `Session ${sessionId} not found` }, 404);
      }
      return c.json({
        sessionId,
        messages: context.messages,
      });
    });

    app.delete("/api/sessions/:id", async (c) => {
      const sessionId = c.req.param("id");
      const success = await this.sessionManager.delete(sessionId);
      if (!success) {
        return c.json({ error: `Session ${sessionId} not found` }, 404);
      }
      return c.json({ status: "deleted", sessionId });
    });

    // Stats
    app.get("/api/stats", async (c) => {
      try {
        const entities = this.registry.listEntities();
        const sessions = await this.sessionManager.list();

        const stats: StatsResponse = {
          entities: {
            total: entities.length,
            byType: {
              agents: entities.filter((e) => e.type === "agent").length,
              orchestrators: entities.filter((e) => e.type === "orchestrator")
                .length,
              workflows: entities.filter((e) => e.type === "workflow").length,
            },
          },
          sessions: {
            totalSessions: sessions.length,
            totalMessages: sessions.reduce(
              (sum, s) => sum + s.messageCount,
              0
            ),
          },
        };
        return c.json(stats);
      } catch (err) {
        return c.json({ error: String(err) }, 500);
      }
    });
  }

  private _mountFrontend(app: Hono): void {
    // Resolve the ui/ directory relative to this source file
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const uiDir = join(thisDir, "ui");

    if (!existsSync(uiDir)) {
      // No frontend build — serve a JSON fallback at root
      app.get("/", (c) =>
        c.json({
          message: "PicoAgents WebUI API",
          health: "/api/health",
          note: "Frontend not built — run 'npm run build' in src/webui/frontend/",
        })
      );
      return;
    }

    // Serve static files by reading from disk
    // (serveStatic uses CWD-relative paths which break when run from different dirs)
    const mimeTypes: Record<string, string> = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".ico": "image/x-icon",
      ".json": "application/json",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
    };

    const indexHtml = readFileSync(join(uiDir, "index.html"), "utf-8");

    // Serve assets
    app.get("/assets/*", (c) => {
      const assetPath = join(uiDir, c.req.path);
      if (!existsSync(assetPath)) {
        return c.notFound();
      }
      const ext = assetPath.substring(assetPath.lastIndexOf("."));
      const contentType = mimeTypes[ext] ?? "application/octet-stream";
      const content = readFileSync(assetPath);
      return new Response(content, {
        headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=31536000, immutable" },
      });
    });

    // Serve other static files (favicon, etc.)
    app.get("/vite.svg", (c) => {
      const svgPath = join(uiDir, "vite.svg");
      if (!existsSync(svgPath)) return c.notFound();
      return new Response(readFileSync(svgPath), {
        headers: { "Content-Type": "image/svg+xml" },
      });
    });

    // SPA fallback: serve index.html for all non-API routes
    app.get("*", (c) => {
      return c.html(indexHtml);
    });
  }
}

/**
 * Create a Hono app for PicoAgents WebUI.
 */
export function createApp(): { app: Hono; server: PicoAgentsWebUIServer } {
  const server = new PicoAgentsWebUIServer();
  const app = server.createApp();
  return { app, server };
}
