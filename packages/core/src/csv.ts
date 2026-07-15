export interface CsvRow {
  [key: string]: string;
}

export function parseCsv(input: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (inQuotes) throw new Error('CSV contains an unterminated quoted field.');
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const [rawHeaders, ...data] = rows.filter((r) => r.some((c) => c.trim().length > 0));
  if (!rawHeaders) return [];
  const headers = rawHeaders.map((header, index) => index === 0 ? header.trim().replace(/^\uFEFF/, '') : header.trim());
  if (headers.some((header) => !header)) throw new Error('CSV header names must not be empty.');
  if (new Set(headers).size !== headers.length) throw new Error('CSV header names must be unique.');
  return data.map((values, index) => {
    if (values.slice(headers.length).some((value) => value.trim())) {
      throw new Error(`CSV row ${index + 2} has more values than the header.`);
    }
    return Object.fromEntries(headers.map((header, column) => [header, values[column]?.trim() ?? '']));
  });
}

export function toCsv(rows: CsvRow[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (value: string) => {
    if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
    return value;
  };
  return [headers.join(','), ...rows.map((row) => headers.map((h) => escape(row[h] ?? '')).join(','))].join('\n');
}
