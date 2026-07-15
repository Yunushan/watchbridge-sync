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
    expect(html).toContain('34 / 34 platforms');
    expect(html).toContain('Direct-account platforms');
    expect(html).toContain('32.4%');
    expect(html).toContain('67.6% without direct account sync');
    expect(html).toContain('Registered three-feature direct methods');
    expect(html).toContain('Readable source feature slots');
    expect(html).toContain('70 / 102 rating/watched/watchlist slots');
    expect(html).toContain('31.4% source slots missing');
    expect(html).toContain('Verified account-write feature slots');
    expect(html).toContain('25 / 102 rating/watched/watchlist slots');
    expect(html).toContain('75.5% account-write slots missing');
    expect(html).toContain('Automated target feature slots');
    expect(html).toContain('27.5%');
    expect(html).toContain('72.5% target slots missing');
    expect(html).toContain('14.7%');
    expect(html).toContain('Coverage by executable feature');
    expect(html).toContain('25/34 (73.5%)');
    expect(html).toContain('23/34 (67.6%)');
    expect(html).toContain('7/34 (20.6%)');
    expect(request).not.toHaveBeenCalled();
    request.mockRestore();
  });
});
