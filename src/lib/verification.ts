/**
 * Deterministic verification rules comparing extracted label text against
 * COLA application data. Every rule returns evidence and a recommended next
 * action so agents can audit exactly why a label passed or failed.
 */
import type {
  ApplicationData,
  RequirementId,
  VerificationFinding,
  VerificationStatus,
  VerificationSummary
} from '../types';
import {
  bestWindowMatch,
  fuzzyPhraseMatch,
  lineWindows,
  NO_MATCH_EVIDENCE,
  nonEmptyLines,
  normalizeForSearch
} from './text';
import {
  extractAbvCandidates,
  extractProofValues,
  extractVolumes,
  expectedVolume,
  findAmbiguousOunces,
  parseFirstNumber,
  proofMatchesAbv
} from './extract';
import { compareGovernmentWarning } from './warning';

export { STANDARD_GOVERNMENT_WARNING } from './warning';

const DOMESTIC_ORIGINS = new Set(['UNITED STATES', 'UNITED STATES OF AMERICA', 'USA', 'US', 'U S A', 'U S', 'AMERICA']);

/** Period- and spacing-tolerant domestic check: "U.S.", "U.S.A.", "US". */
function isDomesticOrigin(country: string): boolean {
  const normalized = normalizeForSearch(country).replace(/\./g, '').replace(/\s+/g, ' ').trim();
  return DOMESTIC_ORIGINS.has(normalized);
}

/** Address statements pass only on a strong, complete match; these are
 * shared by the producer check and the importer check so they cannot drift. */
const ADDRESS_PASS_AT = 0.75;
const ADDRESS_WARN_AT = 0.5;
/** Minimum match for a country name inside an origin statement or window. */
const ORIGIN_MATCH_THRESHOLD = 0.84;

/** ABV tolerance in percentage points. TTB tolerances vary by commodity
 * (27 CFR 4.36, 5.65, 7.71); this prototype applies the strictest common
 * reading and lets agents overrule via the review queue. */
const ABV_TOLERANCE = 0.3;

function statusFromScore(score: number, passAt: number, warningAt: number): VerificationStatus {
  if (score >= passAt) return 'pass';
  if (score >= warningAt) return 'warning';
  return 'fail';
}

function makeFinding(
  id: RequirementId,
  label: string,
  status: VerificationStatus,
  confidence: number,
  expected: string,
  evidence: string,
  recommendation: string,
  details?: string[]
): VerificationFinding {
  return {
    id,
    label,
    status,
    confidence: Math.max(0, Math.min(100, Math.round(confidence))),
    expected,
    evidence,
    recommendation,
    details: details?.length ? details : undefined
  };
}

function missingFieldFinding(id: RequirementId, label: string, fieldDescription: string): VerificationFinding {
  return makeFinding(
    id,
    label,
    'needs_review',
    0,
    'Application value required.',
    `No ${fieldDescription} entered in the application form.`,
    'Enter the corresponding application field before verification.'
  );
}

function unexpectedNumericTokens(window: string, expected: string): string[] {
  const expectedNumbers = new Set(normalizeForSearch(expected).match(/\b\d+(?:\.\d+)?\b/g) ?? []);
  return (normalizeForSearch(window).match(/\b\d+(?:\.\d+)?\b/g) ?? []).filter((token) => !expectedNumbers.has(token));
}

/** Shared scoring for the phrase-shaped checks: statement-window match,
 * thresholds, and — for addresses (strictTokens) — the accounting that keeps
 * a missing city or a wrong street number from passing. */
