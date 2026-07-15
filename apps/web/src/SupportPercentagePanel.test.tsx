import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SupportPercentagePanel } from './SupportPercentagePanel.js';

describe('SupportPercentagePanel', () => {
  it('renders an honest local snapshot without making a network request', () => {
    const request = vi.spyOn(globalThis, 'fetch');
    const html = renderToStaticMarkup(<SupportPercentagePanel />);

    expect(html).toContain('Computed locally');
    expect(html).toContain('Selectable platforms');
    expect(html).toContain('100%');
    expect(html).toContain('35 / 35 platforms');
    expect(html).toContain('Direct-account platforms');
    expect(html).toContain('31.4%');
    expect(html).toContain('68.6% without direct account sync');
    expect(html).toContain('Executable canonical families');
    expect(html).toContain('6 / 6 data families');
    expect(html).toContain('Primary three-family direct methods');
    expect(html).toContain('Registered all-family direct coverage');
    expect(html).toContain('Readable source feature slots');
    expect(html).toContain('210 executable-family slots');
    expect(html).toContain('Verified account-write feature slots');
    expect(html).toContain('Automated target feature slots');
    expect(html).toContain('17.1%');
    expect(html).toContain('Coverage by executable feature');
    expect(html).toContain('Reviews');
    expect(html).toContain('Following');
    expect(html).toContain('Followers');
    expect(html).toContain('25/35 (71.4%)');
    expect(html).toContain('8/35 (22.9%)');
    expect(request).not.toHaveBeenCalled();
    request.mockRestore();
  });
});
