/**
 * Context compaction strategies for PicoAgents.
 *
 * Provides strategies for managing context/message history during
 * long-running agent sessions. Strategies are called BEFORE each LLM call
 * in the tool loop.
 *
 * Key insight: compaction happens INSIDE the tool loop with reassignment
 * `messages = strategy.compact(messages)`, ensuring compacted lists are
 * used for subsequent iterations.
 */

import type { Message, AssistantMessage, ToolMessage } from "./messages.js";

// ---------------------------------------------------------------------------
// CompactionStrategy interface
// ---------------------------------------------------------------------------

/**
 * Interface for context compaction strategies.
 *
 * Important: Implementations must preserve "atomic groups" — assistant
 * messages with toolCalls must stay with their corresponding ToolMessage results.
 */
export interface CompactionStrategy {
  compact(messages: Message[]): Message[];
}

// ---------------------------------------------------------------------------
// NoCompaction
// ---------------------------------------------------------------------------

/**
 * Baseline: no compaction, context grows unbounded.
 *
 * Use for benchmarking or short tasks where context limits won't be hit.
 */
export class NoCompaction implements CompactionStrategy {
  compact(messages: Message[]): Message[] {
    return messages;
  }
}

// ---------------------------------------------------------------------------
// Token counting helpers (char-based fallback)
// ---------------------------------------------------------------------------

