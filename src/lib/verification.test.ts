import { expect, it } from 'vitest';
import { STANDARD_GOVERNMENT_WARNING, summarizeFindings, verifyLabel } from './verification';
import type { ApplicationData } from '../types';

const baseApplication: ApplicationData = {
  id: 'COLA-26-10492',
  brandName: "Stone's Throw",
  classType: 'Kentucky Straight Bourbon Whiskey',
  alcoholContent: '45% Alc./Vol.',
  proof: '90 Proof',
  netContents: '750 mL',
  producerAddress: 'Bottled by Old Tom Distillery, Louisville, KY',
  countryOfOrigin: 'United States',
  importerAddress: ''
};

it('treats punctuation and casing differences as the same brand', () => {
  const findings = verifyLabel(
    `
    STONE'S THROW
    Kentucky Straight Bourbon Whiskey
    45% Alc./Vol. (90 Proof)
    750 mL
    Bottled by Old Tom Distillery, Louisville, KY
    ${STANDARD_GOVERNMENT_WARNING}
    `,
    baseApplication
  );

  expect(findings.find((finding) => finding.id === 'brandName')?.status).toBe('pass');
  expect(summarizeFindings(findings).failed).toBe(0);
});

it('fails the alcohol content check when ABV and proof disagree with the application', () => {
  const findings = verifyLabel(
    `
    Stone's Throw
    Kentucky Straight Bourbon Whiskey
    47% Alc./Vol. (94 Proof)
    750 mL
    Bottled by Old Tom Distillery, Louisville, KY
    ${STANDARD_GOVERNMENT_WARNING}
    `,
    baseApplication
  );

  expect(findings.find((finding) => finding.id === 'alcoholContent')?.status).toBe('fail');
});

it('fails the government warning when the prefix is title case', () => {
  const badWarning = STANDARD_GOVERNMENT_WARNING.replace('GOVERNMENT WARNING:', 'Government Warning:');
  const findings = verifyLabel(
    `
    Stone's Throw
    Kentucky Straight Bourbon Whiskey
    45% Alc./Vol. (90 Proof)
    750 mL
    Bottled by Old Tom Distillery, Louisville, KY
    ${badWarning}
    `,
    baseApplication
  );

  expect(findings.find((finding) => finding.id === 'governmentWarning')?.status).toBe('fail');
});

it('requires country of origin text for imported products', () => {
  const findings = verifyLabel(
    `
    Blue Harbor Rum
    Aged Rum
    40% Alc./Vol. (80 Proof)
    750 mL
    Imported by Harbor Spirits, Baltimore, MD
    ${STANDARD_GOVERNMENT_WARNING}
    `,
    {
      ...baseApplication,
      brandName: 'Blue Harbor Rum',
      classType: 'Aged Rum',
      alcoholContent: '40% Alc./Vol.',
      proof: '80 Proof',
      producerAddress: 'Imported by Harbor Spirits, Baltimore, MD',
      countryOfOrigin: 'Barbados'
    }
  );

  expect(findings.find((finding) => finding.id === 'countryOfOrigin')?.status).toBe('fail');
});

it('checks importer address separately for imported products', () => {
  const findings = verifyLabel(
    `
    Blue Harbor Rum
    Aged Barbados Rum
    40% Alc./Vol. (80 Proof)
    Net Contents 750 mL
    Imported by Harbor Spirits LLC, Baltimore, MD
    Product of Barbados
    ${STANDARD_GOVERNMENT_WARNING}
    `,
    {
      ...baseApplication,
      brandName: 'Blue Harbor Rum',
      classType: 'Aged Barbados Rum',
      alcoholContent: '40% Alc./Vol.',
      proof: '80 Proof',
      producerAddress: 'Imported by Harbor Spirits LLC, Baltimore, MD',
      countryOfOrigin: 'Barbados',
      importerAddress: 'Harbor Spirits LLC, Baltimore, MD'
    }
  );

  expect(findings.find((finding) => finding.id === 'countryOfOrigin')?.status).toBe('pass');
  expect(findings.find((finding) => finding.id === 'importerAddress')?.status).toBe('pass');
});

