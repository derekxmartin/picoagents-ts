/**
 * Types for message rendering components
 * Aligned with PicoAgents message types
 */

import type { Message, MultiModalMessage } from "@/types";

export interface RenderProps {
  message: Message;
  isStreaming?: boolean;
  className?: string;
}

export interface MultiModalRenderProps {
  message: MultiModalMessage;
  isStreaming?: boolean;
  className?: string;
}

export interface MessageRendererProps {
  message: Message;
  isStreaming?: boolean;
  className?: string;
}