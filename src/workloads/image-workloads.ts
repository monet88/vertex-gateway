import type { GatewayConfig } from '../config/env.js';
import { GatewayError } from '../http/error-response.js';
import { Semaphore } from '../lib/concurrency.js';
import type { GenAiClient } from '../lib/google-genai-client.js';
import { withGenAiRequestMetadata } from '../lib/genai-request-metadata.js';
import { retryWithJitter } from '../lib/retry.js';
import { withTimeout } from '../lib/timeout.js';
import { extractText, normalizeInlineImages, type ImageDto } from './image-normalizer.js';

interface ImageInput {
  mimeType: string;
  data: string;
}

const defaultGenerateModel = 'gemini-3.1-flash-image-preview';
const defaultImageModel = 'gemini-3.1-flash-image-preview';

const assertString = (body: Record<string, unknown>, key: string): string => {
  const value = body[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new GatewayError(400, 'VALIDATION_FAILED', `${key} is required.`);
  }
  return value.trim();
};

const decodedBytes = (base64: string): number => Math.ceil(base64.length * 0.75);

const validateImages = (images: unknown, config: GatewayConfig): ImageInput[] => {
  if (!Array.isArray(images) || images.length === 0) throw new GatewayError(400, 'VALIDATION_FAILED', 'images is required.');
  if (images.length > config.maxImages) throw new GatewayError(413, 'PAYLOAD_TOO_LARGE', 'Too many input images.');
  return images.map((image) => {
    if (!image || typeof image !== 'object') {
      throw new GatewayError(400, 'VALIDATION_FAILED', 'Each image must be an object.');
    }
    const candidate = image as Partial<ImageInput>;
    if (typeof candidate.mimeType !== 'string' || !/^image\/(png|jpeg|jpg|webp)$/.test(candidate.mimeType)) {
      throw new GatewayError(400, 'VALIDATION_FAILED', 'Unsupported image mimeType.');
    }
    if (typeof candidate.data !== 'string' || decodedBytes(candidate.data) > config.maxDecodedImageBytes) {
      throw new GatewayError(413, 'PAYLOAD_TOO_LARGE', 'Image payload exceeds decoded byte limit.');
    }
    return { mimeType: candidate.mimeType, data: candidate.data };
  });
};

const buildImageParts = (images: ImageInput[]) => images.map((image) => ({
  inlineData: { mimeType: image.mimeType, data: image.data },
}));

const parseNumberOfImages = (value: unknown, maxImages: number): number => {
  const numberOfImages = Math.min(Number(value ?? 1), maxImages);
  if (!Number.isInteger(numberOfImages) || numberOfImages < 1) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'numberOfImages must be between 1 and maxImages.');
  }
  return numberOfImages;
};

const buildImageConfig = (body: Record<string, unknown>): { aspectRatio?: string; imageSize?: string } => {
  const imageConfig: { aspectRatio?: string; imageSize?: string } = {};
  if (typeof body.aspectRatio === 'string' && body.aspectRatio !== 'Default') {
    imageConfig.aspectRatio = body.aspectRatio;
  }
  if (typeof body.resolution === 'string' && body.resolution.trim() !== '') {
    imageConfig.imageSize = body.resolution;
  }
  return imageConfig;
};

export class ImageWorkloads {
  private readonly semaphore: Semaphore;

  constructor(private readonly ai: GenAiClient, private readonly config: GatewayConfig) {
    this.semaphore = new Semaphore(config.upstreamConcurrency);
  }

