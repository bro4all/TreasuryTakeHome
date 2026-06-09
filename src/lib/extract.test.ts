import { describe, expect, it } from 'vitest';
import {
  expectedVolumeMl,
  extractAbvValues,
  extractProofValues,
  extractVolumes,
  proofMatchesAbv,
  suggestApplicationFields
} from './extract';

describe('extractAbvValues', () => {
  it('reads percent and ABV phrasings', () => {
    expect(extractAbvValues('45% Alc./Vol. (90 Proof)')).toEqual([45]);
    expect(extractAbvValues('ALCOHOL 13.4% BY VOLUME')).toContain(13.4);
    expect(extractAbvValues('40 ABV')).toContain(40);
  });

  it('returns nothing when no alcohol statement exists', () => {
    expect(extractAbvValues('NET CONTENTS 750 ML')).toEqual([]);
  });
});

describe('extractProofValues', () => {
  it('reads proof statements', () => {
    expect(extractProofValues('45% Alc./Vol. (90 Proof)')).toEqual([90]);
    expect(extractProofValues('101 PROOF BARREL STRENGTH')).toEqual([101]);
  });
});

describe('extractVolumes', () => {
  it('reads milliliters', () => {
    expect(extractVolumes('Net Contents 750 mL').map((volume) => volume.ml)).toEqual([750]);
  });

  it('converts liters and does not confuse mL with L', () => {
    const fromLiters = extractVolumes('1.75 L bottle');
    expect(fromLiters.map((volume) => volume.ml)).toEqual([1750]);
    // "750 mL" must not also parse as 750 liters.
    expect(extractVolumes('750 mL').map((volume) => volume.ml)).toEqual([750]);
  });

  it('converts fluid ounces', () => {
    const volumes = extractVolumes('12 FL OZ');
    expect(volumes).toHaveLength(1);
    expect(volumes[0].ml).toBeCloseTo(354.88, 1);
  });
});

describe('expectedVolumeMl', () => {
  it('handles mL, L, and fl oz application values', () => {
    expect(expectedVolumeMl('750 mL')).toBe(750);
    expect(expectedVolumeMl('1.75 L')).toBe(1750);
    expect(expectedVolumeMl('12 fl oz')).toBeCloseTo(354.88, 1);
    expect(expectedVolumeMl('unknown')).toBeUndefined();
  });
});

describe('proofMatchesAbv', () => {
  it('accepts proof equal to twice the ABV', () => {
    expect(proofMatchesAbv(90, 45)).toBe(true);
    expect(proofMatchesAbv(94, 47)).toBe(true);
  });

  it('rejects inconsistent pairs', () => {
    expect(proofMatchesAbv(94, 45)).toBe(false);
  });
});

describe('suggestApplicationFields', () => {
  const labelText = [
    'BLUE HARBOR RUM',
    'Aged Barbados Rum',
    '40% Alc./Vol. (80 Proof)',
    'Net Contents 750 mL',
    'Product of Barbados'
  ].join('\n');

  it('suggests brand, class/type, alcohol, proof, net contents, and origin', () => {
    const suggestion = suggestApplicationFields(labelText);
    expect(suggestion.brandName).toBe('BLUE HARBOR RUM');
    expect(suggestion.classType).toBe('Aged Barbados Rum');
    expect(suggestion.alcoholContent).toBe('40% Alc./Vol.');
    expect(suggestion.proof).toBe('80 Proof');
    expect(suggestion.netContents).toBe('750 mL');
    expect(suggestion.countryOfOrigin).toBe('Barbados');
  });

  it('suggests producer and importer statements from cue lines', () => {
    const suggestion = suggestApplicationFields(
      [
        'OLD TOM DISTILLERY',
        'Kentucky Straight Bourbon Whiskey',
        '45% Alc./Vol. (90 Proof)',
        'Net Contents 750 mL',
        'Bottled by Old Tom Distillery, Louisville, KY'
      ].join('\n')
    );
    expect(suggestion.producerAddress).toBe('Bottled by Old Tom Distillery, Louisville, KY');
    expect(suggestion.classType).toBe('Kentucky Straight Bourbon Whiskey');
  });

  it('suggests the importer address with the cue phrase stripped', () => {
    const suggestion = suggestApplicationFields(
      ['BLUE HARBOR RUM', 'Aged Rum', 'Imported by Harbor Spirits LLC, Baltimore, MD'].join('\n')
    );
    expect(suggestion.importerAddress).toBe('Harbor Spirits LLC, Baltimore, MD');
    expect(suggestion.producerAddress).toBe('Imported by Harbor Spirits LLC, Baltimore, MD');
  });

  it('does not reuse the brand line as the class/type suggestion', () => {
    const suggestion = suggestApplicationFields(
      ['BOURBON CREEK', 'Kentucky Straight Bourbon Whiskey', '45% Alc./Vol.'].join('\n')
    );
    expect(suggestion.brandName).toBe('BOURBON CREEK');
    expect(suggestion.classType).toBe('Kentucky Straight Bourbon Whiskey');
  });

  it('omits fields it cannot find', () => {
    const suggestion = suggestApplicationFields('JUST A BRAND');
    expect(suggestion.alcoholContent).toBeUndefined();
    expect(suggestion.countryOfOrigin).toBeUndefined();
  });

  it('prefers the prominent all-caps line for the brand', () => {
    const suggestion = suggestApplicationFields(
      ['Estd. 1875', 'RIVERBEND BOURBON', 'Kentucky Straight Bourbon Whiskey', '45% Alc./Vol.'].join('\n')
    );
    expect(suggestion.brandName).toBe('RIVERBEND BOURBON');
  });

  it('never suggests warning or statement lines as the brand', () => {
    const suggestion = suggestApplicationFields(
      ['GOVERNMENT WARNING: (1) According to the Surgeon General', 'Bottled by Acme, KY', 'Smooth Reserve'].join('\n')
    );
    expect(suggestion.brandName).toBe('Smooth Reserve');
  });
});
