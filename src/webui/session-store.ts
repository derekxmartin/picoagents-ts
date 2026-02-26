/**
 * Session storage abstraction for PicoAgents WebUI.
 *
 * Provides pluggable storage backends for conversation sessions.
 */

import { AgentContext } from "../context.js";
import type { SessionInfo } from "./models.js";

// ---------------------------------------------------------------------------
// SessionStore interface
// ---------------------------------------------------------------------------

export interface SessionStore {
  /** Retrieve session context by ID. */
  get(sessionId: string): Promise<AgentContext | null>;

  /** Persist session context. */
  save(sessionId: string, context: AgentContext): Promise<void>;

  /** List sessions with metadata, optionally filtered by entity. */
  list(entityId?: string): Promise<SessionInfo[]>;

  /** Delete a session. */
  delete(sessionId: string): Promise<boolean>;

  /** Clear all sessions. Returns count of deleted sessions. */
  clearAll(): Promise<number>;
}

// ---------------------------------------------------------------------------
// InMemorySessionStore
// ---------------------------------------------------------------------------

export class InMemorySessionStore implements SessionStore {
  private _sessions = new Map<string, AgentContext>();

  async get(sessionId: string): Promise<AgentContext | null> {
    return this._sessions.get(sessionId) ?? null;
  }

  async save(sessionId: string, context: AgentContext): Promise<void> {
    this._sessions.set(sessionId, context);
  }

  async list(entityId?: string): Promise<SessionInfo[]> {
    const sessions: SessionInfo[] = [];

    for (const [sid, ctx] of this._sessions) {
      // Filter by entityId if provided
      if (entityId && ctx.metadata["entityId"] !== entityId) {
        continue;
      }

      const lastActivity = ctx.metadata["lastActivity"] as Date | undefined;

      sessions.push({
        id: sid,
        entityId: (ctx.metadata["entityId"] as string) ?? "unknown",
        entityType: (ctx.metadata["entityType"] as string) ?? "agent",
        createdAt: ctx.createdAt.toISOString(),
        messageCount: ctx.messages.length,
        lastActivity: (lastActivity ?? ctx.createdAt).toISOString(),
      });
    }

    // Sort by last_activity (most recent first)
    sessions.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
    return sessions;
  }

  async delete(sessionId: string): Promise<boolean> {
    return this._sessions.delete(sessionId);
  }

  async clearAll(): Promise<number> {
    const count = this._sessions.size;
    this._sessions.clear();
    return count;
  }
}
