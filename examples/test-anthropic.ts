/**
 * Quick test script for the Anthropic client.
 *
 * Prompts for your API key, then sends a single request using Claude Haiku.
 *
 * Usage:
 *   npx tsx examples/test-anthropic.ts
 */

import * as readline from "node:readline/promises";
import { AnthropicChatCompletionClient } from "../src/llm/anthropic.js";
import type { Message } from "../src/messages.js";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const apiKey = await rl.question("Enter your Anthropic API key: ");
rl.close();

const client = new AnthropicChatCompletionClient({
  model: "claude-haiku-4-5-20251001",
  apiKey,
});

const messages: Message[] = [
  { role: "user", content: "Write a bad joke about rap music", source: "user", timestamp: new Date() },
];

console.log("\nSending request to Claude Haiku...\n");

const result = await client.create(messages);

console.log("Response:", result.message.content);
console.log("\n--- Usage ---");
console.log(`Tokens: ${result.usage.tokensInput} in / ${result.usage.tokensOutput} out`);
console.log(`Cost: $${result.usage.costEstimate?.toFixed(6)}`);
console.log(`Duration: ${result.usage.durationMs}ms`);
