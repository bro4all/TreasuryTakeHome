import { describe, expect, it } from 'vitest';
import {
  allowedEditDistance,
  fuzzyPhraseMatch,
  levenshtein,
  normalizeForSearch,
  phraseCoverage,
  tokensMatch
} from './text';

describe('normalizeForSearch', () => {
  it('uppercases and strips punctuation and accents', () => {
    expect(normalizeForSearch("Stone's Throw, Café Añejo!")).toBe('STONES THROW CAFE ANEJO');
  });

  it('expands Alc./Vol. into a comparable phrase', () => {
    expect(normalizeForSearch('45% Alc./Vol.')).toBe('45% ALCOHOL BY VOLUME');
  });

  it('joins split milliliter units', () => {
    expect(normalizeForSearch('750 m L')).toBe('750 ML');
  });

  it('canonicalizes fluid ounce spellings', () => {
    expect(normalizeForSearch('12 FL. OZ.')).toBe('12 FLOZ');
    expect(normalizeForSearch('12 fl oz')).toBe('12 FLOZ');
  });
});

describe('levenshtein', () => {
  it('computes edit distances', () => {
    expect(levenshtein('DISTILLERY', 'DISTILLERY')).toBe(0);
    expect(levenshtein('DISTILLERY', 'DISTILLERV')).toBe(1);
    expect(levenshtein('BOURBON', 'B0URB0N')).toBe(2);
  });

  it('stops early when the cap is exceeded', () => {
    expect(levenshtein('COMPLETELY', 'DIFFERENT!', 2)).toBeGreaterThan(2);
  });
});

describe('tokensMatch', () => {
  it('accepts close misreads of long words', () => {
    expect(tokensMatch('DISTILLERV', 'DISTILLERY')).toBe(true);
    expect(tokensMatch('WH1SKEY', 'WHISKEY')).toBe(false); // contains a digit: exact only
  });

  it('never fuzzy-matches numbers', () => {
    expect(allowedEditDistance('45')).toBe(0);
    expect(tokensMatch('45', '46')).toBe(false);
    expect(tokensMatch('750ML', '751ML')).toBe(false);
  });

  it('requires exact matches for short words', () => {
    expect(tokensMatch('GIN', 'GIM')).toBe(false);
    expect(tokensMatch('GIN', 'GIN')).toBe(true);
  });
});

describe('phraseCoverage', () => {
  it('reports missing tokens', () => {
    const result = phraseCoverage('OLD TOM DISTILLERY', 'OLD TOM DISTILLERY BOURBON');
    expect(result.score).toBeCloseTo(3 / 4);
    expect(result.missing).toEqual(['BOURBON']);
  });

  it('counts fuzzy token hits and reports them', () => {
    const result = phraseCoverage('OLD TOM DISTILLERV', 'OLD TOM DISTILLERY');
    expect(result.score).toBe(1);
    expect(result.fuzzyMatched).toEqual(['DISTILLERY']);
  });
});

describe('fuzzyPhraseMatch', () => {
  it('returns a perfect score for exact normalized substrings', () => {
    const result = fuzzyPhraseMatch('Bottled by OLD TOM DISTILLERY, Louisville', 'Old Tom Distillery');
    expect(result.score).toBe(1);
    expect(result.missing).toEqual([]);
  });
});
