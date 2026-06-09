import { describe, expect, it } from 'vitest';
import { compareGovernmentWarning, STANDARD_GOVERNMENT_WARNING } from './warning';

describe('compareGovernmentWarning', () => {
  it('passes the statutory text word for word', () => {
    const result = compareGovernmentWarning(`BRAND NAME\n750 mL\n${STANDARD_GOVERNMENT_WARNING}`);
    expect(result.prefixStyle).toBe('allCaps');
    expect(result.missingWords).toEqual([]);
    expect(result.alteredWords).toEqual([]);
    expect(result.coverage).toBe(1);
  });

  it('flags a title-case prefix', () => {
    const text = STANDARD_GOVERNMENT_WARNING.replace('GOVERNMENT WARNING:', 'Government Warning:');
    expect(compareGovernmentWarning(text).prefixStyle).toBe('titleCase');
  });

  it('reports missing words', () => {
    const text = STANDARD_GOVERNMENT_WARNING.replace('birth defects', 'defects');
    const result = compareGovernmentWarning(text);
    expect(result.missingWords).toContain('BIRTH');
  });

  it('classifies close OCR misreads as alterations, not omissions', () => {
    const text = STANDARD_GOVERNMENT_WARNING.replace('Surgeon General', 'Surgeon Generel');
    const result = compareGovernmentWarning(text);
    expect(result.missingWords).not.toContain('GENERAL');
    expect(result.alteredWords).toContainEqual({ expected: 'GENERAL', actual: 'GENEREL' });
  });

  it('reports a missing warning entirely', () => {
    const result = compareGovernmentWarning('OLD TOM DISTILLERY\n45% Alc./Vol.\n750 mL');
    expect(result.prefixStyle).toBe('missing');
    expect(result.coverage).toBeLessThan(0.5);
  });

  it('ignores surrounding label text when diffing', () => {
    const result = compareGovernmentWarning(
      `OLD TOM DISTILLERY\nKentucky Straight Bourbon Whiskey\n${STANDARD_GOVERNMENT_WARNING}\nBottled in Louisville`
    );
    expect(result.missingWords).toEqual([]);
  });
});
