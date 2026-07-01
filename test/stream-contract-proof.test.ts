import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { sendSseStream } from '../src/http/sse-response.js';
import { createOpenAiTestClient } from './openai-test-client.js';

const require = createRequire(import.meta.url);

class FakeSseResponse extends EventEmitter {
  statusCode = 0;
  destroyed = false;
  writableEnded = false;
  readonly headers = new Map<string, string>();
  readonly writes: string[] = [];
  write = vi.fn((chunk: string) => {
    this.writes.push(chunk);
    return true;
  });
  end = vi.fn((chunk?: string) => {
    if (chunk) this.writes.push(chunk);
    this.writableEnded = true;
  });
  flushHeaders = vi.fn();

  setHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }
}

const parseSseDataFrames = (body: string): Array<Record<string, unknown> | '[DONE]'> => body
  .split('\n\n')
  .filter(Boolean)
  .map((frame) => {
    const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
    if (!dataLine) throw new Error(`Missing data line in frame: ${frame}`);
    const data = dataLine.slice('data: '.length);
    return data === '[DONE]' ? '[DONE]' : JSON.parse(data) as Record<string, unknown>;
  });

const parseSseEventNames = (body: string): string[] => body
  .split('\n\n')
  .filter(Boolean)
  .flatMap((frame) => frame.split('\n').filter((line) => line.startsWith('event: ')).map((line) => line.slice('event: '.length)));

const listen = async (server: Server): Promise<string> => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (typeof address === 'object' && address) resolve(`http://127.0.0.1:${address.port}`);
  });
});

const writeSseFrames = (res: ServerResponse, frames: string[]): void => {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/event-stream; charset=utf-8');
  frames.forEach((frame) => res.write(`data: ${frame}\n\n`));
  res.end('data: [DONE]\n\n');
};

const createOpenAiFixtureServer = (): Server => createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.method === 'POST' && req.url === '/chat/completions') {
    writeSseFrames(res, [
      '{"id":"chatcmpl_test","object":"chat.completion.chunk","created":1,"model":"gemini-2.5-flash","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}',
      '{"id":"chatcmpl_test","object":"chat.completion.chunk","created":1,"model":"gemini-2.5-flash","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}',
      '{"id":"chatcmpl_test","object":"chat.completion.chunk","created":1,"model":"gemini-2.5-flash","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
    ]);
    return;
  }
  if (req.method === 'POST' && req.url === '/responses') {
    writeSseFrames(res, [
      '{"type":"response.created","sequence_number":0,"response":{"id":"resp_test","object":"response","status":"in_progress","model":"gemini-2.5-flash","output":[]}}',
      '{"type":"response.output_item.added","sequence_number":1,"output_index":0,"item":{"id":"msg_test","type":"message","role":"assistant","content":[]}}',
      '{"type":"response.content_part.added","sequence_number":2,"item_id":"msg_test","output_index":0,"content_index":0,"part":{"type":"output_text","text":""}}',
      '{"type":"response.output_text.delta","sequence_number":3,"item_id":"msg_test","output_index":0,"content_index":0,"delta":"ok"}',
      '{"type":"response.output_text.done","sequence_number":4,"item_id":"msg_test","output_index":0,"content_index":0,"text":"ok"}',
      '{"type":"response.content_part.done","sequence_number":5,"item_id":"msg_test","output_index":0,"content_index":0,"part":{"type":"output_text","text":"ok","annotations":[]}}',
      '{"type":"response.output_item.done","sequence_number":6,"output_index":0,"item":{"id":"msg_test","type":"message","status":"completed","role":"assistant","content":[{"type":"output_text","text":"ok","annotations":[]}]}}',
      '{"type":"response.completed","sequence_number":7,"response":{"id":"resp_test","object":"response","status":"completed","model":"gemini-2.5-flash","output":[{"id":"msg_test","type":"message","status":"completed","role":"assistant","content":[{"type":"output_text","text":"ok","annotations":[]}]}],"output_text":"ok"}}',
    ]);
    return;
  }
  res.statusCode = 404;
  res.end();
});

