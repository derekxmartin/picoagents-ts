/**
 * API client for PicoAgents WebUI backend
 * Handles entities, streaming, and session management
 */

import type {
  Entity,
  AgentInfo,
  OrchestratorInfo,
  WorkflowInfo,
  HealthResponse,
  RunEntityRequest,
  SessionInfo,
  StreamEvent,
} from "@/types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL !== undefined
    ? import.meta.env.VITE_API_BASE_URL
    : "http://localhost:8080";

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      ...options,
    });

    if (!response.ok) {
      throw new Error(
        `API request failed: ${response.status} ${response.statusText}`
      );
    }

    return response.json();
  }

  // Health check
  async getHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/api/health");
  }

  // Entity discovery - unified endpoint
  async getEntities(): Promise<Entity[]> {
    return this.request<Entity[]>("/api/entities");
  }

  async getEntity(entityId: string): Promise<Entity> {
    return this.request<Entity>(`/api/entities/${entityId}`);
  }

  async deleteEntity(entityId: string): Promise<{ status: string; entityId: string; message: string }> {
    return this.request(`/api/entities/${entityId}`, {
      method: "DELETE",
    });
  }

  // Add example from GitHub
  async addExample(request: {
    example_id: string;
    github_path: string;
    category: string;
  }): Promise<Entity> {
    return this.request<Entity>("/api/entities/add", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  // Type-specific entity getters for convenience
  async getAgents(): Promise<AgentInfo[]> {
    const entities = await this.getEntities();
    return entities.filter((e): e is AgentInfo => e.type === "agent");
  }

  async getOrchestrators(): Promise<OrchestratorInfo[]> {
    const entities = await this.getEntities();
    return entities.filter((e): e is OrchestratorInfo => e.type === "orchestrator");
  }

  async getWorkflows(): Promise<WorkflowInfo[]> {
    const entities = await this.getEntities();
    return entities.filter((e): e is WorkflowInfo => e.type === "workflow");
  }

  // Session management
  async getSessions(entityId?: string): Promise<SessionInfo[]> {
    const params = entityId ? `?entityId=${encodeURIComponent(entityId)}` : "";
    return this.request<SessionInfo[]>(`/api/sessions${params}`);
  }

  /**
   * Get or create a session for an entity.
   * Fetches existing sessions, returns most recent if found, creates new if none exist.
   */
  async getOrCreateSession(entityId: string, entityType: string = "agent"): Promise<SessionInfo> {
    const sessions = await this.getSessions(entityId);
    if (sessions.length > 0) {
      // Return most recent session (already sorted by lastActivity)
      return sessions[0];
    }
    // No sessions exist - create one
    return this.createSession(entityId, entityType);
  }

  async createSession(entityId: string, entityType: string = "agent"): Promise<SessionInfo> {
    return this.request<SessionInfo>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ entityId: entityId, entityType: entityType }),
    });
  }

  async getSession(sessionId: string): Promise<SessionInfo> {
    return this.request<SessionInfo>(`/api/sessions/${sessionId}`);
  }

  async getSessionMessages(sessionId: string): Promise<{
    sessionId: string;
    messages: any[];
  }> {
    return this.request(`/api/sessions/${sessionId}/messages`);
  }

  async deleteSession(sessionId: string): Promise<{ status: string; sessionId: string }> {
    return this.request(`/api/sessions/${sessionId}`, {
      method: "DELETE",
    });
  }

  // Entity execution - streaming
  async *streamEntityExecution(
    entityId: string,
    request: RunEntityRequest,
    abortSignal?: AbortSignal
  ): AsyncGenerator<StreamEvent, void, unknown> {
    const endpoint = `/api/entities/${entityId}/run/stream`;

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(request),
      signal: abortSignal, // Allow cancellation via AbortController
    });

    if (!response.ok) {
      throw new Error(`Streaming request failed: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Response body is not readable");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const wrappedEvent = JSON.parse(line.slice(6));

              // Backend sends: {sessionId, timestamp, event: <actual_event>}
              // We need to unwrap and normalize the event
              const innerEvent = wrappedEvent.event;

              // Determine event type and normalize
              let normalizedEvent: StreamEvent;

              if (innerEvent.role) {
                // It's a message
                normalizedEvent = {
                  type: "message",
                  data: innerEvent,
                  sessionId: wrappedEvent.sessionId,
                  timestamp: wrappedEvent.timestamp,
                };
              } else if (innerEvent.content !== undefined && innerEvent.isComplete !== undefined) {
                // It's a ChatCompletionChunk (token streaming)
                normalizedEvent = {
                  type: "token_chunk",
                  data: innerEvent,
                  sessionId: wrappedEvent.sessionId,
                  timestamp: wrappedEvent.timestamp,
                };
              } else if (innerEvent.eventType) {
                // It's an agent event
                normalizedEvent = {
                  type: innerEvent.eventType,
                  data: innerEvent,
                  sessionId: wrappedEvent.sessionId,
                  timestamp: wrappedEvent.timestamp,
                };
              } else if (innerEvent.messages && innerEvent.usage) {
                // It's an agent response (final result)
                normalizedEvent = {
                  type: "complete",
                  data: innerEvent,
                  sessionId: wrappedEvent.sessionId,
                  timestamp: wrappedEvent.timestamp,
                };
              } else {
                // Unknown type, pass through
                normalizedEvent = {
                  type: "unknown",
                  data: innerEvent,
                  sessionId: wrappedEvent.sessionId,
                  timestamp: wrappedEvent.timestamp,
                };
              }

              yield normalizedEvent;
            } catch (e) {
              console.error("Failed to parse SSE event:", e);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // Non-streaming execution (for testing/simple requests)
  async runEntity(
    entityId: string,
    request: RunEntityRequest
  ): Promise<any> {
    return this.request(`/api/entities/${entityId}/run`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  // Cache management
  async clearCache(): Promise<{ status: string }> {
    return this.request("/api/cache/clear", {
      method: "POST",
    });
  }

  // Statistics
  async getStats(): Promise<{
    entities: {
      total: number;
      byType: {
        agents: number;
        orchestrators: number;
        workflows: number;
      };
    };
    sessions: any;
  }> {
    return this.request("/api/stats");
  }
}

// Export singleton instance
export const apiClient = new ApiClient();
export { ApiClient };