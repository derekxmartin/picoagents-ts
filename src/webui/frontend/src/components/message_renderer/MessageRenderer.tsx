/**
 * MessageRenderer - Main orchestrator for rendering messages
 */

import { ContentRenderer } from "./ContentRenderer";
import type { MessageRendererProps } from "./types";

export function MessageRenderer({
  message,
  isStreaming = false,
  className,
}: MessageRendererProps) {
  return (
    <ContentRenderer
      message={message}
      isStreaming={isStreaming}
      className={className}
    />
  );
}