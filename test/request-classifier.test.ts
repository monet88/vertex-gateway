import { describe, expect, it } from 'vitest';
import { classifyRoute } from '../src/http/request-classifier.js';

describe('request classifier', () => {
  it('classifies Gemini-compatible generate routes with /gemini prefix', () => {
    expect(classifyRoute('POST', '/gemini/v1beta/models/gemini-2.5-flash:generateContent')).toMatchObject({
      family: 'gemini',
      operation: 'generateContent',
      model: 'gemini-2.5-flash',
    });
  });

  it('classifies Vertex publisher routes', () => {
    expect(classifyRoute('POST', '/vertex/v1/projects/p/locations/us-central1/publishers/google/models/gemini-2.5-flash:predict')).toMatchObject({
      family: 'vertex',
      operation: 'predict',
      project: 'p',
      location: 'us-central1',
    });
  });

  it('classifies OpenAI-compatible routes under /openai prefix', () => {
    expect(classifyRoute('GET', '/openai/v1/models')).toMatchObject({
      family: 'openai',
      operation: 'models',
    });
    expect(classifyRoute('POST', '/openai/v1/chat/completions')).toMatchObject({
      family: 'openai',
      operation: 'chatCompletions',
    });
    expect(classifyRoute('POST', '/openai/v1/responses')).toMatchObject({
      family: 'openai',
      operation: 'responses',
    });
  });

  it('does not allow root v1beta aliases', () => {
    expect(() => classifyRoute('POST', '/v1beta/models/gemini-2.5-flash:generateContent')).toThrow(/allowlist/);
  });
});
