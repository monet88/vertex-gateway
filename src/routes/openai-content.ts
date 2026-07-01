import { parseImageDataUrl } from '../lib/image-data-url.js';

/**
 * Per-surface policy for translating one OpenAI content item. The iteration,
 * string/array handling, and data-URL parsing live in the shared translator
 * below; each OpenAI surface only supplies these small decisions, which differ
 * in accepted text/image type tags, `image_url` shape, the invalid-image
 * message, and whether an unrecognized item is skipped or rejected.
 */
export interface OpenAiContentPolicy {
  /** Returns the text payload for a text item, or null when the item is not text. */
  textOf(item: Record<string, unknown>): string | null;
  /**
   * Returns the image URL for an image item, or null when the item is not an
   * image. Called only when images are allowed for the current message role.
   */
  imageUrlOf(item: Record<string, unknown>): string | null;
  /** Message surfaced when an image URL is not a supported data URL. */
  invalidImageMessage: string;
  /** Handles an item that is neither text nor a permitted image (skip or throw). */
  onUnsupported(item: Record<string, unknown>): void;
  /** Optional pattern to restrict accepted image data URL MIME types. */
  allowedImageMimePattern?: RegExp;
}

/**
 * Shared OpenAI-content to Gemini-parts translator. Deep: callers exercise the
 * full string/array/data-URL behaviour through a single call plus a small
 * policy, so a change to parsing or iteration is fixed in one place.
 */
export const openAiContentToGeminiParts = (
  content: unknown,
  allowImages: boolean,
  policy: OpenAiContentPolicy,
): Array<Record<string, unknown>> => {
  if (typeof content === 'string') {
    return content ? [{ text: content }] : [];
  }
  if (!Array.isArray(content)) {
    policy.onUnsupported((content ?? {}) as Record<string, unknown>);
    return [];
  }

  const parts: Array<Record<string, unknown>> = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') {
      policy.onUnsupported((item ?? {}) as Record<string, unknown>);
      continue;
    }
    const typedItem = item as Record<string, unknown>;

    const text = policy.textOf(typedItem);
    if (text !== null) {
      parts.push({ text });
      continue;
    }

    const imageUrl = allowImages ? policy.imageUrlOf(typedItem) : null;
    if (imageUrl !== null) {
      const dataUrl = parseImageDataUrl(imageUrl.trim(), policy.invalidImageMessage, {
        allowedMimePattern: policy.allowedImageMimePattern,
        lowercaseMimeType: true,
      });
      parts.push({
        inlineData: {
          mimeType: dataUrl.mimeType,
          data: dataUrl.data,
        },
      });
      continue;
    }

    policy.onUnsupported(typedItem);
  }
  return parts;
};
