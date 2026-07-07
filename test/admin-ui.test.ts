import { describe, expect, it } from 'vitest';
import { renderAdminUi } from '../src/admin/admin-ui.js';

describe('legacy admin ui renderer', () => {
  it('still renders the rollback shell while it remains in the repository', () => {
    const html = renderAdminUi();

    expect(html).toContain('Gateway Admin');
    expect(html).toContain('Auth Files');
    expect(html).toContain('Vertex / Gemini');
    expect(html).not.toContain('/download');
    expect(html).not.toContain('gpt-5.5');
  });
});
