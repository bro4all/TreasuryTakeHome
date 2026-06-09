/**
 * Adversarial regression suite: inputs deliberately constructed to fool the
 * verification rules. Each case previously produced a false PASS; these tests
 * pin the corrected behavior.
 */
import { describe, expect, it } from 'vitest';
import { compareGovernmentWarning, STANDARD_GOVERNMENT_WARNING } from './warning';
import { verifyLabel } from './verification';
import { extractAbvCandidates } from './extract';
import { bestWindowMatch } from './text';
import { csvEscape } from './export';
import type { ApplicationData } from '../types';

// Findings that produce 'warning' (review) on ambiguous input are acceptable
// policy; only a wrong 'pass' (false positive) or a wrong 'fail' on a clearly
// correct label (false negative) counts as a bug here.

const app: ApplicationData = {
  id: 'COLA-X',
  brandName: 'OLD TOM DISTILLERY',
  classType: 'Kentucky Straight Bourbon Whiskey',
  alcoholContent: '45% Alc./Vol.',
  proof: '90 Proof',
  netContents: '750 mL',
  producerAddress: 'Bottled by Old Tom Distillery, Louisville, KY',
  countryOfOrigin: 'United States',
  importerAddress: ''
};

describe('government warning exactness', () => {
  it('rejects words inserted into the statutory text', () => {
    const tampered = STANDARD_GOVERNMENT_WARNING.replace('Surgeon General', 'Assistant Surgeon General');
    const comparison = compareGovernmentWarning(tampered);
    expect(comparison.extraWords).toContain('ASSISTANT');

    const finding = verifyLabel(`BRAND\n750 mL\n${tampered}`, app).find((f) => f.id === 'governmentWarning');
    expect(finding?.status).toBe('fail');
    expect(finding?.details?.join(' ')).toContain('ASSISTANT');
  });

  it('downgrades single-character OCR specks to review, not fail', () => {
    const speckled = STANDARD_GOVERNMENT_WARNING.replace('impairs your', 'impairs i your');
    const finding = verifyLabel(speckled, app).find((f) => f.id === 'governmentWarning');
    expect(finding?.status).toBe('warning');
  });

  it('does not count label text after the warning as insertions', () => {
    const text = `${STANDARD_GOVERNMENT_WARNING}\nCertificate label artwork sample`;
    const comparison = compareGovernmentWarning(text);
    expect(comparison.extraWords).toEqual([]);
  });
});

describe('statement-level matching', () => {
  it('does not assemble a producer address from unrelated lines', () => {
    const text = [
      'OLD TOM DISTILLERY',
      'Kentucky Straight Bourbon Whiskey',
      '45% Alc./Vol. (90 Proof)',
      '750 mL',
      'Bottled by Red Barn Distilling, Bardstown, KY',
      STANDARD_GOVERNMENT_WARNING
    ].join('\n');

    const finding = verifyLabel(text, app).find((f) => f.id === 'producerAddress');
    expect(finding?.status).not.toBe('pass');
  });

  it('still passes when the full statement wraps across two lines', () => {
    const match = bestWindowMatch(
      'OLD TOM DISTILLERY\nBottled by Old Tom Distillery,\nLouisville, KY\n750 mL',
      'Bottled by Old Tom Distillery, Louisville, KY'
    );
    expect(match.score).toBe(1);
  });
});

