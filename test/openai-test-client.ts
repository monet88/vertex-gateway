type ChatCompletionChunk = {
  choices: Array<{
    delta: { role?: string; content?: string };
    finish_reason?: string | null;
  }>;
};

type ResponsesEvent = {
  type: string;
  delta?: string;
};

const parseSseStream = async function* <T>(response: Response): AsyncGenerator<T> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Missing response body for SSE stream.');
  }
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
      if (!dataLine) continue;
      const data = dataLine.slice('data: '.length);
      if (data === '[DONE]') return;
      yield JSON.parse(data) as T;
    }
    if (done) break;
  }
};

export const createOpenAiTestClient = (baseURL: string) => ({
  chat: {
    completions: {
      create: async (body: Record<string, unknown>) => {
        const response = await fetch(`${baseURL}/chat/completions`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer test-key',
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        });
        if (body.stream === true) {
          return parseSseStream<ChatCompletionChunk>(response);
        }
        return await response.json();
      },
    },
  },
  responses: {
    create: async (body: Record<string, unknown>) => {
      const response = await fetch(`${baseURL}/responses`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-key',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (body.stream === true) {
        return parseSseStream<ResponsesEvent>(response);
      }
      return await response.json();
    },
  },
});
