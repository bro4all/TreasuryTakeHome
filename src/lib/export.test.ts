import { describe, expect, it } from 'vitest';
import { csvEscape, findingsToCsv } from './export';
import { sampleLabels } from '../data/sampleLabels';

describe('csvEscape', () => {
  it('passes plain values through', () => {
    expect(csvEscape('750 mL')).toBe('750 mL');
  });

  it('quotes values containing commas, quotes, or newlines', () => {
    expect(csvEscape('Louisville, KY')).toBe('"Louisville, KY"');
    expect(csvEscape('say "warning"')).toBe('"say ""warning"""');
    expect(csvEscape('line one\nline two')).toBe('"line one\nline two"');
  });
});

describe('findingsToCsv', () => {
  it('emits a header plus one row per finding', () => {
    const csv = findingsToCsv(sampleLabels);
    const lines = csv.trimEnd().split('\r\n');
    const findingCount = sampleLabels.reduce((sum, record) => sum + record.findings.length, 0);
    expect(lines).toHaveLength(1 + findingCount);
    expect(lines[0]).toContain('Application ID');
    expect(csv.charCodeAt(0)).toBe(0xfeff); // UTF-8 BOM for Excel
  });

  it('emits a placeholder row for records that have not run', () => {
    const record = { ...sampleLabels[0], findings: [], summary: undefined };
    const csv = findingsToCsv([record]);
    expect(csv).toContain('not run');
  });
});
