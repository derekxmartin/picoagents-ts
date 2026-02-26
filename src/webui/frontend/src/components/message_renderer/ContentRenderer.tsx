/**
 * ContentRenderer - Renders different content types based on message type
 */

import { useState } from "react";
import {
  Download,
  FileText,
  AlertCircle,
  Code,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  AssistantMessage,
  ToolMessage,
} from "@/types";
import {
  isMultiModalMessage,
  isAssistantMessage,
  isToolMessage
} from "@/types";
import type { RenderProps, MultiModalRenderProps } from "./types";

function TextContentRenderer({ message, isStreaming, className }: RenderProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const content = message.content;
  const TRUNCATE_LENGTH = 1600;
  const shouldTruncate = content.length > TRUNCATE_LENGTH && !isStreaming;
  const displayText = shouldTruncate && !isExpanded
    ? content.slice(0, TRUNCATE_LENGTH) + "..."
    : content;

  return (
    <div className={`whitespace-pre-wrap break-words ${className || ""}`}>
      <div className={isExpanded && shouldTruncate ? "max-h-96 overflow-y-auto" : ""}>
        {displayText}
      </div>
      {isStreaming && (
        <span className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-current" />
      )}
      {shouldTruncate && (
        <div className="flex justify-end mt-1">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="inline-flex items-center gap-1 text-xs
                       bg-background/80 hover:bg-background border border-border/50 hover:border-border
                       text-muted-foreground hover:text-foreground
                       transition-colors cursor-pointer px-2 py-1 rounded"
          >
            {isExpanded ? (
              <>
                less <ChevronUp className="h-3 w-3" />
              </>
            ) : (
              <>
                {(content.length - TRUNCATE_LENGTH).toLocaleString()} more{" "}
                <ChevronDown className="h-3 w-3" />
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

function MultiModalContentRenderer({ message, className }: MultiModalRenderProps) {
  const [imageError, setImageError] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const isImage = message.mimeType.startsWith("image/");
  const isPdf = message.mimeType === "application/pdf";
  const isAudio = message.mimeType.startsWith("audio/");
  const isVideo = message.mimeType.startsWith("video/");

  // Create data URI if we have base64 data
  const dataUri = message.data
    ? `data:${message.mimeType};base64,${message.data}`
    : message.media_url;

  const filename = message.metadata?.filename || "attachment";

  if (isImage && dataUri && !imageError) {
    return (
      <div className={`my-2 ${className || ""}`}>
        <img
          src={dataUri}
          alt={filename}
          className={`rounded-lg border max-w-full transition-all cursor-pointer ${
            isExpanded ? "max-h-none" : "max-h-64"
          }`}
          onClick={() => setIsExpanded(!isExpanded)}
          onError={() => setImageError(true)}
        />
        <div className="text-xs text-muted-foreground mt-1">
          {message.mimeType} • {filename} • Click to {isExpanded ? "collapse" : "expand"}
        </div>
        {message.content && (
          <div className="mt-2 text-sm">{message.content}</div>
        )}
      </div>
    );
  }

  // Fallback for non-images or failed images
  return (
    <div className={`my-2 p-3 border rounded-lg bg-muted ${className || ""}`}>
      <div className="flex items-center gap-2">
        {isPdf ? (
          <FileText className="h-4 w-4 text-red-500" />
        ) : isAudio ? (
          <div className="h-4 w-4 rounded-full bg-green-500" />
        ) : isVideo ? (
          <div className="h-4 w-4 rounded-sm bg-blue-500" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        <span className="text-sm font-medium">
          {isPdf ? "PDF Document" :
           isAudio ? "Audio File" :
           isVideo ? "Video File" :
           "File Attachment"}
        </span>
        <span className="text-xs text-muted-foreground">({message.mimeType})</span>
      </div>

      {message.content && (
        <div className="mt-2 text-sm">{message.content}</div>
      )}

      {dataUri && (
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => {
            const link = document.createElement("a");
            link.href = dataUri;
            link.download = filename;
            link.click();
          }}
        >
          <Download className="h-3 w-3 mr-1" />
          Download {filename}
        </Button>
      )}
    </div>
  );
}

function ToolCallRenderer({ message }: { message: AssistantMessage; className?: string }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!message.toolCalls || message.toolCalls.length === 0) return null;

  return (
    <div className="my-2 space-y-2">
      {message.toolCalls.map((toolCall, index) => {
        let parsedParams;
        try {
          parsedParams = typeof toolCall.parameters === "string"
            ? JSON.parse(toolCall.parameters)
            : toolCall.parameters;
        } catch {
          parsedParams = toolCall.parameters;
        }

        return (
          <div key={index} className="p-3 border rounded-lg bg-blue-50">
            <div
              className="flex items-center gap-2 cursor-pointer"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              <Code className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-medium text-blue-800">
                Tool Call: {toolCall.toolName}
              </span>
              <span className="text-xs text-blue-600">{isExpanded ? "▼" : "▶"}</span>
            </div>
            {isExpanded && (
              <div className="mt-2 text-xs font-mono bg-white p-2 rounded border">
                <div className="text-blue-600 mb-1">Parameters:</div>
                <pre className="whitespace-pre-wrap">
                  {JSON.stringify(parsedParams, null, 2)}
                </pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ToolResultRenderer({ message, className }: { message: ToolMessage; className?: string }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className={`my-2 p-3 border rounded-lg ${message.success ? 'bg-green-50' : 'bg-red-50'} ${className || ""}`}>
      <div
        className="flex items-center gap-2 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {message.success ? (
          <Code className="h-4 w-4 text-green-600" />
        ) : (
          <AlertCircle className="h-4 w-4 text-red-600" />
        )}
        <span className={`text-sm font-medium ${message.success ? 'text-green-800' : 'text-red-800'}`}>
          Tool Result: {message.toolName} {message.success ? '✓' : '✗'}
        </span>
        <span className={`text-xs ${message.success ? 'text-green-600' : 'text-red-600'}`}>
          {isExpanded ? "▼" : "▶"}
        </span>
      </div>
      {isExpanded && (
        <div className="mt-2 text-xs font-mono bg-white p-2 rounded border">
          {message.error ? (
            <div className="text-red-700">Error: {message.error}</div>
          ) : (
            <pre className="whitespace-pre-wrap">{message.content}</pre>
          )}
        </div>
      )}
    </div>
  );
}

export function ContentRenderer({ message, isStreaming, className }: RenderProps) {
  // Handle MultiModalMessage
  if (isMultiModalMessage(message)) {
    return (
      <div>
        <MultiModalContentRenderer
          message={message}
          isStreaming={isStreaming}
          className={className}
        />
      </div>
    );
  }

  // Handle AssistantMessage with tool calls
  if (isAssistantMessage(message) && message.toolCalls) {
    return (
      <div>
        {message.content && (
          <TextContentRenderer
            message={message}
            isStreaming={isStreaming}
            className={className}
          />
        )}
        <ToolCallRenderer message={message} className={className} />
      </div>
    );
  }

  // Handle ToolMessage
  if (isToolMessage(message)) {
    return <ToolResultRenderer message={message} className={className} />;
  }

  // Default: render as text
  return (
    <TextContentRenderer
      message={message}
      isStreaming={isStreaming}
      className={className}
    />
  );
}