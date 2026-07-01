import type { ImageWorkloads } from '../workloads/image-workloads.js';
import { GatewayError } from '../http/error-response.js';

export const runCustomImageRoute = async (
  operation: string,
  body: Record<string, unknown>,
  workloads: ImageWorkloads,
  requestId?: string,
): Promise<Record<string, unknown>> => {
  if (operation === 'imageGenerate') return { success: true, ...(await workloads.generate(body, requestId)) };
  if (operation === 'imageEdit') return { success: true, ...(await workloads.edit(body, requestId)) };
  if (operation === 'imageUpscale') return { success: true, ...(await workloads.upscale(body, requestId)) };
  if (operation === 'imageDescribe') return { success: true, ...(await workloads.describe(body, requestId)) };
  if (operation === 'sessionValidate') return { success: true, ...(await workloads.validateSession(body, requestId)) };
  throw new GatewayError(404, 'NOT_FOUND', 'Custom route is not implemented.');
};
