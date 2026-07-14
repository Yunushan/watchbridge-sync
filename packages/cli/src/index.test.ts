import { describe, expect, it, vi } from 'vitest';
import { run, type CliIo } from './index.js';

function makeIo(files: Record<string, string>): CliIo & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    readText: vi.fn(async (path: string) => files[path] ?? ''),
    writeLine: (message: string) => lines.push(message)
  };
}

describe('WatchBridge CLI', () => {
  it('lists every registered service with its capabilities', async () => {
    const io = makeIo({});
    await run(['services'], io);
    const services = JSON.parse(io.lines[0]);
    expect(services).toHaveLength(26);
    expect(services).toContainEqual(expect.objectContaining({ id: 'trakt', readiness: 'implemented' }));
  });

  it('imports a mapped user-owned CSV file', async () => {
    const io = makeIo({
      'export.csv': 'Name,Score,Seen\nHeat,8,2026-01-01',
      'mapping.json': JSON.stringify({
        service: 'serializd',
        ratingScale: { min: 1, max: 10, step: 1, name: 'Ten point' },
        columns: { title: 'Name', rating: 'Score', watchedAt: 'Seen' }
      })
    });
    await run(['import-mapped-csv', 'export.csv', 'mapping.json'], io);
    expect(JSON.parse(io.lines[0])).toMatchObject({
      ratings: [{ value: 8, item: { title: 'Heat' } }],
      watched: [{ watchedAt: '2026-01-01' }]
    });
  });
});