it('tolerates letter-level OCR misreads in brand and class/type', () => {
  const findings = verifyLabel(
    `
    STONEZ THROW
    Kentucky Straight Bourbon Whiskev
    45% Alc./Vol. (90 Proof)
    750 mL
    Bottled by Old Tom Distillery, Louisville, KY
    ${STANDARD_GOVERNMENT_WARNING}
    `,
    baseApplication
  );

  expect(findings.find((finding) => finding.id === 'brandName')?.status).toBe('pass');
  const classType = findings.find((finding) => finding.id === 'classType');
  expect(classType?.status).toBe('pass');
  expect(classType?.details?.join(' ')).toContain('OCR tolerance');
});

it('matches net contents across units (fl oz application, mL label)', () => {
  const findings = verifyLabel(
    `
    Stone's Throw
    Kentucky Straight Bourbon Whiskey
    45% Alc./Vol. (90 Proof)
    355 mL
    Bottled by Old Tom Distillery, Louisville, KY
    ${STANDARD_GOVERNMENT_WARNING}
    `,
    { ...baseApplication, netContents: '12 fl oz' }
  );

  expect(findings.find((finding) => finding.id === 'netContents')?.status).toBe('pass');
});

it('downgrades matching alcohol values when ABV and proof disagree internally', () => {
  const findings = verifyLabel(
    `
    Stone's Throw
    Kentucky Straight Bourbon Whiskey
    45% Alc./Vol. (94 Proof)
    750 mL
    Bottled by Old Tom Distillery, Louisville, KY
    ${STANDARD_GOVERNMENT_WARNING}
    `,
    { ...baseApplication, proof: '94 Proof' }
  );

  const alcohol = findings.find((finding) => finding.id === 'alcoholContent');
  expect(alcohol?.status).toBe('warning');
  expect(alcohol?.details?.join(' ')).toContain('inconsistent');
});

it('asks for text before verifying anything', () => {
  const findings = verifyLabel('   ', baseApplication);
  expect(findings).toHaveLength(1);
  expect(findings[0].id).toBe('readableText');
  expect(findings[0].status).toBe('needs_review');
});

it('flags warnings with OCR-level misreads for manual review instead of failing', () => {
  const noisyWarning = STANDARD_GOVERNMENT_WARNING.replace('machinery', 'machinerv');
  const findings = verifyLabel(
    `
    Stone's Throw
    Kentucky Straight Bourbon Whiskey
    45% Alc./Vol. (90 Proof)
    750 mL
    Bottled by Old Tom Distillery, Louisville, KY
    ${noisyWarning}
    `,
    baseApplication
  );

  const warning = findings.find((finding) => finding.id === 'governmentWarning');
  expect(warning?.status).toBe('warning');
  expect(warning?.details?.join(' ')).toContain('MACHINERY');
});

it('excludes unfilled checks from the summary score', () => {
  const findings = verifyLabel('OLD TOM DISTILLERY', {
    ...baseApplication,
    brandName: 'OLD TOM DISTILLERY',
    classType: '',
    alcoholContent: '',
    proof: '',
    netContents: '',
    producerAddress: ''
  });

  const summary = summarizeFindings(findings);
  expect(summary.needsReview).toBeGreaterThan(0);
  // The brand passed at 100%; needs_review rows must not drag the score down.
  expect(summary.score).toBeGreaterThan(50);
});

it('requires importer address application data for imported products', () => {
  const findings = verifyLabel(
    `
    Blue Harbor Rum
    Aged Barbados Rum
    40% Alc./Vol. (80 Proof)
    Net Contents 750 mL
    Imported by Harbor Spirits LLC, Baltimore, MD
    Product of Barbados
    ${STANDARD_GOVERNMENT_WARNING}
    `,
    {
      ...baseApplication,
      brandName: 'Blue Harbor Rum',
      classType: 'Aged Barbados Rum',
      alcoholContent: '40% Alc./Vol.',
      proof: '80 Proof',
      producerAddress: 'Imported by Harbor Spirits LLC, Baltimore, MD',
      countryOfOrigin: 'Barbados',
      importerAddress: ''
    }
  );

  expect(findings.find((finding) => finding.id === 'importerAddress')?.status).toBe('needs_review');
});
