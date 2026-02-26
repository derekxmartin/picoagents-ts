/**
 * Quick test script for the OpenAI client.
 *
 * Prompts for your API key, then sends a single request using GPT-4.1-mini.
 *
 * Usage:
 *   npx tsx examples/test-openai.ts
 */

import * as readline from "node:readline/promises";
import { OpenAIChatCompletionClient } from "../src/llm/openai.js";
import type { Message } from "../src/messages.js";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const apiKey = await rl.question("Enter your OpenAI API key: ");
rl.close();

const client = new OpenAIChatCompletionClient({
  model: "gpt-4.1-mini",
  apiKey,
});

const messages: Message[] = [
  { role: "user", content: "Write a bad joke about rap music", source: "user", timestamp: new Date() },
];

console.log("\nSending request to GPT-4.1-mini...\n");

const result = await client.create(messages);

console.log("Response:", result.message.content);
console.log("\n--- Usage ---");
console.log(`Tokens: ${result.usage.tokensInput} in / ${result.usage.tokensOutput} out`);
console.log(`Cost: $${result.usage.costEstimate?.toFixed(6)}`);
console.log(`Duration: ${result.usage.durationMs}ms`);
