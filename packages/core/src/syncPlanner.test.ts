import { describe, expect, it } from 'vitest';
import { planSync } from './syncPlanner.js';

describe('sync planner', () => {
  it('does not turn a source-file reader into a target-file generator', () => {
    const ops = planSync({
      source: 'letterboxd',
      target: 'imdb',
      dryRun: true,
      selection: { ratings: true }
    });

    expect(ops.map((op) => op.type)).toEqual(['import-file', 'transform', 'manual-action']);
    expect(ops.at(-1)?.description).toContain('no shipped write path or target-file generator');
    expect(ops.some((op) => op.warnings.some((warning) => warning.includes('doubled')))).toBe(true);
  });

  it('plans the shipped Letterboxd target-file generator without claiming a direct write', () => {
    const ops = planSync({
      source: 'trakt',
      target: 'letterboxd',
      dryRun: true,
      selection: { ratings: true, watched: true, watchlist: true }
    });

    expect(ops.filter((op) => op.type === 'export-file')).toHaveLength(3);
    expect(ops.filter((op) => op.type === 'manual-action')).toEqual([]);
    expect(ops.at(-1)?.description).toContain('letterboxd-compatible');
  });

  it('routes a lawful manual export through mapped CSV without claiming that WatchBridge fetches it', () => {
    const ops = planSync({
      source: 'serializd',
      target: 'simkl',
      dryRun: true,
      selection: { ratings: true }
    });

    expect(ops.map((op) => op.type)).toEqual(['import-file', 'transform', 'write']);
    expect(ops[0]?.description).toContain('mapped-CSV');
    expect(ops[0]?.warnings.join(' ')).toContain('does not fetch');
  });

  it('blocks metadata-only and restricted entries as user-data sources', () => {
    for (const source of ['tvmaze'] as const) {
      const ops = planSync({ source, target: 'trakt', dryRun: true, selection: { ratings: true } });
      expect(ops).toEqual([expect.objectContaining({ type: 'blocked', feature: 'ratings' })]);
    }
  });

  it('plans a Letterboxd review export through the registered constrained Trakt writer', () => {
    const ops = planSync({
      source: 'letterboxd', target: 'trakt', dryRun: true,
      selection: { reviews: true }
    });

    expect(ops.map((op) => op.type)).toEqual(['import-file', 'transform', 'write']);
    expect(ops.at(-1)?.description).toContain('preview reviews writes to trakt');
    expect(ops.at(-1)?.warnings).toEqual(['Dry-run only; no remote changes.']);
  });

  it.each(['following', 'followers'] as const)('archives mapped %s without inventing cross-provider identity', (feature) => {
    const ops = planSync({
      source: 'serializd',
      target: 'trakt',
      dryRun: true,
      selection: { [feature]: true }
    });

    expect(ops.map((operation) => operation.type)).toEqual(['import-file', 'transform', 'manual-action']);
    expect(ops[1]).toMatchObject({ feature, description: expect.stringContaining('provider-scoped') });
    expect(ops[2]?.warnings.join(' ')).toContain(feature === 'followers' ? 'read-only' : 'same-service');
  });

  it('blocks two-way social reconciliation because usernames are provider-scoped', () => {
    const ops = planSync({
      source: 'trakt', target: 'simkl', dryRun: true, direction: 'two-way',
      selection: { following: true, followers: true }
    });
    expect(ops).toEqual([
      expect.objectContaining({ type: 'blocked', feature: 'following', description: expect.stringContaining('provider-scoped') }),
      expect.objectContaining({ type: 'blocked', feature: 'followers', warnings: [expect.stringContaining('cross-provider')] })
    ]);
  });

  it('plans both directions only when both account connectors can read and write the feature', () => {
    const ops = planSync({
      source: 'trakt',
      target: 'simkl',
      dryRun: true,
      direction: 'two-way',
      selection: { ratings: true, watched: true }
    });

    expect(ops).toHaveLength(12);
    expect(ops.filter((op) => op.type === 'write')).toEqual([
      expect.objectContaining({ feature: 'ratings', source: 'trakt', target: 'simkl' }),
      expect.objectContaining({ feature: 'ratings', source: 'simkl', target: 'trakt' }),
      expect.objectContaining({ feature: 'watched', source: 'trakt', target: 'simkl' }),
      expect.objectContaining({ feature: 'watched', source: 'simkl', target: 'trakt' })
    ]);
  });

  it('blocks two-way features when either side lacks account read/write support', () => {
    const partial = planSync({
      source: 'tmdb', target: 'trakt', dryRun: true, direction: 'two-way',
      selection: { ratings: true, watched: true, watchlist: true }
    });
    expect(partial.filter((op) => op.feature === 'ratings' && op.type === 'write')).toHaveLength(2);
    expect(partial.filter((op) => op.feature === 'watchlist' && op.type === 'write')).toHaveLength(2);
    expect(partial.filter((op) => op.feature === 'watched')).toEqual([
      expect.objectContaining({ type: 'blocked', description: expect.stringContaining('account read and write') })
    ]);

    const filePair = planSync({
      source: 'letterboxd', target: 'trakt', dryRun: true, direction: 'two-way',
      selection: { ratings: true }
    });
    expect(filePair).toEqual([expect.objectContaining({ type: 'blocked', feature: 'ratings' })]);

    const modelOnly = planSync({
      source: 'trakt', target: 'simkl', dryRun: true, direction: 'two-way',
      selection: { reviews: true }
    });
    expect(modelOnly).toEqual([expect.objectContaining({ type: 'blocked', feature: 'reviews' })]);
  });

  it('blocks same-service plans', () => {
    const ops = planSync({ source: 'trakt', target: 'trakt', dryRun: true, selection: { ratings: true } });
    expect(ops).toEqual([expect.objectContaining({ type: 'blocked' })]);
  });

  it('blocks Bangumi cross-service plans until verified identity enrichment is shipped', () => {
    for (const [source, target] of [['bangumi', 'myanimelist'], ['trakt', 'bangumi']] as const) {
      const ops = planSync({ source, target, dryRun: true, direction: 'two-way', selection: { ratings: true, watched: true } });
      expect(ops).toEqual([
        expect.objectContaining({ type: 'blocked', feature: 'ratings', description: expect.stringContaining('identity-enrichment') }),
        expect.objectContaining({ type: 'blocked', feature: 'watched', warnings: [expect.stringContaining('verified Bangumi IDs')] })
      ]);
    }
  });
});
