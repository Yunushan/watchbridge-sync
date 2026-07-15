import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OAuthVaultPanel } from './OAuthVaultPanel.js';

describe('OAuthVaultPanel', () => {
  it('requires explicit confirmation and never renders a supplied connector secret', () => {
    const html = renderToStaticMarkup(<OAuthVaultPanel />);
    expect(html).toContain('Encrypted connector vault');
    expect(html).toContain('WATCHBRIDGE_STORAGE_KEY');
    expect(html).toContain('Store encrypted connector context');
    expect(html).toContain('type="password"');
    expect(html).toContain('vaultId');
    expect(html).not.toContain('source-secret-token');
  });
});