describe('country of origin requires an origin statement', () => {
  const importApp: ApplicationData = {
    ...app,
    brandName: 'BLUE HARBOR RUM',
    classType: 'Aged Barbados Rum',
    alcoholContent: '40% Alc./Vol.',
    proof: '80 Proof',
    countryOfOrigin: 'Barbados',
    importerAddress: 'Harbor Spirits LLC, Baltimore, MD'
  };

  it('does not pass when the country only appears in the class designation', () => {
    const text = [
      'BLUE HARBOR RUM',
      'Aged Barbados Rum',
      '40% Alc./Vol. (80 Proof)',
      '750 mL',
      'Imported by Harbor Spirits LLC, Baltimore, MD',
      STANDARD_GOVERNMENT_WARNING
    ].join('\n');

    const finding = verifyLabel(text, importApp).find((f) => f.id === 'countryOfOrigin');
    expect(finding?.status).toBe('warning');
    expect(finding?.details?.join(' ')).toMatch(/origin statement|Product of/i);
  });

  it('passes with a Product of statement', () => {
    const text = [
      'BLUE HARBOR RUM',
      'Aged Barbados Rum',
      '40% Alc./Vol. (80 Proof)',
      '750 mL',
      'Imported by Harbor Spirits LLC, Baltimore, MD',
      'Product of Barbados',
      STANDARD_GOVERNMENT_WARNING
    ].join('\n');

    const finding = verifyLabel(text, importApp).find((f) => f.id === 'countryOfOrigin');
    expect(finding?.status).toBe('pass');
  });
});

describe('alcohol content context', () => {
  it('flags percentages with no alcohol wording instead of passing', () => {
    const text = [
      'OLD TOM DISTILLERY',
      'Kentucky Straight Bourbon Whiskey',
      'Bottle made with 45% recycled glass',
      '750 mL',
      'Bottled by Old Tom Distillery, Louisville, KY',
      STANDARD_GOVERNMENT_WARNING
    ].join('\n');

    expect(extractAbvCandidates('Bottle made with 45% recycled glass')[0]?.hasAlcoholContext).toBe(false);
    const finding = verifyLabel(text, { ...app, proof: '' }).find((f) => f.id === 'alcoholContent');
    expect(finding?.status).toBe('warning');
    expect(finding?.details?.join(' ')).toContain('no alcohol wording');
  });

  it('flags conflicting ABV statements instead of silently passing one', () => {
    const text = [
      'OLD TOM DISTILLERY',
      'Kentucky Straight Bourbon Whiskey',
      '45% Alc./Vol. (90 Proof)',
      '47% Alc./Vol.',
      '750 mL',
      'Bottled by Old Tom Distillery, Louisville, KY',
      STANDARD_GOVERNMENT_WARNING
    ].join('\n');

    const finding = verifyLabel(text, app).find((f) => f.id === 'alcoholContent');
    expect(finding?.status).toBe('warning');
    expect(finding?.details?.join(' ')).toContain('multiple alcohol percentages');
  });
});