function matchStatement(
  rawText: string,
  expected: string,
  passAt: number,
  warningAt: number,
  strictTokens: boolean
) {
  // Match within a single statement (one to three adjacent lines) so the
  // score cannot be assembled from tokens scattered across the label.
  const match = bestWindowMatch(rawText, expected);
  let status = statusFromScore(match.score, passAt, warningAt);
  // A missing token (street number, city, state) is a substantive
  // difference, so it caps the verdict at review even when the score clears.
  if (strictTokens && status === 'pass' && match.missing.length > 0) {
    status = 'warning';
  }
  const unexpectedNumbers = strictTokens ? unexpectedNumericTokens(match.window, expected) : [];
  if (status === 'pass' && unexpectedNumbers.length > 0) {
    status = 'warning';
  }
  return { match, status, unexpectedNumbers };
}

function statementEvidence(match: { score: number; window: string }): string {
  return match.score > 0 && match.window ? match.window : NO_MATCH_EVIDENCE;
}

function checkPhrase(
  id: RequirementId,
  label: string,
  rawText: string,
  expected: string,
  passAt = 0.86,
  warningAt = 0.68,
  strictTokens = false
): VerificationFinding {
  // Placeholder entries like "-" or "??" normalize to nothing and would
  // otherwise vacuously match everything.
  if (!expected.trim() || !normalizeForSearch(expected)) {
    return missingFieldFinding(id, label, `usable ${label.toLowerCase()}`);
  }

  const { match, status, unexpectedNumbers } = matchStatement(rawText, expected, passAt, warningAt, strictTokens);
  const details: string[] = [];
  if (match.missing.length) {
    details.push(`Not found on label: ${match.missing.join(', ')}`);
  }
  if (unexpectedNumbers.length) {
    details.push(`Unexpected numeric token in matched label text: ${unexpectedNumbers.join(', ')}`);
  }
  if (match.fuzzyMatched.length) {
    details.push(`Matched with OCR tolerance: ${match.fuzzyMatched.join(', ')}`);
  }

  const recommendation =
    status === 'pass'
      ? 'No action needed.'
      : status === 'warning'
        ? 'Review OCR evidence and confirm whether label wording is acceptable.'
        : 'Request corrected label artwork or update the application data.';

  return makeFinding(
    id,
    label,
    status,
    match.score * 100,
    expected,
    statementEvidence(match),
    recommendation,
    details
  );
}

function checkAlcohol(rawText: string, application: ApplicationData): VerificationFinding {
  const expectedAbv = parseFirstNumber(application.alcoholContent);
  const expectedProof = parseFirstNumber(application.proof);
  const expectedDisplay = `${application.alcoholContent}${application.proof ? ` / ${application.proof}` : ''}`;

  if (expectedAbv === undefined && expectedProof === undefined) {
    return missingFieldFinding('alcoholContent', 'Alcohol content', 'ABV or proof value');
  }

  // Labels carry unrelated percentages; only values near alcohol wording are
  // trusted. Context-free values still count, but never above "review".
  const abvCandidates = extractAbvCandidates(rawText);
  const contextAbv = abvCandidates.filter((candidate) => candidate.hasAlcoholContext);
  const usableAbv = contextAbv.length ? contextAbv : abvCandidates;
  const abvContextual = contextAbv.length > 0 || abvCandidates.length === 0;
  const abvValues = usableAbv.map((candidate) => candidate.value);
  const proofValues = extractProofValues(rawText);

  const abvMatch =
    expectedAbv !== undefined && abvValues.some((value) => Math.abs(value - expectedAbv) <= ABV_TOLERANCE);
  const proofMatch =
    expectedProof !== undefined && proofValues.some((value) => Math.abs(value - expectedProof) <= 0.5);

  const details: string[] = [];
  if (expectedAbv !== undefined && expectedProof !== undefined && !proofMatchesAbv(expectedProof, expectedAbv)) {
    details.push(
      `Application data is internally inconsistent: ${expectedProof} proof does not equal 2 × ${expectedAbv}% ABV.`
    );
  }
  const labelAbv = abvValues[0];
  const labelProof = proofValues[0];
  if (labelAbv !== undefined && labelProof !== undefined && !proofMatchesAbv(labelProof, labelAbv)) {
    details.push(
      `Label statements disagree with each other: ${labelProof} proof does not equal 2 × ${labelAbv}% ABV.`
    );
  }
  const distinctAbv = [...new Set(abvValues)];
  if (distinctAbv.length > 1) {
    details.push(`Label shows multiple alcohol percentages: ${distinctAbv.join('%, ')}%. Confirm which governs.`);
  }
  const distinctProof = [...new Set(proofValues)];
  if (distinctProof.length > 1) {
    details.push(`Label shows multiple proof statements: ${distinctProof.join(', ')}.`);
  }
  if (!abvContextual && abvMatch) {
    details.push('Matched percentage has no alcohol wording (Alc./ABV/proof) next to it; confirm it states ABV.');
  }

  const foundDisplay = `OCR found ABV [${abvValues.join(', ') || 'none'}] and proof [${proofValues.join(', ') || 'none'}].`;

  if (abvMatch && (expectedProof === undefined || proofMatch)) {
    const clean = details.length === 0;
    return makeFinding(
      'alcoholContent',
      'Alcohol content',
      clean ? 'pass' : 'warning',
      clean ? 97 : 78,
      expectedDisplay,
      foundDisplay,
      clean ? 'No action needed.' : 'Values match but need confirmation; see details.',
      details
    );
  }

  if (abvMatch || proofMatch) {
    return makeFinding(
      'alcoholContent',
      'Alcohol content',
      'warning',
      74,
      expectedDisplay,
      `Partial match. ${foundDisplay}`,
      'Review the label image and application values before issuing a rejection.',
      details
    );
  }

  return makeFinding(
    'alcoholContent',
    'Alcohol content',
    'fail',
    abvValues.length || proofValues.length ? 35 : 20,
    expectedDisplay,
    foundDisplay,
    'Request corrected label artwork or corrected alcohol content in the application.',
    details
  );
}