function countTokensEstimate(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    // ~4 chars per token + message overhead
    total += 4; // role overhead
    const content = msg.content ?? "";
    total += Math.ceil(content.length / 4);

    // Count tool calls if present
    if (msg.role === "assistant" && "toolCalls" in msg) {
      const am = msg as AssistantMessage;
      if (am.toolCalls) {
        for (const tc of am.toolCalls) {
          total += 4; // overhead
          total += Math.ceil(tc.toolName.length / 4);
          total += Math.ceil(
            JSON.stringify(tc.parameters).length / 4
          );
        }
      }
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// Atomic group detection
// ---------------------------------------------------------------------------

function findAtomicGroups(messages: Message[]): number[][] {
  const groups: number[][] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    if (
      msg.role === "assistant" &&
      "toolCalls" in msg &&
      (msg as AssistantMessage).toolCalls
    ) {
      const am = msg as AssistantMessage;
      const callIds = new Set(am.toolCalls!.map((tc) => tc.callId));
      const groupIndices = [i];

      // Look ahead for tool results
      let j = i + 1;
      while (j < messages.length && callIds.size > 0) {
        if (
          messages[j].role === "tool" &&
          "toolCallId" in messages[j]
        ) {
          const tm = messages[j] as ToolMessage;
          if (callIds.has(tm.toolCallId)) {
            groupIndices.push(j);
            callIds.delete(tm.toolCallId);
          }
        }
        j++;
      }

      groups.push(groupIndices);
      i =
        groupIndices.length > 0
          ? Math.max(...groupIndices) + 1
          : i + 1;
    } else {
      groups.push([i]);
      i++;
    }
  }

  return groups;
}

// ---------------------------------------------------------------------------
// HeadTailCompaction
// ---------------------------------------------------------------------------

/**
 * Token-aware head+tail compaction strategy.
 *
 * Preserves:
 * - Head: System prompt, initial user message (critical context)
 * - Tail: Recent tool calls and results (working memory)
 *
 * Drops middle messages when over budget, respecting atomic groups.
 */
export class HeadTailCompaction implements CompactionStrategy {
  tokenBudget: number;
  headRatio: number;

  // Statistics
  compactionCount = 0;
  totalTokensSaved = 0;

  constructor(tokenBudget = 100_000, headRatio = 0.2) {
    this.tokenBudget = tokenBudget;
    this.headRatio = headRatio;
  }

  compact(messages: Message[]): Message[] {
    if (messages.length === 0) return messages;

    const currentTokens = countTokensEstimate(messages);
    if (currentTokens <= this.tokenBudget) return messages;

    // COMPACTION NEEDED
    this.compactionCount += 1;

    const groups = findAtomicGroups(messages);
    const headBudget = Math.floor(this.tokenBudget * this.headRatio);
    const tailBudget = this.tokenBudget - headBudget;

    // Fill head from start
    const headGroups: number[][] = [];
    let headTokens = 0;

    for (const group of groups) {
      const groupMsgs = group.map((i) => messages[i]);
      const groupTokens = countTokensEstimate(groupMsgs);

      if (headTokens + groupTokens <= headBudget) {
        headGroups.push(group);
        headTokens += groupTokens;
      } else {
        break;
      }
    }

    // Fill tail from end (skip head groups)
    const remaining = groups.slice(headGroups.length);
    const tailGroups: number[][] = [];
    let tailTokens = 0;

    for (let k = remaining.length - 1; k >= 0; k--) {
      const group = remaining[k];
      const groupMsgs = group.map((i) => messages[i]);
      const groupTokens = countTokensEstimate(groupMsgs);

      if (tailTokens + groupTokens <= tailBudget) {
        tailGroups.unshift(group);
        tailTokens += groupTokens;
      } else {
        break;
      }
    }

    // Build compacted list
    const keptIndices = new Set<number>();
    for (const group of [...headGroups, ...tailGroups]) {
      for (const idx of group) keptIndices.add(idx);
    }

    const compacted = [...keptIndices]
      .sort((a, b) => a - b)
      .map((i) => messages[i]);

    // Track savings
    const compactedTokens = countTokensEstimate(compacted);
    this.totalTokensSaved += currentTokens - compactedTokens;

    return compacted;
  }
}

// ---------------------------------------------------------------------------
// SlidingWindowCompaction
// ---------------------------------------------------------------------------

/**
 * Keep only recent messages within budget.
 *
 * Always preserves the system message (if present) plus the most
 * recent messages that fit. Respects atomic groups.
 */
export class SlidingWindowCompaction implements CompactionStrategy {
  tokenBudget: number;

  compactionCount = 0;
  totalTokensSaved = 0;

  constructor(tokenBudget = 100_000) {
    this.tokenBudget = tokenBudget;
  }

  compact(messages: Message[]): Message[] {
    if (messages.length === 0) return messages;

    const currentTokens = countTokensEstimate(messages);
    if (currentTokens <= this.tokenBudget) return messages;

    // COMPACTION NEEDED
    this.compactionCount += 1;

    const groups = findAtomicGroups(messages);

    // Always keep system message if present
    const systemGroups: number[][] = [];
    let systemTokens = 0;
    let startIdx = 0;

    if (
      groups.length > 0 &&
      messages[groups[0][0]].role === "system"
    ) {
      systemGroups.push(groups[0]);
      systemTokens = countTokensEstimate(
        groups[0].map((i) => messages[i])
      );
      startIdx = 1;
    }

    const remaining = groups.slice(startIdx);
    const remainingBudget = this.tokenBudget - systemTokens;
    const keptGroups: number[][] = [];
    let keptTokens = 0;

    for (let k = remaining.length - 1; k >= 0; k--) {
      const group = remaining[k];
      const groupMsgs = group.map((i) => messages[i]);
      const groupTokens = countTokensEstimate(groupMsgs);

      if (keptTokens + groupTokens <= remainingBudget) {
        keptGroups.unshift(group);
        keptTokens += groupTokens;
      } else {
        break;
      }
    }

    const keptIndices = new Set<number>();
    for (const group of [...systemGroups, ...keptGroups]) {
      for (const idx of group) keptIndices.add(idx);
    }

    const compacted = [...keptIndices]
      .sort((a, b) => a - b)
      .map((i) => messages[i]);

    const compactedTokens = countTokensEstimate(compacted);
    this.totalTokensSaved += currentTokens - compactedTokens;

    return compacted;
  }
}
