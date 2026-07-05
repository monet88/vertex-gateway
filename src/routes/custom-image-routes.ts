import type { ImageWorkloads } from '../workloads/image-workloads.js';
import { GatewayError } from '../http/error-response.js';

export const runCustomImageRoute = async (
  operation: string,
  body: Record<string, unknown>,
  workloads: ImageWorkloads,
  requestId?: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> => {
  if (operation === 'imageGenerate') return { success: true, ...(await workloads.generate(body, requestId, signal)) };
  if (operation === 'imageEdit') return { success: true, ...(await workloads.edit(body, requestId, signal)) };
  if (operation === 'imageUpscale') return { success: true, ...(await workloads.upscale(body, requestId, signal)) };
  if (operation === 'imageDescribe') return { success: true, ...(await workloads.describe(body, requestId, signal)) };
  if (operation === 'sessionValidate') return { success: true, ...(await workloads.validateSession(body, requestId, signal)) };
  throw new GatewayError(404, 'NOT_FOUND', 'Custom route is not implemented.');
};
