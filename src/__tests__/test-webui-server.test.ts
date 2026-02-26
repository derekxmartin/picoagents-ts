/**
 * Tests for WebUI server routes using Hono's test client.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PicoAgentsWebUIServer } from "../webui/server.js";
import type { Hono } from "hono";

// ---------------------------------------------------------------------------
// Mock agent
// ---------------------------------------------------------------------------

class MockAgent {
  name: string;
  description: string;
  instructions: string;
  modelClient = { model: "test-model" };
  tools: Array<{ name: string }> = [];

  constructor(name: string) {
    this.name = name;
    this.description = `Mock agent ${name}`;
    this.instructions = `You are ${name}`;
  }

  async *runStream() {
    yield {
      role: "assistant" as const,
      content: "Hello from agent",
      source: this.name,
      timestamp: new Date(),
    };
    yield {
      context: {
        messages: [
          {
            role: "assistant" as const,
            content: "Hello from agent",
            source: this.name,
            timestamp: new Date(),
          },
        ],
      },
      source: this.name,
      usage: {
        durationMs: 10,
        llmCalls: 1,
        tokensInput: 10,
        tokensOutput: 5,
        toolCalls: 0,
        memoryOperations: 0,
      },
      timestamp: new Date(),
      finishReason: "stop",
    };
  }
}

class MockOrchestrator {
  name: string;
  description: string;
  agents: MockAgent[];
  termination = { constructor: { name: "MaxMessage" } };

  constructor(name: string) {
    this.name = name;
    this.description = `Orchestrator ${name}`;
    this.agents = [new MockAgent("sub-agent")];
  }

  async selectNextAgent() {
    return this.agents[0];
  }

  async *runStream() {
    yield { eventType: "orchestration_start", task: "test" };
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function createTestServer(): { app: Hono; server: PicoAgentsWebUIServer } {
  const server = new PicoAgentsWebUIServer();
  const agent = new MockAgent("test-agent");
  const orch = new MockOrchestrator("test-orch");
  server.registry.registerEntity("test-agent", agent);
  server.registry.registerEntity("test-orch", orch);
  const app = server.createApp();
  return { app, server };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PicoAgentsWebUIServer", () => {
  let app: Hono;
  let server: PicoAgentsWebUIServer;

  beforeEach(() => {
    ({ app, server } = createTestServer());
  });

  describe("Health", () => {
    it("should return healthy status", async () => {
      const res = await app.request("/api/health");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe("healthy");
      expect(body.entitiesCount).toBe(2);
    });
  });

  describe("Entities", () => {
    it("should list all entities", async () => {
      const res = await app.request("/api/entities");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.length).toBe(2);
    });

    it("should get entity by ID", async () => {
      const res = await app.request("/api/entities/test-agent");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.name).toBe("test-agent");
      expect(body.type).toBe("agent");
    });

    it("should return 404 for non-existent entity", async () => {
      const res = await app.request("/api/entities/nonexistent");
      expect(res.status).toBe(404);
    });

    it("should delete an entity", async () => {
      const res = await app.request("/api/entities/test-agent", {
        method: "DELETE",
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe("success");

      // Verify deleted
      const getRes = await app.request("/api/entities/test-agent");
      expect(getRes.status).toBe(404);
    });

    it("should return 404 for deleting non-existent entity", async () => {
      const res = await app.request("/api/entities/nonexistent", {
        method: "DELETE",
      });
      expect(res.status).toBe(404);
    });
  });

  describe("Sessions", () => {
    it("should create a new session", async () => {
      const res = await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId: "test-agent",
          entityType: "agent",
        }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.id).toBeTruthy();
      expect(body.entityId).toBe("test-agent");
      expect(body.messageCount).toBe(0);
    });

    it("should return 400 if entityId missing", async () => {
      const res = await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it("should list sessions", async () => {
      // Create a session first
      await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId: "test-agent",
          entityType: "agent",
        }),
      });

      const res = await app.request("/api/sessions");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.length).toBeGreaterThanOrEqual(1);
    });

    it("should get session by ID", async () => {
      const createRes = await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId: "test-agent",
          entityType: "agent",
        }),
      });
      const { id: sessionId } = await createRes.json();

      const res = await app.request(`/api/sessions/${sessionId}`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.sessionId).toBe(sessionId);
    });

    it("should return 404 for non-existent session", async () => {
      const res = await app.request("/api/sessions/nonexistent");
      expect(res.status).toBe(404);
    });

    it("should get session messages", async () => {
      const createRes = await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId: "test-agent",
          entityType: "agent",
        }),
      });
      const { id: sessionId } = await createRes.json();

      const res = await app.request(`/api/sessions/${sessionId}/messages`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.sessionId).toBe(sessionId);
      expect(body.messages).toEqual([]);
    });

    it("should delete a session", async () => {
      const createRes = await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId: "test-agent",
          entityType: "agent",
        }),
      });
      const { id: sessionId } = await createRes.json();

      const res = await app.request(`/api/sessions/${sessionId}`, {
        method: "DELETE",
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe("deleted");
    });

    it("should return 404 for deleting non-existent session", async () => {
      const res = await app.request("/api/sessions/nonexistent", {
        method: "DELETE",
      });
      expect(res.status).toBe(404);
    });
  });

  describe("Stats", () => {
    it("should return stats", async () => {
      const res = await app.request("/api/stats");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.entities.total).toBe(2);
      expect(body.entities.byType.agents).toBe(1);
      expect(body.entities.byType.orchestrators).toBe(1);
      expect(body.sessions.totalSessions).toBe(0);
    });

    it("should reflect session count in stats", async () => {
      // Create a session
      await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId: "test-agent",
          entityType: "agent",
        }),
      });

      const res = await app.request("/api/stats");
      const body = await res.json();
      expect(body.sessions.totalSessions).toBe(1);
    });
  });

  describe("Streaming Endpoint", () => {
    it("should return 404 for non-existent entity", async () => {
      const res = await app.request("/api/entities/nonexistent/run/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Hello" }],
        }),
      });
      expect(res.status).toBe(404);
    });

    it("should stream agent execution events", async () => {
      const res = await app.request("/api/entities/test-agent/run/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Hello" }],
        }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");

      // Read the stream
      const text = await res.text();
      expect(text.length).toBeGreaterThan(0);
      // SSE events contain "data:" lines
      expect(text).toContain("data:");
    });
  });

  describe("CORS", () => {
    it("should include CORS headers on API routes", async () => {
      const res = await app.request("/api/health", {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:3000",
          "Access-Control-Request-Method": "GET",
        },
      });
      // CORS middleware handles OPTIONS
      expect(res.status).toBeLessThan(400);
    });
  });
});
