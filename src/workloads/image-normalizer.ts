import { GatewayError } from '../http/error-response.js';

export interface ImageDto {
  index: number;
  dataUrl: string;
  mimeType: string;
  metadata?: Record<string, unknown>;
}

const extractParts = (response: Record<string, unknown>): Array<Record<string, unknown>> => {
  const candidates = response.candidates as Array<{ content?: { parts?: Array<Record<string, unknown>> } }> | undefined;
  return candidates?.[0]?.content?.parts ?? [];
};

export const normalizeInlineImages = (response: Record<string, unknown>, metadata?: Record<string, unknown>): ImageDto[] => {
  const images: ImageDto[] = [];
  for (const part of extractParts(response)) {
    const inlineData = part.inlineData as { data?: string; mimeType?: string } | undefined;
    if (inlineData?.data && inlineData.mimeType) {
      images.push({
        index: images.length,
        dataUrl: `data:${inlineData.mimeType};base64,${inlineData.data}`,
        mimeType: inlineData.mimeType,
        ...(metadata && { metadata }),
      });
    }
  }
  if (images.length === 0) {
    throw new GatewayError(502, 'IMAGE_NOT_RETURNED', 'Google response did not contain an inline image.');
  }
  return images;
};

export const extractText = (response: Record<string, unknown>): string => {
  const text = extractParts(response).map((part) => typeof part.text === 'string' ? part.text : '').join('').trim();
  if (!text) throw new GatewayError(502, 'IMAGE_NOT_RETURNED', 'Google response did not contain text.');
  return text;
};
