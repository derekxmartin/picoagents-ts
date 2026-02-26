/**
 * Termination conditions for orchestration.
 *
 * These operate on message streams (check(messages) → StopMessage | null)
 * and are used by orchestrators to decide when multi-agent coordination
 * should stop.
 *
 * Distinct from hooks.ts TerminationCondition which controls agent-loop restarts.
 */

export { BaseTermination, type StopMessage } from "./base.js";
export { MaxMessageTermination } from "./max-message.js";
export { TextMentionTermination } from "./text-mention.js";
export { TimeoutTermination } from "./timeout.js";
export { TokenUsageTermination } from "./token-usage.js";
export { CancellationTermination } from "./cancellation.js";
export { ExternalTermination } from "./external.js";
export { FunctionCallTermination } from "./function-call.js";
export { HandoffTermination } from "./handoff.js";
export { CompositeTermination } from "./composite.js";
