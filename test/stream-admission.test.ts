import { describe, expect, it } from 'vitest';
import { StreamAdmission } from '../src/lib/stream-admission.js';

describe('stream admission', () => {
  it('rejects when active and queued streams exceed the configured per-key budget', async () => {
    const admission = new StreamAdmission(1, 1);

    const releaseFirst = await admission.acquire('test-key');
    const second = admission.acquire('test-key');

    await expect(admission.acquire('test-key')).rejects.toThrow(/too many active or queued streams/i);

    releaseFirst();
    const releaseSecond = await second;
    releaseSecond();
  });

  it('removes queued requests when the caller aborts before a slot is released', async () => {
    const admission = new StreamAdmission(1, 1);
    const releaseFirst = await admission.acquire('test-key');
    const controller = new AbortController();
    const queued = admission.acquire('test-key', controller.signal);

    controller.abort();

    await expect(queued).rejects.toThrow(/aborted while queued/i);
    releaseFirst();

    const releaseThird = await admission.acquire('test-key');
    releaseThird();
  });
});
