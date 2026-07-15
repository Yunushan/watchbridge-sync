import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from './csv.js';

describe('CSV codec', () => {
  it('round-trips quoted commas, quotes, and newlines and strips a UTF-8 BOM header marker', () => {
    const csv = toCsv([{ Title: 'Heat, “Director\'s Cut”', Notes: 'line one\nline two' }]);
    expect(parseCsv(csv)).toEqual([{ Title: 'Heat, “Director\'s Cut”', Notes: 'line one\nline two' }]);
    expect(parseCsv(`\uFEFFTitle,Year\nHeat,1995`)).toEqual([{ Title: 'Heat', Year: '1995' }]);
  });

  it('rejects structurally ambiguous CSV instead of silently dropping data', () => {
    expect(() => parseCsv('Title,Title\nHeat,Alien')).toThrow('unique');
    expect(() => parseCsv('Title,Year\nHeat,1995,unexpected')).toThrow('more values');
    expect(() => parseCsv('Title,Notes\nHeat,"unfinished')).toThrow('unterminated');
  });
});