describe('CSV formula injection', () => {
  it('neutralizes cells that would execute as spreadsheet formulas', () => {
    expect(csvEscape('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(csvEscape('+1-800-EVIL')).toBe("'+1-800-EVIL");
    expect(csvEscape('@cmd')).toBe("'@cmd");
    expect(csvEscape('-2+3')).toBe("'-2+3");
    expect(csvEscape('normal value')).toBe('normal value');
  });
});

// ---------------------------------------------------------------------------
// Second-wave red-team regressions
// ---------------------------------------------------------------------------

const WARNING = STANDARD_GOVERNMENT_WARNING;

describe('order-aware statement matching', () => {
  it('rejects a producer assembled from ADJACENT unrelated lines', () => {
    const text = [
      'OLD TOM DISTILLERY',
      'Bottled by Red Barn Distilling, Bardstown, KY',
      '45% Alc./Vol. (90 Proof)',
      '750 mL',
      WARNING
    ].join('\n');
    const finding = verifyLabel(text, app).find((f) => f.id === 'producerAddress');
    expect(finding?.status).not.toBe('pass');
  });

  it('rejects a single line containing the right tokens in the wrong order', () => {
    const text = [
      'OLD TOM DISTILLERY KENTUCKY BOURBON, BOTTLED BY RED BARN DISTILLING, LOUISVILLE, KY',
      '45% Alc./Vol. (90 Proof)',
      '750 mL',
      WARNING
    ].join('\n');
    const finding = verifyLabel(text, app).find((f) => f.id === 'producerAddress');
    expect(finding?.status).not.toBe('pass');
  });

  it('rejects class/type marketing-copy rearrangements', () => {
    const text = [
      'OLD TOM DISTILLERY',
      'KENTUCKY WHISKEY, STRAIGHT FROM THE BOURBON TRAIL',
      '45% Alc./Vol. (90 Proof)',
      '750 mL',
      'Bottled by Old Tom Distillery, Louisville, KY',
      WARNING
    ].join('\n');
    const finding = verifyLabel(text, app).find((f) => f.id === 'classType');
    expect(finding?.status).not.toBe('pass');
  });

  it('still passes stacked one-word-per-line brand typography', () => {
    const text = ['OLD', 'TOM', 'DISTILLERY', '45% Alc./Vol. (90 Proof)', '750 mL', WARNING].join('\n');
    const finding = verifyLabel(text, app).find((f) => f.id === 'brandName');
    expect(finding?.status).toBe('pass');
  });

  it('keeps statement-level matching when pasted text has no newlines', () => {
    const flat =
      'OLD TOM DISTILLERY is a fine brand. Bottled by Red Barn Distilling, Bardstown, KY. Net contents 750 mL. 45% Alc./Vol. (90 Proof).';
    const finding = verifyLabel(flat, app).find((f) => f.id === 'producerAddress');
    expect(finding?.status).not.toBe('pass');
  });
});

describe('warning boundary insertions', () => {
  it('flags a word butted against the prefix (STATE GOVERNMENT WARNING:)', () => {
    const finding = verifyLabel(`STATE ${WARNING}`, app).find((f) => f.id === 'governmentWarning');
    expect(finding?.status).not.toBe('pass');
    expect(finding?.details?.join(' ')).toContain('STATE');
  });

  it('flags words appended after the final statutory word on its line', () => {
    const finding = verifyLabel(WARNING.replace('health problems.', 'health problems eventually.'), app).find(
      (f) => f.id === 'governmentWarning'
    );
    expect(finding?.status).not.toBe('pass');
    expect(finding?.details?.join(' ')).toContain('EVENTUALLY');
  });

  it('does not punish the warning for unrelated following lines', () => {
    const finding = verifyLabel(`BRAND\n${WARNING}\nCertificate label artwork sample`, app).find(
      (f) => f.id === 'governmentWarning'
    );
    expect(finding?.status).toBe('pass');
  });
});

describe('origin statement hardening', () => {
  const importApp: ApplicationData = {
    ...app,
    brandName: 'BLUE HARBOR RUM',
    classType: 'Aged Rum',
    alcoholContent: '40% Alc./Vol.',
    proof: '80 Proof',
    countryOfOrigin: 'Barbados',
    importerAddress: 'Harbor Spirits LLC, Baltimore, MD'
  };

  it('rejects negated origin statements', () => {
    const text = ['BLUE HARBOR RUM', 'NOT A PRODUCT OF BARBADOS', '40% Alc./Vol. (80 Proof)', '750 mL', WARNING].join('\n');
    const finding = verifyLabel(text, importApp).find((f) => f.id === 'countryOfOrigin');
    expect(finding?.status).not.toBe('pass');
  });

  it('accepts an origin statement wrapped across two lines', () => {
    const text = ['BLUE HARBOR RUM', 'Product of', 'Barbados', '40% Alc./Vol. (80 Proof)', '750 mL', WARNING].join('\n');
    const finding = verifyLabel(text, importApp).find((f) => f.id === 'countryOfOrigin');
    expect(finding?.status).toBe('pass');
  });

  it('shows the mismatched origin statement as evidence, not "none found"', () => {
    const text = ['BLUE HARBOR RUM', 'Product of Jamaica', '40% Alc./Vol. (80 Proof)', '750 mL', WARNING].join('\n');
    const finding = verifyLabel(text, importApp).find((f) => f.id === 'countryOfOrigin');
    expect(finding?.status).toBe('fail');
    expect(finding?.evidence).toContain('Jamaica');
  });

  it('treats "U.S." as domestic, not as an import', () => {
    const domestic = verifyLabel(
      ['OLD TOM DISTILLERY', '45% Alc./Vol. (90 Proof)', '750 mL', WARNING].join('\n'),
      { ...app, countryOfOrigin: 'U.S.' }
    );
    expect(domestic.find((f) => f.id === 'countryOfOrigin')?.status).toBe('pass');
    expect(domestic.find((f) => f.id === 'importerAddress')?.status).toBe('pass');
  });
});

describe('numeric extraction hardening', () => {
  it('does not let PROOF on another line qualify an unrelated percentage', () => {
    const text = [
      'OLD TOM DISTILLERY',
      'Bottle made with 45% recycled glass',
      '90 Proof',
      '750 mL',
      'Bottled by Old Tom Distillery, Louisville, KY',
      WARNING
    ].join('\n');
    const finding = verifyLabel(text, app).find((f) => f.id === 'alcoholContent');
    expect(finding?.status).not.toBe('pass');
  });

  it('does not treat bare VOLUME marketing copy as alcohol context', () => {
    expect(extractAbvCandidates('NOW WITH 45% MORE VOLUME PER BOTTLE')[0]?.hasAlcoholContext).toBe(false);
  });

  it('parses "TEQUILA 100% DE AGAVE 45% ALC./VOL." without a phantom 0%', () => {
    const values = extractAbvCandidates('TEQUILA 100% DE AGAVE 45% ALC./VOL.').map((c) => c.value);
    expect(values).toContain(45);
    expect(values).not.toContain(0);
  });

  it('does not read a spaced lot code as net contents', () => {
    const text = ['OLD TOM DISTILLERY', 'LOT 750 M L B', '45% Alc./Vol. (90 Proof)', WARNING].join('\n');
    const finding = verifyLabel(text, app).find((f) => f.id === 'netContents');
    expect(finding?.status).not.toBe('pass');
  });

  it('accepts centiliter statements (75 cl = 750 mL)', () => {
    const text = ['OLD TOM DISTILLERY', '75 cl', '45% Alc./Vol. (90 Proof)', WARNING].join('\n');
    const finding = verifyLabel(text, app).find((f) => f.id === 'netContents');
    expect(finding?.status).toBe('pass');
  });

  it('rejects near-miss metric volumes instead of passing them', () => {
    const text = ['OLD TOM DISTILLERY', 'Net Contents 745 mL', '45% Alc./Vol. (90 Proof)', WARNING].join('\n');
    const finding = verifyLabel(text, app).find((f) => f.id === 'netContents');
    expect(finding?.status).not.toBe('pass');
  });

  it('points at bare-ounce wording when no standard statement exists', () => {
    const text = ['OLD TOM DISTILLERY', '12 OZ', '45% Alc./Vol. (90 Proof)', WARNING].join('\n');
    const finding = verifyLabel(text, { ...app, netContents: '12 fl oz' }).find((f) => f.id === 'netContents');
    expect(finding?.status).toBe('fail');
    expect(finding?.evidence).toContain('12 OZ');
  });
});

// ---------------------------------------------------------------------------
// Third-round regressions
// ---------------------------------------------------------------------------

describe('warning prefix is judged at the warning itself', () => {
  it('does not let an all-caps mention elsewhere vouch for a title-case warning', () => {
    const titleCase = WARNING.replace('GOVERNMENT WARNING:', 'Government Warning:');
    const text = [titleCase, 'Artwork note: use GOVERNMENT WARNING: template'].join('\n');
    const finding = verifyLabel(text, app).find((f) => f.id === 'governmentWarning');
    expect(finding?.status).toBe('fail');
  });
});

describe('token-bounded matching', () => {
  it('does not match a brand inside a longer word (ACE vs SPACE)', () => {
    const text = ['SPACE AGE VODKA', '45% Alc./Vol. (90 Proof)', '750 mL', WARNING].join('\n');
    const finding = verifyLabel(text, { ...app, brandName: 'ACE' }).find((f) => f.id === 'brandName');
    expect(finding?.status).not.toBe('pass');
  });

  it('does not match a country inside another country (Oman vs Romania)', () => {
    const text = ['BRAND', 'Product of Romania', '45% Alc./Vol. (90 Proof)', '750 mL', WARNING].join('\n');
    const finding = verifyLabel(text, { ...app, countryOfOrigin: 'Oman' }).find(
      (f) => f.id === 'countryOfOrigin'
    );
    expect(finding?.status).not.toBe('pass');
  });

  it('treats single-digit street numbers as substantive tokens', () => {
    const text = ['OLD TOM DISTILLERY', 'Bottled at 6 Main St', '45% Alc./Vol. (90 Proof)', '750 mL', WARNING].join('\n');
    const finding = verifyLabel(text, { ...app, producerAddress: 'Bottled at 5 Main St' }).find(
      (f) => f.id === 'producerAddress'
    );
    expect(finding?.status).not.toBe('pass');
  });

  it('does not match a street number inside a longer number (12 vs 112)', () => {
    const text = ['OLD TOM DISTILLERY', 'Bottled at 112 Main St', '45% Alc./Vol. (90 Proof)', '750 mL', WARNING].join('\n');
    const finding = verifyLabel(text, { ...app, producerAddress: 'Bottled at 12 Main St' }).find(
      (f) => f.id === 'producerAddress'
    );
    expect(finding?.status).not.toBe('pass');
  });
});

describe('addresses require every token', () => {
  it('does not pass a producer address with the wrong city', () => {
    const text = [
      'OLD TOM DISTILLERY',
      'Bottled by Old Tom Distillery, Bardstown, KY',
      '45% Alc./Vol. (90 Proof)',
      '750 mL',
      WARNING
    ].join('\n');
    const finding = verifyLabel(text, app).find((f) => f.id === 'producerAddress');
    expect(finding?.status).not.toBe('pass');
    expect(finding?.details?.join(' ')).toContain('LOUISVILLE');
  });
});

describe('ABV context requires adjacency', () => {
  it('rejects a keyword elsewhere on the same line', () => {
    const candidates = extractAbvCandidates('Bottle made with 45% recycled glass; contains alcohol.');
    expect(candidates.find((c) => c.value === 45)?.hasAlcoholContext).toBe(false);
  });

  it('accepts the standard adjacent forms', () => {
    expect(extractAbvCandidates('45% Alc./Vol.')[0]?.hasAlcoholContext).toBe(true);
    expect(extractAbvCandidates('ALCOHOL BY VOLUME 45%')[0]?.hasAlcoholContext).toBe(true);
    expect(extractAbvCandidates('45% (90 Proof)')[0]?.hasAlcoholContext).toBe(true);
    // OCR-garbled "Alc./Vol." must not strip context from a correct label.
    expect(extractAbvCandidates('45% AIc.IVoI. (90 Proof)')[0]?.hasAlcoholContext).toBe(true);
  });
});

describe('origin negation scope', () => {
  it('rejects negations anywhere before the cue', () => {
    const importApp = { ...app, countryOfOrigin: 'Barbados', importerAddress: 'Harbor Spirits LLC, Baltimore, MD' };
    const text = ['BLUE HARBOR RUM', 'NOT IN ANY WAY A PRODUCT OF BARBADOS', '45% Alc./Vol. (90 Proof)', '750 mL', WARNING].join('\n');
    const finding = verifyLabel(text, importApp).find((f) => f.id === 'countryOfOrigin');
    expect(finding?.status).not.toBe('pass');
  });
});

describe('thousands separators', () => {
  it('reads "1,000 mL" as 1000 mL', () => {
    const text = ['OLD TOM DISTILLERY', 'NET CONTENTS 1,000 mL', '45% Alc./Vol. (90 Proof)', WARNING].join('\n');
    const finding = verifyLabel(text, { ...app, netContents: '1000 mL' }).find((f) => f.id === 'netContents');
    expect(finding?.status).toBe('pass');
  });
});

describe('unusable application values', () => {
  it('treats punctuation-only fields as missing data, not a match', () => {
    const text = ['OLD TOM DISTILLERY', '45% Alc./Vol. (90 Proof)', '750 mL', WARNING].join('\n');
    const findings = verifyLabel(text, { ...app, brandName: '-', classType: '??' });
    expect(findings.find((f) => f.id === 'brandName')?.status).toBe('needs_review');
    expect(findings.find((f) => f.id === 'classType')?.status).toBe('needs_review');
  });
});

// ---------------------------------------------------------------------------
// Fourth-round regressions
// ---------------------------------------------------------------------------

describe('Fourth-round regressions', () => {
  it('caps address matches with stray adjacent numeric tokens at review', () => {
    const producerText = [
      'ACME DISTILLERY',
      'Bottled by Acme Distillery',
      'Lot 5',
      '6 Main St, Reno, NV',
      '45% Alc./Vol. (90 Proof)',
      '750 mL',
      WARNING
    ].join('\n');
    const producerFinding = verifyLabel(producerText, {
      ...app,
      brandName: 'ACME DISTILLERY',
      producerAddress: 'Bottled by Acme Distillery, 5 Main St, Reno, NV'
    }).find((f) => f.id === 'producerAddress');
    expect(producerFinding?.status).toBe('warning');

    const importerText = [
      'BLUE HARBOR RUM',
      'Product of Barbados',
      'Imported by Acme Imports',
      'Lot 5',
      '6 Main St, Reno, NV',
      '45% Alc./Vol. (90 Proof)',
      '750 mL',
      WARNING
    ].join('\n');
    const importerFinding = verifyLabel(importerText, {
      ...app,
      brandName: 'BLUE HARBOR RUM',
      countryOfOrigin: 'Barbados',
      importerAddress: 'Imported by Acme Imports, 5 Main St, Reno, NV'
    }).find((f) => f.id === 'importerAddress');
    expect(importerFinding?.status).toBe('warning');
  });

  it('does not treat No. before a number as origin negation', () => {
    const importApp = { ...app, countryOfOrigin: 'Barbados', importerAddress: 'Harbor Spirits LLC, Baltimore, MD' };
    const productNumber = verifyLabel(
      ['BLUE HARBOR RUM NO. 5 PRODUCT OF BARBADOS', '45% Alc./Vol. (90 Proof)', '750 mL', WARNING].join('\n'),
      importApp
    ).find((f) => f.id === 'countryOfOrigin');
    expect(productNumber?.status).toBe('pass');

    const certificateNumber = verifyLabel(
      ['Certificate No. 123 Product of Barbados', '45% Alc./Vol. (90 Proof)', '750 mL', WARNING].join('\n'),
      importApp
    ).find((f) => f.id === 'countryOfOrigin');
    expect(certificateNumber?.status).toBe('pass');
  });

  it('extracts word-form percent ABV statements', () => {
    const candidates = extractAbvCandidates('45 percent alcohol by volume');
    expect(candidates.find((c) => c.value === 45)?.hasAlcoholContext).toBe(true);

    const text = [
      'OLD TOM DISTILLERY',
      'Kentucky Straight Bourbon Whiskey',
      '45 percent alcohol by volume',
      '750 mL',
      'Bottled by Old Tom Distillery, Louisville, KY',
      WARNING
    ].join('\n');
    const finding = verifyLabel(text, { ...app, proof: '' }).find((f) => f.id === 'alcoholContent');
    expect(finding?.status).toBe('pass');
  });

  it('matches address abbreviations with non-decimal periods stripped', () => {
    const text = [
      'GATEWAY DISTILLING',
      'Bottled by Gateway Distilling Co, St Louis, MO',
      '45% Alc./Vol. (90 Proof)',
      '750 mL',
      WARNING
    ].join('\n');
    const finding = verifyLabel(text, {
      ...app,
      brandName: 'GATEWAY DISTILLING',
      producerAddress: 'Bottled by Gateway Distilling Co., St. Louis, MO'
    }).find((f) => f.id === 'producerAddress');
    expect(finding?.status).toBe('pass');
  });

  it('prefers the all-caps warning anchor when a title-case decoy appears first', () => {
    const text = [
      'Government Warning: according to the Surgeon General text appears below',
      WARNING
    ].join('\n');
    expect(compareGovernmentWarning(text).prefixStyle).toBe('allCaps');
    const finding = verifyLabel(text, app).find((f) => f.id === 'governmentWarning');
    expect(finding?.status).toBe('pass');
  });
});
