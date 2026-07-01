import type { IncomingMessage, ServerResponse } from 'node:http';
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

export type SseFrameResult = 'continue' | 'stop';

/**
 * Frame-writing surface handed to a stream consumer. Every write flips the
 * driver's internal `wroteFrame` state so the first-frame error contract stays
 * correct without the consumer tracking it.
 */
export interface SseStreamWriter {
  writeJson(payload: Record<string, unknown>, event?: string): Promise<'written' | 'closed'>;
  writeError(error: unknown): Promise<void>;
  writeDone(): void;
  end(): void;
}

export interface SseStreamConsumer {
  /**
   * Called once per upstream chunk in arrival order. `index` is 0 for the first
   * chunk so consumers can emit a stream preamble exactly once. Return `stop` to
   * end the stream early (after the consumer has written its own final frame).
   */
  onChunk(chunk: Record<string, unknown>, index: number, writer: SseStreamWriter): Promise<SseFrameResult>;
  /** Called once the upstream ends normally (not on client disconnect or early stop). */
  onComplete?(writer: SseStreamWriter): Promise<void> | void;
}

export interface SseStreamDriveOptions {
  idleTimeoutMs?: number;
  maxDurationMs?: number;
  req?: IncomingMessage;
}

/**
 * Owns the full SSE streaming lifecycle: response header priming, per-chunk
 * guard stepping, client-disconnect detection, upstream iterator cleanup, and
 * the first-frame error contract (surface pre-header failures to the caller so
 * a JSON error can be sent; write post-header failures as an SSE error frame).
 * Consumers only translate chunks into frames.
 */
export const driveSseStream = async (
  res: ServerResponse,
  chunks: AsyncIterable<Record<string, unknown>>,
  consumer: SseStreamConsumer,
  options: SseStreamDriveOptions = {},
): Promise<void> => {
  if (res.destroyed || res.writableEnded) {
    return;
  }
  const idleTimeoutMs = options.idleTimeoutMs ?? 30_000;
  const maxDurationMs = options.maxDurationMs ?? 240_000;
  const startedAt = Date.now();
  const iterator = chunks[Symbol.asyncIterator]();
  let closed = false;
  let iteratorClosed = false;
  let wroteFrame = false;
  let index = 0;

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

  const writer: SseStreamWriter = {
    writeJson: async (payload, event) => {
      wroteFrame = true;
      return writeSseJson(res, payload, event);
    },
    writeError: async (error) => {
      wroteFrame = true;
      await writeSseError(res, error);
    },
    writeDone: () => {
      writeSseDone(res);
    },
    end: () => {
      if (res.destroyed || res.writableEnded) return;
      if (!wroteFrame) initializeSse(res);
      try {
        res.end();
      } catch {
        // Socket closed after the state check.
      }
    },
  };

  options.req?.once('close', onClose);
  options.req?.once('error', onClose);
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
          await writer.writeError(error);
        }
        return;
      }
      if (step.done) break;
      if (closed) return;
      if (await consumer.onChunk(step.value, index++, writer) === 'stop') return;
    }
    if (!closed) {
      await consumer.onComplete?.(writer);
      if (!closed && !res.writableEnded) {
        writer.end();
      }
    }
  } finally {
    options.req?.off('close', onClose);
    options.req?.off('error', onClose);
    res.off('close', onClose);
    res.off('error', onClose);
    await closeIterator();
  }
};

export const sendSseStream = async (
  res: ServerResponse,
  chunks: AsyncIterable<Record<string, unknown>>,
  options: { includeDone?: boolean; idleTimeoutMs?: number; maxDurationMs?: number; req?: IncomingMessage } = {},
): Promise<void> => {
  const includeDone = options.includeDone ?? false;
  await driveSseStream(
    res,
    chunks,
    {
      onChunk: async (chunk, _index, writer) => (
        await writer.writeJson(chunk) === 'closed' ? 'stop' : 'continue'
      ),
      onComplete: (writer) => {
        if (includeDone) {
          writer.writeDone();
        } else {
          writer.end();
        }
      },
    },
    {
      req: options.req,
      idleTimeoutMs: options.idleTimeoutMs,
      maxDurationMs: options.maxDurationMs,
    },
  );
};
