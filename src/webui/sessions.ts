/**
 * Session management for PicoAgents WebUI.
 *
 * Manages conversation sessions using AgentContext and pluggable storage.
 */

import { randomUUID } from "crypto";
import { AgentContext } from "../context.js";
import type { SessionInfo } from "./models.js";
import { InMemorySessionStore, type SessionStore } from "./session-store.js";

export class SessionManager {
  readonly store: SessionStore;

  constructor(store?: SessionStore) {
    this.store = store ?? new InMemorySessionStore();
  }

  /**
   * Get existing or create new session context.
   */
  async getOrCreate(
    sessionId: string,
    entityId: string,
    entityType = "agent"
  ): Promise<AgentContext> {
    let context = await this.store.get(sessionId);
    if (context === null) {
      context = new AgentContext({
        sessionId,
        metadata: {
          entityId,
          entityType,
          lastActivity: new Date(),
        },
      });
      await this.store.save(sessionId, context);
    }
    return context;
  }

  /** Get session context by ID. */
  async get(sessionId: string): Promise<AgentContext | null> {
    return this.store.get(sessionId);
  }

  /** Update session after agent interaction. */
  async update(sessionId: string, context: AgentContext): Promise<void> {
    context.metadata["lastActivity"] = new Date();
    await this.store.save(sessionId, context);
  }

  /** List all sessions with metadata. */
  async list(entityId?: string): Promise<SessionInfo[]> {
    return this.store.list(entityId);
  }

  /** Delete a session. */
  async delete(sessionId: string): Promise<boolean> {
    return this.store.delete(sessionId);
  }

  /** Clear all sessions. */
  async clearAll(): Promise<number> {
    return this.store.clearAll();
  }

  /** Generate a new unique session ID. */
  createSessionId(): string {
    return randomUUID();
  }
}