function checkNetContents(rawText: string, expected: string): VerificationFinding {
  const expectedVol = expectedVolume(expected);
  if (expectedVol === undefined) {
    return missingFieldFinding('netContents', 'Net contents', 'usable net contents value');
  }

  const volumes = extractVolumes(rawText);
  // Metric-to-metric comparisons are exact conversions, so the tolerance is
  // tight; fluid-ounce conversions are inexact and get a 1% allowance.
  const toleranceFor = (unit: string) =>
    unit === 'floz' || expectedVol.unit === 'floz' ? Math.max(2, expectedVol.ml * 0.01) : 2;
  const matched = volumes.find((volume) => Math.abs(volume.ml - expectedVol.ml) <= toleranceFor(volume.unit));
  const foundDisplay = volumes.length
    ? `OCR found ${volumes.map((volume) => volume.source).join(', ')}.`
    : 'No standard net contents statement (mL, cL, L, fl oz) found in OCR output.';

  if (matched) {
    return makeFinding(
      'netContents',
      'Net contents',
      'pass',
      96,
      expected,
      `${foundDisplay} Matches ${Math.round(expectedVol.ml)} mL within tolerance.`,
      'No action needed.'
    );
  }

  const ambiguousOunces = !volumes.length ? findAmbiguousOunces(rawText) : undefined;
  return makeFinding(
    'netContents',
    'Net contents',
    volumes.length ? 'warning' : 'fail',
    volumes.length ? 64 : 25,
    expected,
    ambiguousOunces ? `${foundDisplay} The label shows "${ambiguousOunces}" without a fluid-ounce unit.` : foundDisplay,
    volumes.length
      ? 'Review whether the detected volume is equivalent to the application value.'
      : 'Request label artwork that includes a standard net contents statement.',
    ambiguousOunces ? [`"${ambiguousOunces}" is not a compliant net contents unit; confirm the intended statement.`] : undefined
  );
}