  async generate(body: Record<string, unknown>, requestId?: string): Promise<{ images: ImageDto[] }> {
    const prompt = assertString(body, 'prompt');
    const model = typeof body.model === 'string' ? body.model : defaultGenerateModel;
    const aspectRatio = typeof body.aspectRatio === 'string' && body.aspectRatio !== 'Default' ? body.aspectRatio : '1:1';
    const numberOfImages = parseNumberOfImages(body.numberOfImages, this.config.maxImages);
    const results = await Promise.all(Array.from({ length: numberOfImages }, async (_, index) => {
      const response = await this.safeGenerate(() => this.ai.models.generateContent(withGenAiRequestMetadata({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio } },
      }, { routeFamily: 'images', requestId })));
      return normalizeInlineImages(response, { model, requestedIndex: index });
    }));
    const images = results.flat();
    return { images: images.map((image, index) => ({ ...image, index })) };
  }

  async edit(body: Record<string, unknown>, requestId?: string): Promise<{ images: ImageDto[] }> {
    const prompt = assertString(body, 'prompt');
    const images = validateImages(body.images, this.config);
    const model = typeof body.model === 'string' ? body.model : defaultImageModel;
    const numberOfImages = parseNumberOfImages(body.numberOfImages, this.config.maxImages);
    const imageConfig = buildImageConfig(body);
    const results = await Promise.all(Array.from({ length: numberOfImages }, async (_, index) => {
      // Gemini image editing expects the instruction text before the reference images.
      const response = await this.safeGenerate(() => this.ai.models.generateContent(withGenAiRequestMetadata({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }, ...buildImageParts(images)] }],
        config: {
          responseModalities: ['IMAGE'],
          ...(Object.keys(imageConfig).length > 0 && { imageConfig }),
        },
      }, { routeFamily: 'images', requestId })));
      return normalizeInlineImages(response, { model, requestedIndex: index });
    }));
    const outputImages = results.flat();
    return { images: outputImages.map((image, index) => ({ ...image, index })) };
  }

  async upscale(body: Record<string, unknown>, requestId?: string): Promise<{ images: ImageDto[] }> {
    const image = validateImages([body.image], this.config);
    const quality = typeof body.quality === 'string' ? body.quality : '2K';
    const model = typeof body.model === 'string' ? body.model : defaultImageModel;
    const response = await this.safeGenerate(() => this.ai.models.generateContent(withGenAiRequestMetadata({
      model,
      contents: [{ role: 'user', parts: [...buildImageParts(image), { text: `Upscale this image to ${quality}. Preserve the original subject and composition.` }] }],
      config: { responseModalities: ['IMAGE'], imageConfig: { imageSize: quality } },
    }, { routeFamily: 'images', requestId })));
    return { images: normalizeInlineImages(response, { model, quality }) };
  }

  async describe(body: Record<string, unknown>, requestId?: string): Promise<{ text: string }> {
    const images = validateImages([body.image], this.config);
    const prompt = typeof body.prompt === 'string' ? body.prompt : 'Describe this image concisely.';
    const model = typeof body.model === 'string' ? body.model : 'gemini-2.5-flash';
    const response = await this.safeGenerate(() => this.ai.models.generateContent(withGenAiRequestMetadata({
      model,
      contents: [{ role: 'user', parts: [...buildImageParts(images), { text: prompt }] }],
    }, { routeFamily: 'images', requestId })));
    return { text: extractText(response) };
  }

  async validateSession(body: Record<string, unknown>, requestId?: string): Promise<{ ok: true; model?: string; text?: string }> {
    const model = typeof body.model === 'string' ? body.model : undefined;
    if (!model) return { ok: true };
    const response = await this.safeGenerate(() => this.ai.models.generateContent(withGenAiRequestMetadata({
      model,
      contents: [{ role: 'user', parts: [{ text: typeof body.prompt === 'string' ? body.prompt : 'Reply with ok.' }] }],
    }, { routeFamily: 'images', requestId })));
    return { ok: true, model, text: extractText(response) };
  }

  private async safeGenerate(task: () => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
    const { value } = await retryWithJitter(() => this.semaphore.run(() => withTimeout(task(), this.config.upstreamTimeoutMs)), 1);
    return value;
  }

  private async unsafeGenerate(task: () => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
    return this.semaphore.run(() => withTimeout(task(), this.config.upstreamTimeoutMs));
  }
}
