/**
 * Utility functions for working with PicoAgents messages
 * Including conversion between frontend file uploads and MultiModalMessage format
 */

import type {
  Message,
  MultiModalMessage,
} from '@/types';

/**
 * Convert a File object to base64 data URI
 */
export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Extract just the base64 part (remove data:mime;base64, prefix)
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Create a MultiModalMessage from a file upload and text
 */
export async function createMultiModalMessage(
  text: string,
  file: File,
  source: string = "user"
): Promise<MultiModalMessage> {
  const base64Data = await fileToBase64(file);

  const message: MultiModalMessage = {
    role: "user",
    content: text || `Uploaded ${file.type} file: ${file.name}`,
    source: source,
    mimeType: file.type || "application/octet-stream",
    data: base64Data,
    metadata: {
      filename: file.name,
      size: file.size,
      lastModified: file.lastModified
    }
  };

  return message;
}

/**
 * Create a MultiModalMessage with a media URL instead of embedded data
 */
export function createMultiModalMessageWithUrl(
  text: string,
  mediaUrl: string,
  mimeType: string,
  source: string = "user"
): MultiModalMessage {
  const message: MultiModalMessage = {
    role: "user",
    content: text,
    source: source,
    mimeType: mimeType,
    media_url: mediaUrl,
    metadata: {
      url: mediaUrl
    }
  };

  return message;
}

/**
 * Example: Send an image with a question
 */
export async function sendImageWithQuestion(
  imageFile: File,
  question: string
): Promise<MultiModalMessage> {
  // Validate it's an image
  if (!imageFile.type.startsWith('image/')) {
    throw new Error('File must be an image');
  }

  return createMultiModalMessage(
    question || "What's in this image?",
    imageFile
  );
}

/**
 * Example: Send a PDF for analysis
 */
export async function sendPdfForAnalysis(
  pdfFile: File,
  instructions: string
): Promise<MultiModalMessage> {
  // Validate it's a PDF
  if (pdfFile.type !== 'application/pdf') {
    throw new Error('File must be a PDF');
  }

  return createMultiModalMessage(
    instructions || "Please analyze this PDF document.",
    pdfFile
  );
}

/**
 * Check if a message has multimodal content
 */
export function hasMultiModalContent(msg: Message): boolean {
  return 'mimeType' in msg;
}

/**
 * Get display text for a multimodal message
 */
export function getMultiModalDisplayText(msg: MultiModalMessage): string {
  const typeLabel = msg.mimeType.startsWith('image/') ? 'Image' :
                   msg.mimeType.startsWith('audio/') ? 'Audio' :
                   msg.mimeType.startsWith('video/') ? 'Video' :
                   msg.mimeType === 'application/pdf' ? 'PDF' :
                   'File';

  const filename = msg.metadata?.filename || 'unnamed';
  return `[${typeLabel}: ${filename}] ${msg.content}`;
}

/**
 * Example usage in a component:
 *
 * const handleFileUpload = async (file: File, textMessage: string) => {
 *   try {
 *     const multiModalMsg = await createMultiModalMessage(textMessage, file, "user");
 *
 *     // Send to backend
 *     const response = await apiClient.runEntity(agentId, {
 *       messages: [...previousMessages, multiModalMsg]
 *     });
 *   } catch (error) {
 *     console.error('Failed to send multimodal message:', error);
 *   }
 * };
 */