function checkGovernmentWarning(rawText: string): VerificationFinding {
  const warningFinding = (
    status: VerificationStatus,
    confidence: number,
    expected: string,
    evidence: string,
    recommendation: string,
    details?: string[]
  ) => makeFinding('governmentWarning', 'Government warning', status, confidence, expected, evidence, recommendation, details);
  const STATUTORY_EXPECTED = 'Statutory warning text with all-caps prefix, word for word.';

  const comparison = compareGovernmentWarning(rawText);
  const { prefixStyle, coverage, missingWords, alteredWords, extraWords, boundaryExtras, snippet } = comparison;

  const missingDetail = missingWords.length
    ? `Missing words: ${missingWords.slice(0, 8).join(', ')}${missingWords.length > 8 ? ` (+${missingWords.length - 8} more)` : ''}`
    : undefined;
  const alteredDetail = alteredWords.length
    ? `Possible OCR misreads: ${alteredWords
        .slice(0, 6)
        .map((word) => `${word.actual} → ${word.expected}`)
        .join(', ')}`
    : undefined;
  const extraDetail = extraWords.length
    ? `Words inserted into the statutory text: ${extraWords.slice(0, 8).join(', ')}${extraWords.length > 8 ? ` (+${extraWords.length - 8} more)` : ''}`
    : undefined;
  const boundaryDetail = boundaryExtras.length
    ? `Text touches the statement boundary (${boundaryExtras.slice(0, 6).join(', ')}) — confirm the warning stands alone and unmodified.`
    : undefined;
  const details = [missingDetail, alteredDetail, extraDetail, boundaryDetail].filter(
    (item): item is string => Boolean(item)
  );

  if (prefixStyle === 'missing') {
    const partiallyPresent = coverage >= 0.5;
    return warningFinding(
      'fail',
      partiallyPresent ? coverage * 60 : 15,
      'Mandatory health warning with GOVERNMENT WARNING: prefix (27 CFR Part 16).',
      partiallyPresent ? snippet : 'No government warning text found in OCR output.',
      partiallyPresent
        ? 'Warning body detected but the GOVERNMENT WARNING: prefix was not readable. Inspect the label image.'
        : 'Request corrected artwork with the complete government health warning statement.',
      details
    );
  }

  if (prefixStyle !== 'allCaps') {
    return warningFinding(
      'fail',
      88,
      'Prefix must read GOVERNMENT WARNING: in capital letters and bold type.',
      snippet,
      'Reject or request corrected artwork: the warning prefix is not in the required capital letters.',
      details
    );
  }

  // Exact-match policy: insertions are deviations just like omissions.
  // Single stray 1-2 character "words" are typical OCR artifacts (specks read
  // as letters) and downgrade to review rather than a hard fail. Boundary
  // appendages can be OCR line merges, so they cap at review too.
  const substantiveExtras = extraWords.filter((word) => word.length >= 3);

  if (
    missingWords.length === 0 &&
    alteredWords.length === 0 &&
    extraWords.length === 0 &&
    boundaryExtras.length === 0
  ) {
    return warningFinding(
      'pass',
      96,
      STATUTORY_EXPECTED,
      snippet,
      'Wording and capitalization verified word for word.',
      ['Manual check: OCR cannot prove boldness — visually confirm the GOVERNMENT WARNING: prefix is bold.']
    );
  }

  if (substantiveExtras.length > 0) {
    return warningFinding(
      'fail',
      85,
      STATUTORY_EXPECTED,
      snippet,
      'The warning contains words that are not part of the statutory text. Request corrected artwork.',
      details
    );
  }

  if (missingWords.length === 0 && alteredWords.length === 0 && extraWords.length === 0 && boundaryExtras.length > 0) {
    return warningFinding(
      'warning',
      82,
      STATUTORY_EXPECTED,
      snippet,
      'The statutory wording is present, but adjacent text touches it. Inspect the label to confirm the statement stands alone.',
      details
    );
  }

  if (missingWords.length === 0 && alteredWords.length <= 3) {
    return warningFinding(
      'warning',
      80,
      STATUTORY_EXPECTED,
      snippet,
      'All words accounted for, but some look like OCR artifacts. Zoom the label image to confirm exact wording.',
      details
    );
  }

  return makeFinding(
    'governmentWarning',
    'Government warning',
    'fail',
    Math.min(70, coverage * 100),
    STATUTORY_EXPECTED,
    snippet,
    'Warning text deviates from the statutory wording. Request corrected artwork.',
    details
  );
}

