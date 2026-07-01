import type { ServerResponse } from 'node:http';
import type { GatewayErrorCode } from './error-response.js';
import { GatewayError, toGatewayError } from './error-response.js';
import { nextStreamStep } from '../lib/stream-guards.js';

const initializeSse = (res: ServerResponse): void => {
  if (res.headersSent) return;
  res.statusCode = 200;
  res.setHeader('content-type', 'text/event-stream; charset=utf-8');
  res.setHeader('cache-control', 'no-cache');
  res.setHeader('connection', 'keep-alive');
  res.setHeader('x-accel-buffering', 'no');
  res.flushHeaders?.();
};

const waitForDrainOrClose = (res: ServerResponse): Promise<'drain' | 'closed'> => new Promise((resolve) => {
  const cleanup = () => {
    res.off('drain', onDrain);
    res.off('close', onClose);
    res.off('error', onClose);
  };
  const onDrain = () => {
    cleanup();
    resolve('drain');
  };
  const onClose = () => {
    cleanup();
    resolve('closed');
  };

  res.once('drain', onDrain);
  res.once('close', onClose);
  res.once('error', onClose);
});

const writeSseFrame = async (res: ServerResponse, frame: string): Promise<'written' | 'closed'> => {
  initializeSse(res);
  try {
    const accepted = res.write(frame);
    if (accepted) return 'written';
  } catch {
    return 'closed';
  }
  return await waitForDrainOrClose(res) === 'closed' ? 'closed' : 'written';
};

export const writeSseJson = async (
  res: ServerResponse,
  payload: Record<string, unknown>,
  event?: string,
): Promise<'written' | 'closed'> => {
  const prefix = event ? `event: ${event}\n` : '';
  return writeSseFrame(res, `${prefix}data: ${JSON.stringify(payload)}\n\n`);
};

export const writeSseDone = (res: ServerResponse): void => {
  initializeSse(res);
  if (res.destroyed || res.writableEnded) return;
  try {
    res.end('data: [DONE]\n\n');
  } catch {
    // Socket closed after the state check.
  }
};

export const writeSseError = async (
  res: ServerResponse,
  error: unknown,
): Promise<'written' | 'closed'> => {
  const gatewayError = toGatewayError(error);
  const status = await writeSseJson(res, {
    error: {
      code: gatewayError.code satisfies GatewayErrorCode,
      message: gatewayError.message,
      retryable: gatewayError.retryable || undefined,
    },
  }, 'error');
  if (status === 'written' && !res.destroyed && !res.writableEnded) {
    try {
      res.end();
    } catch {
      return 'closed';
    }
  }
  return status;
};

export const sendSseStream = async (
  res: ServerResponse,
  chunks: AsyncIterable<Record<string, unknown>>,
  options: { includeDone?: boolean; idleTimeoutMs?: number; maxDurationMs?: number } = {},
): Promise<void> => {
  const includeDone = options.includeDone ?? false;
  const idleTimeoutMs = options.idleTimeoutMs ?? 30_000;
  const maxDurationMs = options.maxDurationMs ?? 240_000;
  let closed = false;
  let iteratorClosed = false;
  let wroteFrame = false;
  const startedAt = Date.now();
  const iterator = chunks[Symbol.asyncIterator]();

  const closeIterator = async () => {
    if (iteratorClosed) return;
    iteratorClosed = true;
    if (typeof iterator.return === 'function') {
      try {
        await iterator.return();
      } catch {
        // Ignore cleanup failures after disconnect.
      }
    }
  };

  const onClose = () => {
    closed = true;
    void closeIterator();
  };

  res.once('close', onClose);
  res.once('error', onClose);

  try {
    while (!closed) {
      let step: IteratorResult<Record<string, unknown>>;
      try {
        step = await nextStreamStep(iterator, { idleTimeoutMs, maxDurationMs, startedAt });
      } catch (error) {
        if (!closed && !wroteFrame && !res.headersSent) {
          throw error;
        }
        if (!closed) {
          await writeSseError(res, error);
        }
        return;
      }
      if (step.done) {
        break;
      }
      if (closed) return;
      wroteFrame = true;
      if (await writeSseJson(res, step.value) === 'closed') return;
    }
    if (!closed) {
      if (includeDone) {
        writeSseDone(res);
      } else if (!res.destroyed && !res.writableEnded) {
        try {
          if (!wroteFrame) {
            initializeSse(res);
          }
          res.end();
        } catch {
          // Socket closed after the state check.
        }
      }
    }
  } finally {
    res.off('close', onClose);
    res.off('error', onClose);
    await closeIterator();
  }
};
