/**
 * Tests for WebUI session management.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemorySessionStore } from "../webui/session-store.js";
import { SessionManager } from "../webui/sessions.js";
import { AgentContext } from "../context.js";

describe("InMemorySessionStore", () => {
  let store: InMemorySessionStore;

  beforeEach(() => {
    store = new InMemorySessionStore();
  });

  it("should return null for non-existent session", async () => {
    const result = await store.get("nonexistent");
    expect(result).toBeNull();
  });

  it("should save and retrieve a session", async () => {
    const ctx = new AgentContext({
      sessionId: "test-1",
      metadata: { entityId: "agent1", entityType: "agent" },
    });
    ctx.addMessage({
      role: "user",
      content: "Hello",
      source: "user",
      timestamp: new Date(),
    });

    await store.save("test-1", ctx);
    const retrieved = await store.get("test-1");

    expect(retrieved).not.toBeNull();
    expect(retrieved!.sessionId).toBe("test-1");
    expect(retrieved!.messages.length).toBe(1);
  });

  it("should list sessions", async () => {
    const ctx1 = new AgentContext({
      sessionId: "s1",
      metadata: {
        entityId: "agent1",
        entityType: "agent",
        lastActivity: new Date("2024-01-01"),
      },
    });
    const ctx2 = new AgentContext({
      sessionId: "s2",
      metadata: {
        entityId: "agent2",
        entityType: "agent",
        lastActivity: new Date("2024-01-02"),
      },
    });

    await store.save("s1", ctx1);
    await store.save("s2", ctx2);

    const sessions = await store.list();
    expect(sessions.length).toBe(2);
    // Most recent first
    expect(sessions[0].id).toBe("s2");
    expect(sessions[1].id).toBe("s1");
  });

  it("should filter sessions by entityId", async () => {
    const ctx1 = new AgentContext({
      sessionId: "s1",
      metadata: { entityId: "agent1", entityType: "agent" },
    });
    const ctx2 = new AgentContext({
      sessionId: "s2",
      metadata: { entityId: "agent2", entityType: "agent" },
    });

    await store.save("s1", ctx1);
    await store.save("s2", ctx2);

    const filtered = await store.list("agent1");
    expect(filtered.length).toBe(1);
    expect(filtered[0].entityId).toBe("agent1");
  });

  it("should delete a session", async () => {
    const ctx = new AgentContext({ sessionId: "s1" });
    await store.save("s1", ctx);

    const deleted = await store.delete("s1");
    expect(deleted).toBe(true);

    const result = await store.get("s1");
    expect(result).toBeNull();
  });

  it("should return false for deleting non-existent session", async () => {
    const deleted = await store.delete("nonexistent");
    expect(deleted).toBe(false);
  });

  it("should clear all sessions", async () => {
    await store.save("s1", new AgentContext({ sessionId: "s1" }));
    await store.save("s2", new AgentContext({ sessionId: "s2" }));
    await store.save("s3", new AgentContext({ sessionId: "s3" }));

    const count = await store.clearAll();
    expect(count).toBe(3);

    const sessions = await store.list();
    expect(sessions.length).toBe(0);
  });

  it("should count messages correctly", async () => {
    const ctx = new AgentContext({
      sessionId: "s1",
      metadata: { entityId: "a1", entityType: "agent" },
    });
    ctx.addMessage({
      role: "user",
      content: "Hello",
      source: "user",
      timestamp: new Date(),
    });
    ctx.addMessage({
      role: "assistant",
      content: "Hi",
      source: "agent",
      timestamp: new Date(),
    });

    await store.save("s1", ctx);
    const sessions = await store.list();
    expect(sessions[0].messageCount).toBe(2);
  });
});

describe("SessionManager", () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  it("should create a new session via getOrCreate", async () => {
    const ctx = await manager.getOrCreate("s1", "agent1", "agent");

    expect(ctx).toBeInstanceOf(AgentContext);
    expect(ctx.sessionId).toBe("s1");
    expect(ctx.metadata["entityId"]).toBe("agent1");
    expect(ctx.metadata["entityType"]).toBe("agent");
  });

  it("should return existing session via getOrCreate", async () => {
    const ctx1 = await manager.getOrCreate("s1", "agent1");
    ctx1.addMessage({
      role: "user",
      content: "Hello",
      source: "user",
      timestamp: new Date(),
    });
    await manager.update("s1", ctx1);

    const ctx2 = await manager.getOrCreate("s1", "agent1");
    expect(ctx2.messages.length).toBe(1);
    expect(ctx2.messages[0].content).toBe("Hello");
  });

  it("should get session by ID", async () => {
    await manager.getOrCreate("s1", "agent1");
    const ctx = await manager.get("s1");
    expect(ctx).not.toBeNull();
  });

  it("should return null for non-existent session", async () => {
    const ctx = await manager.get("nonexistent");
    expect(ctx).toBeNull();
  });

  it("should update lastActivity on update", async () => {
    const ctx = await manager.getOrCreate("s1", "agent1");
    const before = ctx.metadata["lastActivity"] as Date;

    // Small delay to ensure timestamp changes
    await new Promise((r) => setTimeout(r, 10));

    await manager.update("s1", ctx);
    const after = ctx.metadata["lastActivity"] as Date;

    expect(after.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it("should list sessions", async () => {
    await manager.getOrCreate("s1", "agent1");
    await manager.getOrCreate("s2", "agent2");

    const sessions = await manager.list();
    expect(sessions.length).toBe(2);
  });

  it("should list sessions filtered by entity", async () => {
    await manager.getOrCreate("s1", "agent1");
    await manager.getOrCreate("s2", "agent2");

    const sessions = await manager.list("agent1");
    expect(sessions.length).toBe(1);
  });

  it("should delete a session", async () => {
    await manager.getOrCreate("s1", "agent1");
    const deleted = await manager.delete("s1");
    expect(deleted).toBe(true);

    const ctx = await manager.get("s1");
    expect(ctx).toBeNull();
  });

  it("should clear all sessions", async () => {
    await manager.getOrCreate("s1", "agent1");
    await manager.getOrCreate("s2", "agent2");

    const count = await manager.clearAll();
    expect(count).toBe(2);
  });

  it("should generate unique session IDs", () => {
    const id1 = manager.createSessionId();
    const id2 = manager.createSessionId();

    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
  });

  it("should default entityType to agent", async () => {
    const ctx = await manager.getOrCreate("s1", "agent1");
    expect(ctx.metadata["entityType"]).toBe("agent");
  });

  it("should support custom entity types", async () => {
    const ctx = await manager.getOrCreate("s1", "orch1", "orchestrator");
    expect(ctx.metadata["entityType"]).toBe("orchestrator");
  });
});