function checkCountryOfOrigin(rawText: string, application: ApplicationData): VerificationFinding {
  const normalizedCountry = normalizeForSearch(application.countryOfOrigin);
  if (!normalizedCountry) {
    return makeFinding(
      'countryOfOrigin',
      'Country of origin',
      'needs_review',
      0,
      'Country of origin field required.',
      'No country of origin entered in the application form.',
      'Enter a country of origin or confirm that this field is unavailable.'
    );
  }

  if (isDomesticOrigin(application.countryOfOrigin)) {
    return makeFinding(
      'countryOfOrigin',
      'Country of origin',
      'pass',
      90,
      'Required for imports; domestic application detected.',
      'Application country is domestic, so import origin display is not required by this prototype rule.',
      'No action needed.'
    );
  }

  // An import must carry an origin *statement*, not merely the country name
  // somewhere on the label (class designations like "Aged Barbados Rum"
  // contain country words without declaring origin). Statements may wrap, so
  // adjacent line pairs are considered; negated cues ("NOT a product of…")
  // do not qualify.
  const ORIGIN_CUE = /\b(?:PRODUCT OF|PRODUCED IN|MADE IN|IMPORTED FROM|BOTTLED IN|DISTILLED IN)\b/;
  const cueWindows = lineWindows(nonEmptyLines(rawText), 2);

  let bestCueScore = -1;
  let bestCueLine = '';
  for (const window of cueWindows) {
    const normalizedWindow = normalizeForSearch(window);
    const cueIndex = normalizedWindow.search(ORIGIN_CUE);
    if (cueIndex === -1) continue;
    // "NOT (in any way) a product of …" — any negation before the cue voids it.
    const beforeCue = normalizedWindow.slice(0, cueIndex);
    if (/\b(?:NOT|NEVER)\b/.test(beforeCue) || /\bNO\b(?!\s+\d)/.test(beforeCue)) continue;
    const match = fuzzyPhraseMatch(window, application.countryOfOrigin);
    if (match.score > bestCueScore || (match.score === bestCueScore && window.length < bestCueLine.length)) {
      bestCueScore = match.score;
      bestCueLine = window;
    }
  }

  if (bestCueScore >= ORIGIN_MATCH_THRESHOLD) {
    return makeFinding(
      'countryOfOrigin',
      'Country of origin',
      'pass',
      bestCueScore * 100,
      application.countryOfOrigin,
      bestCueLine,
      'No action needed.'
    );
  }

  // No qualifying origin statement; does the country at least appear somewhere?
  const anywhere = bestWindowMatch(rawText, application.countryOfOrigin);
  if (anywhere.score >= ORIGIN_MATCH_THRESHOLD) {
    return makeFinding(
      'countryOfOrigin',
      'Country of origin',
      'warning',
      62,
      application.countryOfOrigin,
      anywhere.window,
      'Country name appears, but no origin statement (e.g. "Product of …") was found. Confirm the label declares origin.',
      ['No "Product of / Produced in / Made in" statement detected.']
    );
  }

  // A cue line exists but names a different country — stronger evidence for
  // rejection than "nothing found", and the evidence must say so.
  return makeFinding(
    'countryOfOrigin',
    'Country of origin',
    'fail',
    Math.max(0, anywhere.score) * 60,
    application.countryOfOrigin,
    bestCueLine || 'No origin statement found in OCR output.',
    bestCueLine
      ? 'The origin statement on the label does not match the application country. Request corrected artwork or data.'
      : 'Imported products must show country of origin; review or request corrected artwork.',
    anywhere.missing.length ? [`Not found on label: ${anywhere.missing.join(', ')}`] : undefined
  );
}

