/**
 * MessageInput - Enhanced input with file upload and paste support
 */

import { useState, useRef } from "react";
import { Send } from "lucide-react";
import { Button } from "./button";
import { FileUpload } from "./file-upload";
import { AttachmentGallery, getFileType, readFileAsDataURL } from "./attachment-gallery";
import type { AttachmentItem } from "./attachment-gallery";
import { Textarea } from "./textarea";

interface MessageInputProps {
  onSendMessage: (text: string, attachments: AttachmentItem[]) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function MessageInput({
  onSendMessage,
  disabled = false,
  placeholder = "Type a message... (Enter to send, Shift+Enter for new line)",
  className = "",
}: MessageInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pasteNotification, setPasteNotification] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleFilesSelected = async (files: File[]) => {
    const newAttachments: AttachmentItem[] = [];

    for (const file of files) {
      const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const type = getFileType(file);

      let preview: string | undefined;
      if (type === "image") {
        try {
          preview = await readFileAsDataURL(file);
        } catch (error) {
          console.error("Failed to read image preview:", error);
        }
      }

      newAttachments.push({
        id,
        file,
        preview,
        type,
      });
    }

    setAttachments((prev) => [...prev, ...newAttachments]);
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
  };

  // Handle paste events for images and large text
  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const files: File[] = [];
    let hasProcessedText = false;
    const TEXT_THRESHOLD = 8000; // Convert to file if text is larger than this

    for (const item of items) {
      // Handle pasted images (screenshots)
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (blob) {
          const timestamp = Date.now();
          files.push(
            new File([blob], `screenshot-${timestamp}.png`, { type: blob.type })
          );
        }
      } else if (item.type === "text/plain" && !hasProcessedText) {
        // Handle large text
        const text = await new Promise<string>((resolve) => {
          item.getAsString(resolve);
        });

        if (text.length > TEXT_THRESHOLD) {
          e.preventDefault();
          hasProcessedText = true;

          // Detect file type from content
          const extension = detectFileExtension(text);
          const timestamp = Date.now();
          const filename = `pasted-text-${timestamp}.${extension}`;

          // Create file from text
          const textBlob = new Blob([text], { type: "text/plain" });
          files.push(new File([textBlob], filename, { type: "text/plain" }));

          // Clear the input since we're converting to file
          setInputValue("");
        }
      }
    }

    if (files.length > 0) {
      await handleFilesSelected(files);

      // Show notification
      const message =
        files.length === 1
          ? files[0].name.includes("screenshot")
            ? "Screenshot added as attachment"
            : "Large text converted to file"
          : `${files.length} files added`;

      setPasteNotification(message);
      setTimeout(() => setPasteNotification(null), 3000);
    }
  };

  // Detect file extension from content
  const detectFileExtension = (text: string): string => {
    const trimmed = text.trim();
    const lines = trimmed.split('\n');

    // JSON detection
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        JSON.parse(trimmed);
        return 'json';
      } catch {}
    }

    // CSV detection
    if (lines.length > 1 && lines[0].includes(',') &&
        lines.slice(0, 3).every(line => line.split(',').length === lines[0].split(',').length)) {
      return 'csv';
    }

    // Markdown detection
    if (trimmed.includes('# ') || trimmed.includes('## ') || trimmed.includes('```')) {
      return 'md';
    }

    return 'txt';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if ((!inputValue.trim() && attachments.length === 0) || isSubmitting || disabled) {
      return;
    }

    setIsSubmitting(true);

    try {
      await onSendMessage(inputValue.trim(), attachments);
      setInputValue("");
      setAttachments([]);
    } catch (error) {
      console.error("Failed to send message:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle keyboard shortcuts: Enter to send, Shift+Enter for newline
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as any);
    }
  };

  const canSendMessage = (inputValue.trim() || attachments.length > 0) && !isSubmitting && !disabled;

  return (
    <div className={`border-t flex-shrink-0 ${className}`}>
      <div className="p-4">
        {/* Paste notification */}
        {pasteNotification && (
          <div className="mb-2 p-2 bg-green-100 text-green-800 text-sm rounded-md">
            {pasteNotification}
          </div>
        )}

        {/* Attachment gallery */}
        {attachments.length > 0 && (
          <div className="mb-3">
            <AttachmentGallery
              attachments={attachments}
              onRemoveAttachment={handleRemoveAttachment}
            />
          </div>
        )}

        {/* Input form */}
        <form onSubmit={handleSubmit} className="flex gap-2">
          <div className="flex-1">
            <Textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={placeholder}
              disabled={isSubmitting || disabled}
              className="min-h-[40px] max-h-32 resize-none"
              rows={1}
            />
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <FileUpload
              onFilesSelected={handleFilesSelected}
              disabled={isSubmitting || disabled}
              className="shrink-0"
            />

            <Button
              type="submit"
              size="icon"
              disabled={!canSendMessage}
              className="shrink-0 h-[40px]"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}