import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  isOAuthCallbackPath,
  OAuthCallbackRelay,
  parseOAuthCallbackMessage,
  parseOAuthCallbackQuery
} from './OAuthCallbackRelay.js';

describe('OAuth callback relay boundaries', () => {
  it('accepts one bounded code/state callback or one bounded error/state callback', () => {
    expect(parseOAuthCallbackQuery('?state=state-1&code=code-1')).toEqual({ state: 'state-1', code: 'code-1' });
    expect(parseOAuthCallbackQuery('?state=state-1&error=access_denied&error_description=User%20cancelled')).toEqual({
      state: 'state-1', error: 'access_denied', errorDescription: 'User cancelled'
    });
    expect(parseOAuthCallbackMessage({ state: 'state-1', code: 'code-1' })).toEqual({ state: 'state-1', code: 'code-1' });
  });

  it('rejects duplicate, missing, mixed, control-character, and unexpected relay data', () => {
    expect(parseOAuthCallbackQuery('?state=a&state=b&code=code')).toBeUndefined();
    expect(parseOAuthCallbackQuery('?code=code')).toBeUndefined();
    expect(parseOAuthCallbackQuery('?state=state&code=code&error=access_denied')).toBeUndefined();
    expect(parseOAuthCallbackQuery('?state=state&code=bad%0Acode')).toBeUndefined();
    expect(parseOAuthCallbackMessage({ state: 'state', code: 'code', token: 'never-relay' })).toBeUndefined();
  });

  it('uses only the explicit callback route and renders no callback value in static markup', () => {
    expect(isOAuthCallbackPath('/oauth/callback')).toBe(true);
    expect(isOAuthCallbackPath('/oauth/callback/')).toBe(true);
    expect(isOAuthCallbackPath('/oauth/callback/other')).toBe(false);
    expect(isOAuthCallbackPath('/')).toBe(false);
    const html = renderToStaticMarkup(<OAuthCallbackRelay />);
    expect(html).toContain('Authorization callback');
    expect(html).not.toContain('code-1');
    expect(html).not.toContain('state-1');
  });
});