function checkImporterAddress(rawText: string, application: ApplicationData): VerificationFinding {
  const normalizedCountry = normalizeForSearch(application.countryOfOrigin);

  if (!normalizedCountry) {
    return makeFinding(
      'importerAddress',
      'Importer address',
      'needs_review',
      0,
      'Country of origin is required to determine whether importer address applies.',
      'No country of origin entered in the application form.',
      'Enter country of origin before completing importer-address verification.'
    );
  }

  if (isDomesticOrigin(application.countryOfOrigin)) {
    return makeFinding(
      'importerAddress',
      'Importer address',
      'pass',
      90,
      'Required for imports; domestic application detected.',
      'Application country is domestic, so importer address display is not required by this prototype rule.',
      'No action needed.'
    );
  }

  if (!application.importerAddress.trim()) {
    return makeFinding(
      'importerAddress',
      'Importer address',
      'needs_review',
      0,
      'Importer address required for imported products.',
      'No importer address entered in the application form.',
      'Enter the importer address from the application before verification.'
    );
  }

  const { match, status, unexpectedNumbers } = matchStatement(
    rawText,
    application.importerAddress,
    ADDRESS_PASS_AT,
    ADDRESS_WARN_AT,
    true
  );

  return makeFinding(
    'importerAddress',
    'Importer address',
    status,
    match.score * 100,
    application.importerAddress,
    statementEvidence(match),
    status === 'pass'
      ? 'No action needed.'
      : status === 'warning'
        ? 'Review whether the importer address on the label matches the application.'
        : 'Imported products should show the application importer address; request corrected artwork or data.',
    [
      match.missing.length ? `Not found on label: ${match.missing.join(', ')}` : undefined,
      unexpectedNumbers.length
        ? `Unexpected numeric token in matched label text: ${unexpectedNumbers.join(', ')}`
        : undefined
    ].filter((detail): detail is string => Boolean(detail))
  );
}

export function summarizeFindings(findings: VerificationFinding[]): VerificationSummary {
  const passed = findings.filter((finding) => finding.status === 'pass').length;
  const warnings = findings.filter((finding) => finding.status === 'warning').length;
  const failed = findings.filter((finding) => finding.status === 'fail').length;
  const needsReview = findings.filter((finding) => finding.status === 'needs_review').length;

  // Score over checks that actually ran; unfilled fields should not deflate it.
  const scored = findings.filter((finding) => finding.status !== 'needs_review');
  const score = scored.length
    ? Math.round(scored.reduce((total, finding) => total + finding.confidence, 0) / scored.length)
    : 0;

  let status: VerificationStatus = 'pass';
  if (failed > 0) status = 'fail';
  else if (warnings > 0) status = 'warning';
  else if (needsReview > 0) status = 'needs_review';

  return { status, score, passed, warnings, failed, needsReview };
}

export function verifyLabel(rawText: string, application: ApplicationData): VerificationFinding[] {
  const safeText = rawText.trim();
  if (!safeText) {
    return [
      makeFinding(
        'readableText',
        'Readable label text',
        'needs_review',
        0,
        'OCR or pasted text is required before verification.',
        'No extracted text available.',
        'Run OCR on the image or paste readable label text into the extracted text panel.'
      )
    ];
  }

  return [
    checkPhrase('brandName', 'Brand name', safeText, application.brandName),
    checkPhrase('classType', 'Class/type', safeText, application.classType, 0.82, 0.6),
    checkAlcohol(safeText, application),
    checkNetContents(safeText, application.netContents),
    checkPhrase('producerAddress', 'Producer/bottler address', safeText, application.producerAddress, ADDRESS_PASS_AT, ADDRESS_WARN_AT, true),
    checkCountryOfOrigin(safeText, application),
    checkImporterAddress(safeText, application),
    checkGovernmentWarning(safeText)
  ];
}
