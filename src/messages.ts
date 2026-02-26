/**
 * Core message types for agent communication using Zod schemas.
 *
 * This module defines the structured message types that agents use to communicate
 * with each other and with LLMs, following the OpenAI API format.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// ToolCallRequest
// ---------------------------------------------------------------------------

export const ToolCallRequestSchema = z.object({
  toolName: z.string().describe("Name of the tool to call"),
  parameters: z
    .record(z.string(), z.unknown())
    .describe("Arguments for the tool"),
  callId: z.string().describe("Unique identifier for this call"),
});

export type ToolCallRequest = z.infer<typeof ToolCallRequestSchema>;

// ---------------------------------------------------------------------------
// Base fields shared by all messages
// ---------------------------------------------------------------------------

const baseMessageFields = {
  content: z.string().describe("The message content"),
  source: z
    .string()
    .describe("Source of the message (agent name, system, user, etc.)"),
  timestamp: z
    .date()
    .default(() => new Date())
    .describe("When the message was created"),
};

// ---------------------------------------------------------------------------
// SystemMessage
// ---------------------------------------------------------------------------

export const SystemMessageSchema = z.object({
  ...baseMessageFields,
  role: z.literal("system").default("system"),
});

export type SystemMessage = z.infer<typeof SystemMessageSchema>;

// ---------------------------------------------------------------------------
// UserMessage
// ---------------------------------------------------------------------------

export const UserMessageSchema = z.object({
  ...baseMessageFields,
  role: z.literal("user").default("user"),
  name: z.string().optional().describe("Optional name of the user"),
});

export type UserMessage = z.infer<typeof UserMessageSchema>;

// ---------------------------------------------------------------------------
// AssistantMessage
// ---------------------------------------------------------------------------

export const AssistantMessageSchema = z.object({
  ...baseMessageFields,
  role: z.literal("assistant").default("assistant"),
  toolCalls: z
    .array(ToolCallRequestSchema)
    .optional()
    .describe("Tool calls made by the assistant"),
  structuredContent: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Structured data when output_format is used"),
  usage: z
    .any()
    .optional()
    .describe("Token usage for this LLM call (Usage type, resolved later)"),
});

export type AssistantMessage = z.infer<typeof AssistantMessageSchema>;

// ---------------------------------------------------------------------------
// ToolMessage
// ---------------------------------------------------------------------------

export const ToolMessageSchema = z.object({
  ...baseMessageFields,
  role: z.literal("tool").default("tool"),
  toolCallId: z
    .string()
    .describe("ID of the tool call this is responding to"),
  toolName: z.string().describe("Name of the tool that was executed"),
  success: z.boolean().describe("Whether tool execution succeeded"),
  error: z.string().optional().describe("Error message if failed"),
});

export type ToolMessage = z.infer<typeof ToolMessageSchema>;

// ---------------------------------------------------------------------------
// MultiModalMessage
// ---------------------------------------------------------------------------

export const MultiModalMessageSchema = z
  .object({
    ...baseMessageFields,
    role: z.enum(["user", "assistant"]).describe("Message role"),
    mimeType: z
      .string()
      .describe(
        "MIME type of the content (e.g., 'text/plain', 'image/jpeg', 'audio/wav')"
      ),
    data: z
      .union([z.string(), z.instanceof(Uint8Array)])
      .optional()
      .describe("Binary data or base64 string for the content"),
    mediaUrl: z
      .string()
      .optional()
      .describe("URL to media content if data is not provided"),
    metadata: z
      .record(z.string(), z.unknown())
      .default({})
      .describe("Additional content metadata"),
  })
  .refine((msg) => msg.data !== undefined || msg.mediaUrl !== undefined, {
    message: "Either 'data' or 'mediaUrl' must be provided",
  })
  .refine(
    (msg) => !(msg.data !== undefined && msg.mediaUrl !== undefined),
    {
      message: "Only one of 'data' or 'mediaUrl' should be provided",
    }
  );

export type MultiModalMessage = z.infer<typeof MultiModalMessageSchema>;

// ---------------------------------------------------------------------------
// MultiModalMessage helpers
// ---------------------------------------------------------------------------

export function isText(msg: MultiModalMessage): boolean {
  return msg.mimeType.startsWith("text/");
}

export function isImage(msg: MultiModalMessage): boolean {
  return msg.mimeType.startsWith("image/");
}

export function isAudio(msg: MultiModalMessage): boolean {
  return msg.mimeType.startsWith("audio/");
}

export function isVideo(msg: MultiModalMessage): boolean {
  return msg.mimeType.startsWith("video/");
}

export function toBase64(msg: MultiModalMessage): string | undefined {
  if (msg.data === undefined) return undefined;
  if (typeof msg.data === "string") return msg.data;
  // Convert Uint8Array to base64
  return Buffer.from(msg.data).toString("base64");
}

// ---------------------------------------------------------------------------
// Union type for all messages
// ---------------------------------------------------------------------------

export type Message =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolMessage
  | MultiModalMessage;

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function formatMessage(msg: Message): string {
  const time = msg.timestamp.toLocaleTimeString("en-US", { hour12: false });

  if (msg.role === "assistant" && "toolCalls" in msg && msg.toolCalls?.length) {
    const toolInfo = msg.toolCalls
      .map(
        (tc) =>
          `${tc.toolName}(${Object.entries(tc.parameters)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")})`
      )
      .join(", ");
    if (msg.content?.trim()) {
      return `[${msg.source}] ${time} | ${msg.content} [tools: ${toolInfo}]`;
    }
    return `[${msg.source}] ${time} | [calling tools: ${toolInfo}]`;
  }

  return `[${msg.source}] ${time} | ${msg.content}`;
}
