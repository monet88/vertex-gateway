import { GatewayError } from '../http/error-response.js';

interface StreamState {
  active: number;
  queue: Array<{
    run: () => void;
    reject: (error: unknown) => void;
  }>;
}

export class StreamAdmission {
  private readonly states = new Map<string, StreamState>();

  constructor(
    private readonly perKeyLimit: number,
    private readonly queueLimit: number,
  ) {}

  async acquire(key: string, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      throw new GatewayError(499, 'RATE_LIMITED', 'Stream request was aborted before acquiring a slot.', true);
    }
    const state = this.states.get(key) ?? { active: 0, queue: [] };
    this.states.set(key, state);

    if (state.active < this.perKeyLimit) {
      state.active += 1;
      return () => this.release(key);
    }

    if (state.queue.length >= this.queueLimit) {
      throw new GatewayError(429, 'RATE_LIMITED', 'Too many active or queued streams for this gateway key.', true);
    }

    return new Promise((resolve, reject) => {
      const queueEntry = {
        run: () => {
          signal?.removeEventListener('abort', onAbort);
          if (signal?.aborted) {
            reject(new GatewayError(499, 'RATE_LIMITED', 'Stream request was aborted while queued.', true));
            this.release(key);
            return;
          }
          state.active += 1;
          resolve(() => this.release(key));
        },
        reject,
      };
      const onAbort = () => {
        const index = state.queue.indexOf(queueEntry);
        if (index !== -1) {
          state.queue.splice(index, 1);
        }
        if (state.active === 0 && state.queue.length === 0) {
          this.states.delete(key);
        }
        reject(new GatewayError(499, 'RATE_LIMITED', 'Stream request was aborted while queued.', true));
      };
      state.queue.push(queueEntry);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private release(key: string): void {
    const state = this.states.get(key);
    if (!state) return;

    state.active = Math.max(0, state.active - 1);
    const next = state.queue.shift();
    if (next) {
      next.run();
      return;
    }
    if (state.active === 0) {
      this.states.delete(key);
    }
  }
}
