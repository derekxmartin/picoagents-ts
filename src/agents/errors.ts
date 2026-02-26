/**
 * Agent-related error classes.
 */

export class AgentError extends Error {
  agentName?: string;

  constructor(message: string, agentName?: string) {
    super(message);
    this.name = "AgentError";
    this.agentName = agentName;
  }

  override toString(): string {
    if (this.agentName) {
      return `Agent '${this.agentName}': ${this.message}`;
    }
    return this.message;
  }
}

export class AgentExecutionError extends AgentError {
  constructor(message: string, agentName?: string) {
    super(message, agentName);
    this.name = "AgentExecutionError";
  }
}

export class AgentConfigurationError extends AgentError {
  constructor(message: string, agentName?: string) {
    super(message, agentName);
    this.name = "AgentConfigurationError";
  }
}

export class AgentToolError extends AgentError {
  constructor(message: string, agentName?: string) {
    super(message, agentName);
    this.name = "AgentToolError";
  }
}

export class AgentMemoryError extends AgentError {
  constructor(message: string, agentName?: string) {
    super(message, agentName);
    this.name = "AgentMemoryError";
  }
}

export class AgentTimeoutError extends AgentError {
  constructor(message: string, agentName?: string) {
    super(message, agentName);
    this.name = "AgentTimeoutError";
  }
}
