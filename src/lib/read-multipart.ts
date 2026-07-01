import type { IncomingMessage } from 'node:http';
import { GatewayError } from '../http/error-response.js';

export interface MultipartPart {
  name: string;
  filename?: string;
  contentType?: string;
  data: Buffer;
}

const parseContentDisposition = (value: string): { name?: string; filename?: string } => {
  const name = value.match(/(?:^|;\s*)name="([^"]+)"/i)?.[1];
  const filename = value.match(/(?:^|;\s*)filename="([^"]*)"/i)?.[1];
  return {
    ...(name ? { name } : {}),
    ...(filename ? { filename } : {}),
  };
};

export const readMultipartBody = async (
  req: IncomingMessage,
  maxBytes: number,
): Promise<MultipartPart[]> => {
  const contentType = req.headers['content-type'];
  if (typeof contentType !== 'string' || !contentType.includes('multipart/form-data')) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'Expected multipart/form-data.');
  }
  const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
  if (!boundaryMatch) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'Multipart boundary is required.');
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      throw new GatewayError(413, 'PAYLOAD_TOO_LARGE', 'Multipart payload exceeds gateway byte limit.');
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks);
  const boundary = Buffer.from(`--${boundaryMatch[1].trim().replace(/^"|"$/g, '')}`, 'latin1');
  const parts: MultipartPart[] = [];
  let cursor = 0;
  while (cursor < raw.length) {
    const boundaryIndex = raw.indexOf(boundary, cursor);
    if (boundaryIndex === -1) break;

    let segmentStart = boundaryIndex + boundary.length;
    if (raw[segmentStart] === 45 && raw[segmentStart + 1] === 45) {
      break;
    }
    if (raw[segmentStart] === 13 && raw[segmentStart + 1] === 10) {
      segmentStart += 2;
    }

    const nextBoundaryIndex = raw.indexOf(boundary, segmentStart);
    if (nextBoundaryIndex === -1) break;

    let segmentEnd = nextBoundaryIndex;
    if (raw[segmentEnd - 2] === 13 && raw[segmentEnd - 1] === 10) {
      segmentEnd -= 2;
    }

    const segment = raw.subarray(segmentStart, segmentEnd);
    cursor = nextBoundaryIndex;

    const headerEnd = segment.indexOf(Buffer.from('\r\n\r\n', 'latin1'));
    if (headerEnd === -1) continue;
    const headerText = segment.subarray(0, headerEnd).toString('latin1');
    const body = segment.subarray(headerEnd + 4);
    const headers = Object.fromEntries(
      headerText.split('\r\n').map((line) => {
        const [name, ...rest] = line.split(':');
        return [name.trim().toLowerCase(), rest.join(':').trim()];
      }),
    );
    if (typeof headers['content-disposition'] !== 'string') continue;
    const disposition = parseContentDisposition(headers['content-disposition']);
    if (!disposition.name) continue;
    parts.push({
      name: disposition.name,
      ...(disposition.filename ? { filename: disposition.filename } : {}),
      ...(typeof headers['content-type'] === 'string' ? { contentType: headers['content-type'] } : {}),
      data: Buffer.from(body),
    });
  }
  return parts;
};