describe('stream contract proof', () => {
  it('matches the installed @google/genai stream method signature and config shape', () => {
    const entrypointPath = require.resolve('@google/genai');
    const declarationPath = join(dirname(entrypointPath), 'node.d.ts');
    const packageJson = JSON.parse(
      readFileSync(join(dirname(declarationPath), '..', '..', 'package.json'), 'utf8'),
    ) as { version: string };
    const declarations = readFileSync(declarationPath, 'utf8');

    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(declarations).toContain(
      'generateContentStream: (params: types.GenerateContentParameters) => Promise<AsyncGenerator<types.GenerateContentResponse>>',
    );
    expect(declarations).toContain('export declare interface GenerateContentParameters');
    const generateContentParameters = declarations.match(
      /export declare interface GenerateContentParameters \{[\s\S]*?\n\}/,
    )?.[0];
    expect(generateContentParameters).toContain('config?: GenerateContentConfig;');
    expect(generateContentParameters).not.toContain('generationConfig?:');
  });

  it('writes the first SSE frame before the upstream generator completes', async () => {
    let releaseCompletion!: () => void;
    let generatorCompleted = false;
    const completionGate = new Promise<void>((resolve) => {
      releaseCompletion = resolve;
    });
    async function* delayedStream(): AsyncIterable<Record<string, unknown>> {
      yield { candidates: [{ content: { parts: [{ text: 'first' }] } }] };
      await completionGate;
      yield { candidates: [{ content: { parts: [{ text: 'second' }] } }] };
      generatorCompleted = true;
    }
    const res = new FakeSseResponse();
    const sendPromise = sendSseStream(res as unknown as ServerResponse, delayedStream(), { includeDone: true });

    await vi.waitFor(() => {
      expect(res.write).toHaveBeenCalledTimes(1);
    });
    expect(generatorCompleted).toBe(false);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.writes[0]).toContain('data: {"candidates":[{"content":{"parts":[{"text":"first"}]}}]}');

    releaseCompletion();
    await sendPromise;

    expect(generatorCompleted).toBe(true);
    expect(res.writes.at(-1)).toBe('data: [DONE]\n\n');
  });

  it('parses the accepted OpenAI Chat, Responses, and Google stream fixture frames', () => {
    const chatFrames = parseSseDataFrames([
      'data: {"id":"chatcmpl_test","object":"chat.completion.chunk","created":1,"model":"gemini-2.5-flash","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl_test","object":"chat.completion.chunk","created":1,"model":"gemini-2.5-flash","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl_test","object":"chat.completion.chunk","created":1,"model":"gemini-2.5-flash","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      'data: [DONE]',
      '',
    ].join('\n\n'));

    expect(chatFrames.at(-1)).toBe('[DONE]');
    const chatEvents = chatFrames.slice(0, -1) as Array<Record<string, unknown>>;
    expect(chatEvents.every((frame) => frame.object === 'chat.completion.chunk')).toBe(true);
    expect(((chatFrames[1] as { choices: Array<{ delta: { content: string } }> }).choices[0].delta.content)).toBe('ok');

    const responseFixture = [
      'event: response.created\ndata: {"type":"response.created","sequence_number":0,"response":{"id":"resp_test","object":"response","status":"in_progress","model":"gemini-2.5-flash","output":[]}}',
      'event: response.output_item.added\ndata: {"type":"response.output_item.added","sequence_number":1,"output_index":0,"item":{"id":"msg_test","type":"message","role":"assistant","content":[]}}',
      'event: response.content_part.added\ndata: {"type":"response.content_part.added","sequence_number":2,"item_id":"msg_test","output_index":0,"content_index":0,"part":{"type":"output_text","text":""}}',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","sequence_number":3,"item_id":"msg_test","output_index":0,"content_index":0,"delta":"ok"}',
      'event: response.output_text.done\ndata: {"type":"response.output_text.done","sequence_number":4,"item_id":"msg_test","output_index":0,"content_index":0,"text":"ok"}',
      'event: response.content_part.done\ndata: {"type":"response.content_part.done","sequence_number":5,"item_id":"msg_test","output_index":0,"content_index":0,"part":{"type":"output_text","text":"ok","annotations":[]}}',
      'event: response.output_item.done\ndata: {"type":"response.output_item.done","sequence_number":6,"output_index":0,"item":{"id":"msg_test","type":"message","status":"completed","role":"assistant","content":[{"type":"output_text","text":"ok","annotations":[]}]}}',
      'event: response.completed\ndata: {"type":"response.completed","sequence_number":7,"response":{"id":"resp_test","object":"response","status":"completed","model":"gemini-2.5-flash","output":[{"id":"msg_test","type":"message","status":"completed","role":"assistant","content":[{"type":"output_text","text":"ok","annotations":[]}]}],"output_text":"ok"}}',
      'data: [DONE]',
      '',
    ].join('\n\n');
    const responseFrames = parseSseDataFrames(responseFixture);
    const responseEventNames = parseSseEventNames(responseFixture);

    const semanticEvents = responseFrames.slice(0, -1) as Array<{ type: string; sequence_number: number }>;
    expect(semanticEvents.map((event) => event.type)).toEqual([
      'response.created',
      'response.output_item.added',
      'response.content_part.added',
      'response.output_text.delta',
      'response.output_text.done',
      'response.content_part.done',
      'response.output_item.done',
      'response.completed',
    ]);
    expect(responseEventNames).toEqual([
      'response.created',
      'response.output_item.added',
      'response.content_part.added',
      'response.output_text.delta',
      'response.output_text.done',
      'response.content_part.done',
      'response.output_item.done',
      'response.completed',
    ]);
    expect(semanticEvents.map((event) => event.sequence_number)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    const googleFrames = parseSseDataFrames([
      'data: {"candidates":[{"content":{"parts":[{"text":"hel"}]}}]}',
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"pick_size","args":{"size":"M"}}}]}}]}',
      'data: {"candidates":[{"content":{"parts":[{"text":"lo"}]},"finishReason":"STOP"}]}',
      'data: [DONE]',
      '',
    ].join('\n\n'));

    expect(googleFrames.at(-1)).toBe('[DONE]');
    expect((googleFrames[0] as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> }).candidates[0].content.parts[0].text).toBe('hel');
    expect((googleFrames[1] as { candidates: Array<{ content: { parts: Array<{ functionCall: { name: string; args: { size: string } } }> } }> }).candidates[0].content.parts[0].functionCall).toEqual({
      name: 'pick_size',
      args: { size: 'M' },
    });
    expect((googleFrames[2] as { candidates: Array<{ finishReason: string }> }).candidates[0].finishReason).toBe('STOP');
  });

  it('is consumable by the OpenAI SDK streaming parsers for Chat and Responses fixtures', async () => {
    const server = createOpenAiFixtureServer();
    const baseURL = await listen(server);
    const client = createOpenAiTestClient(baseURL);

    try {
      const chatStream = await client.chat.completions.create({
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      });
      const chatDeltas: string[] = [];
      for await (const event of chatStream) {
        const content = event.choices[0]?.delta.content;
        if (content) chatDeltas.push(content);
      }
      expect(chatDeltas.join('')).toBe('ok');

      const responseStream = await client.responses.create({
        model: 'gemini-2.5-flash',
        input: 'hi',
        stream: true,
      });
      const responseEvents: string[] = [];
      const responseDeltas: string[] = [];
      for await (const event of responseStream) {
        responseEvents.push(event.type);
        if (event.type === 'response.output_text.delta') responseDeltas.push(event.delta);
      }
      expect(responseEvents).toContain('response.created');
      expect(responseEvents).toContain('response.output_text.delta');
      expect(responseEvents).toContain('response.completed');
      expect(responseDeltas.join('')).toBe('ok');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
