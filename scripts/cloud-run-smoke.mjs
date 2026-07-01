/* global process, fetch, console */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const envFile = path.join(rootDir, 'gcp', 'cloud-run.env.yaml');

const parseYamlEnv = (source) => Object.fromEntries(
  source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('#'))
    .map((line) => {
      const index = line.indexOf(':');
      const key = line.slice(0, index).trim();
      let value = line.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
        value = value.slice(1, -1);
      }
      return [key, value];
    }),
);

const loadConfig = () => {
  const fromFile = fs.existsSync(envFile) ? parseYamlEnv(fs.readFileSync(envFile, 'utf8')) : {};
  return {
    baseUrl: process.env.GATEWAY_BASE_URL || 'https://gemini.monet.uno',
    apiKey: process.env.GATEWAY_API_KEY || fromFile.GATEWAY_API_KEYS?.split(',')[0]?.trim(),
    project: process.env.GOOGLE_VERTEX_PROJECT || fromFile.GOOGLE_VERTEX_PROJECT,
    location: process.env.GOOGLE_VERTEX_LOCATION || fromFile.GOOGLE_VERTEX_LOCATION || 'global',
  };
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const main = async () => {
  const config = loadConfig();
  assert(config.apiKey, 'Missing gateway API key.');
  const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pP4sFQAAAAASUVORK5CYII=';

  const results = [];

  const readyz = await fetch(`${config.baseUrl}/readyz`);
  assert(readyz.ok, `/readyz failed with ${readyz.status}`);
  const readyzBody = await readyz.json();
  assert(readyzBody.ok === true, '/readyz did not return ok:true');
  results.push('readyz');

  const openai = new OpenAI({
    apiKey: config.apiKey,
    baseURL: `${config.baseUrl}/openai/v1`,
  });

  const models = await openai.models.list();
  assert(Array.isArray(models.data) && models.data.length > 0, 'OpenAI models list was empty.');
  results.push('openai-models');

  const chat = await openai.chat.completions.create({
    model: 'gemini-3.5-flash',
    messages: [{ role: 'user', content: 'Reply with exactly ok' }],
  });
  assert(chat.choices[0]?.message?.content?.toLowerCase().includes('ok'), 'OpenAI chat non-stream response did not contain ok.');
  results.push('openai-chat');

  const chatStream = await openai.chat.completions.create({
    model: 'gemini-3.5-flash',
    messages: [{ role: 'user', content: 'Reply with exactly ok' }],
    stream: true,
  });
  let chatText = '';
  for await (const event of chatStream) {
    chatText += event.choices[0]?.delta?.content ?? '';
  }
  assert(chatText.toLowerCase().includes('ok'), 'OpenAI chat stream did not contain ok.');
  results.push('openai-chat-stream');

  const response = await openai.responses.create({
    model: 'gemini-3.5-flash',
    input: 'Reply with exactly ok',
  });
  assert(response.output_text?.toLowerCase().includes('ok'), 'OpenAI responses non-stream did not contain ok.');
  results.push('openai-responses');

  const responseStream = await openai.responses.create({
    model: 'gemini-3.5-flash',
    input: 'Reply with exactly ok',
    stream: true,
  });
  let responseText = '';
  for await (const event of responseStream) {
    if (event.type === 'response.output_text.delta') responseText += event.delta;
  }
  assert(responseText.toLowerCase().includes('ok'), 'OpenAI responses stream did not contain ok.');
  results.push('openai-responses-stream');

  const openaiImageGenerate = await fetch(`${config.baseUrl}/openai/v1/images/generations`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gemini-2.5-flash-image',
      prompt: 'Generate a simple fashion sketch on white background',
      n: 1,
      size: '1024x1024',
    }),
  });
  assert(openaiImageGenerate.ok, `OpenAI image generations failed with ${openaiImageGenerate.status}`);
  const openaiImageGenerateBody = await openaiImageGenerate.json();
  assert(Array.isArray(openaiImageGenerateBody.data) && typeof openaiImageGenerateBody.data[0]?.b64_json === 'string', 'OpenAI image generations did not return b64_json.');
  results.push('openai-images-generate');

  const openaiImageEdit = await fetch(`${config.baseUrl}/openai/v1/images/edits`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gemini-2.5-flash-image',
      prompt: 'Edit the tiny input into a clean monochrome fashion icon',
      n: 1,
      size: '1024x1024',
      image: `data:image/png;base64,${tinyPng}`,
    }),
  });
  assert(openaiImageEdit.ok, `OpenAI image edits failed with ${openaiImageEdit.status}`);
  const openaiImageEditBody = await openaiImageEdit.json();
  assert(Array.isArray(openaiImageEditBody.data) && typeof openaiImageEditBody.data[0]?.b64_json === 'string', 'OpenAI image edits did not return b64_json.');
  results.push('openai-images-edit');

  const customImageGenerate = await fetch(`${config.baseUrl}/api/images/generate`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gemini-2.5-flash-image',
      prompt: 'Generate a minimal fashion product icon',
      numberOfImages: 1,
    }),
  });
  assert(customImageGenerate.ok, `Custom image generate failed with ${customImageGenerate.status}`);
  const customImageGenerateBody = await customImageGenerate.json();
  assert(Array.isArray(customImageGenerateBody.images) && typeof customImageGenerateBody.images[0]?.dataUrl === 'string', 'Custom image generate did not return dataUrl output.');
  results.push('custom-image-generate');

  const gemini = new GoogleGenAI({
    apiKey: config.apiKey,
    httpOptions: {
      baseUrl: `${config.baseUrl}/gemini`,
      apiVersion: 'v1beta',
    },
  });
  const geminiStream = await gemini.models.generateContentStream({
    model: 'gemini-2.5-flash',
    contents: 'Reply with exactly ok',
  });
  let geminiText = '';
  for await (const chunk of geminiStream) {
    geminiText += chunk.text ?? '';
  }
  assert(geminiText.toLowerCase().includes('ok'), 'Gemini SDK stream did not contain ok.');
  results.push('gemini-stream');

  const vertex = new GoogleGenAI({
    apiKey: config.apiKey,
    httpOptions: {
      baseUrl: `${config.baseUrl}/vertex/v1/projects/${config.project}/locations/${config.location}/publishers/google`,
      apiVersion: '',
    },
  });
  const vertexStream = await vertex.models.generateContentStream({
    model: 'gemini-2.5-flash',
    contents: 'Reply with exactly ok',
  });
  let vertexText = '';
  for await (const chunk of vertexStream) {
    vertexText += chunk.text ?? '';
  }
  assert(vertexText.toLowerCase().includes('ok'), 'Vertex SDK stream did not contain ok.');
  results.push('vertex-stream');

  console.log(JSON.stringify({ ok: true, results }, null, 2));
};

await main();
