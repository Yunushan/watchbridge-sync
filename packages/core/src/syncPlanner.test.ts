import { describe, expect, it } from 'vitest';
import { planSync } from './syncPlanner.js';

describe('sync planner', () => {
  it('plans Letterboxd rating export to IMDb import file with rating warning', () => {
    const ops = planSync({
      source: 'letterboxd',
      target: 'imdb',
      dryRun: true,
      selection: { ratings: true }
    });
    expect(ops.map((op) => op.type)).toContain('transform');
    expect(ops.some((op) => op.warnings.some((warning) => warning.includes('doubled')))).toBe(true);
  });

  it('blocks unsupported source capabilities', () => {
    const ops = planSync({
      source: 'tv-time',
      target: 'trakt',
      dryRun: true,
      selection: { ratings: true }
    });
    expect(ops[0].type).toBe('blocked');
  });
});
