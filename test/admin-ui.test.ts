import { describe, expect, it } from 'vitest';
import { renderAdminUi } from '../src/admin/admin-ui.js';

describe('admin ui', () => {
  it('renders a self-contained dashboard shell with login, credentials, and models sections', () => {
    const html = renderAdminUi();

    expect(html).toContain('Gateway Admin');
    expect(html).toContain('Auth Files');
    expect(html).toContain('Vertex JSON Login');
    expect(html).toContain('Auth File Details / Edit');
    expect(html).toContain('Vertex Model Rules');
    expect(html).toContain('id="log-search"');
    expect(html).toContain('id="available-models-add-alias-btn"');
    expect(html).toContain('id="token-input"');
    expect(html).toContain('id="credential-list"');
    expect(html).toContain('id="import-file"');
    expect(html).toContain('id="model-default"');
    expect(html).toContain('/admin/api/vertex-credentials/import');
    expect(html).toContain('/admin/api/models/');
    expect(html).toContain('openai-chat');
    expect(html).toContain('openai-responses');
    expect(html).toContain('sessionStorage');
    expect(html).toContain('localStorage');
    expect(html).not.toContain('/download');
    expect(html).not.toContain('gpt-5.5');
    expect(html).not.toContain('OpenAI');
    expect(html).toContain('Vertex / Gemini');
    expect(html).not.toContain('Management Center');
  });
});
