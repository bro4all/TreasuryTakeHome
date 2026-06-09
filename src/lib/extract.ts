/**
 * Deterministic extractors for the numeric and structured statements TTB
 * agents compare most often: alcohol content, proof, and net contents.
 * All extraction happens on normalized text (see text.ts).
 */
import { nonEmptyLines, normalizeForSearch } from './text';
import type { ApplicationData } from '../types';

const ML_PER_FL_OZ = 29.5735;

export function parseFirstNumber(value: string): number | undefined {
  const match = value.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

export interface AbvCandidate {
  value: number;
  /** Whether alcohol wording sits directly against the number — "45% Alc.",
   * "ABV 45%", "45% (90 proof)". Labels carry unrelated percentages
   * ("contains 5% juice", "made with 45% recycled glass; contains alcohol"),
   * so only adjacency counts, not a keyword anywhere on the line. */
  hasAlcoholContext: boolean;
}

/** Percent values: the lookbehind stops "100%" from also parsing as "00%". */
const PERCENT_VALUE = /(?<![\d.])(\d{1,2}(?:\.\d+)?)\s*(?:%|PERCENT\b)/g;
const ABV_PHRASE = /(?<![\d.])(\d{1,2}(?:\.\d+)?)\s*(?:ABV|ALCOHOL BY VOLUME)/g;
/** Alcohol wording within ±24 characters of the number. The tight window is
 * the adjacency constraint ("45% Alc.", "45% (90 Proof)", even OCR-garbled
 * "45% AIc.IVoI. (90 Proof)") while keywords further away on the line
 * ("…45% recycled glass; contains alcohol") stay out of reach. */
const ALCOHOL_NEARBY = /\b(?:ALC|ALCOHOL|ABV|PROOF)\b/;

/** Percent values found in the text, annotated with adjacent context. */
export function extractAbvCandidates(rawText: string): AbvCandidate[] {
  const byValue = new Map<number, AbvCandidate>();

  const consider = (value: number, hasAlcoholContext: boolean) => {
    if (!Number.isFinite(value) || value > 100) return;
    const existing = byValue.get(value);
    if (!existing) {
      byValue.set(value, { value, hasAlcoholContext });
    } else if (hasAlcoholContext && !existing.hasAlcoholContext) {
      existing.hasAlcoholContext = true;
    }
  };

  for (const line of rawText.split(/\n+/)) {
    const normalized = normalizeForSearch(line);
    if (!normalized) continue;

    for (const match of normalized.matchAll(PERCENT_VALUE)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const adjacent = ALCOHOL_NEARBY.test(normalized.slice(Math.max(0, start - 24), end + 24));
      consider(Number(match[1]), adjacent);
    }
    // "45 ABV" / "45 ALCOHOL BY VOLUME" are alcohol context by construction.
    for (const match of normalized.matchAll(ABV_PHRASE)) consider(Number(match[1]), true);
  }

  return [...byValue.values()];
}

/** All percent-style alcohol-by-volume values found in the text. */
export function extractAbvValues(rawText: string): number[] {
  return extractAbvCandidates(rawText).map((candidate) => candidate.value);
}

/** All "NN PROOF" statements found in the text. */
export function extractProofValues(rawText: string): number[] {
  const normalized = normalizeForSearch(rawText);
  return [...normalized.matchAll(/(\d{1,3}(?:\.\d+)?)\s*PROOF/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value <= 200);
}

export type VolumeUnit = 'ml' | 'l' | 'cl' | 'floz';

export interface VolumeStatement {
  ml: number;
  unit: VolumeUnit;
  /** The unit as written on the label, for evidence display. */
  source: string;
}

/** Every net-contents volume in the text, converted to milliliters. */
export function extractVolumes(rawText: string): VolumeStatement[] {
  const normalized = normalizeForSearch(rawText);
  const seen = new Map<number, VolumeStatement>();
  const add = (ml: number, unit: VolumeUnit, source: string) => {
    if (Number.isFinite(ml) && ml > 0 && !seen.has(ml)) seen.set(ml, { ml, unit, source });
  };

  for (const match of normalized.matchAll(/(\d+(?:\.\d+)?)\s*(?:ML|MILLILITERS?)\b/g)) {
    add(Number(match[1]), 'ml', `${match[1]} mL`);
  }
  for (const match of normalized.matchAll(/(\d+(?:\.\d+)?)\s*(?:CL|CENTILITERS?)\b/g)) {
    add(Number(match[1]) * 10, 'cl', `${match[1]} cL`);
  }
  for (const match of normalized.matchAll(/(\d+(?:\.\d+)?)\s*(?:L|LITERS?)\b/g)) {
    add(Number(match[1]) * 1000, 'l', `${match[1]} L`);
  }
  for (const match of normalized.matchAll(/(\d+(?:\.\d+)?)\s*FLOZ\b/g)) {
    add(Number(match[1]) * ML_PER_FL_OZ, 'floz', `${match[1]} fl oz`);
  }

  return [...seen.values()];
}

/** Bare-ounce statements ("12 OZ") that are not valid net contents but worth
 * surfacing as evidence when nothing parseable is found. FLOZ is already
 * canonicalized by normalization, so any remaining OZ is unitless. */
export function findAmbiguousOunces(rawText: string): string | undefined {
  const match = normalizeForSearch(rawText).match(/(\d+(?:\.\d+)?)\s*OZ\b/);
  return match ? `${match[1]} OZ` : undefined;
}

export interface ExpectedVolume {
  ml: number;
  unit: VolumeUnit;
}

/** The application's net-contents value converted to milliliters. */
export function expectedVolume(expected: string): ExpectedVolume | undefined {
  const normalized = normalizeForSearch(expected);
  const amount = parseFirstNumber(normalized);
  if (amount === undefined) return undefined;
  if (/\bFLOZ\b/.test(normalized)) return { ml: amount * ML_PER_FL_OZ, unit: 'floz' };
  if (/\b(?:CL|CENTILITERS?)\b/.test(normalized)) return { ml: amount * 10, unit: 'cl' };
  if (/\b(?:L|LITERS?)\b/.test(normalized) && !/\bML\b/.test(normalized)) {
    return { ml: amount * 1000, unit: 'l' };
  }
  return { ml: amount, unit: 'ml' };
}

export function expectedVolumeMl(expected: string): number | undefined {
  return expectedVolume(expected)?.ml;
}

/** Proof and ABV must agree (proof = 2 x ABV) within this many proof points. */
const PROOF_CONSISTENCY_TOLERANCE = 1;

export function proofMatchesAbv(proof: number, abv: number): boolean {
  return Math.abs(proof - abv * 2) <= PROOF_CONSISTENCY_TOLERANCE;
}

/** Deliberately narrower than verification's origin-cue list: prefill must
 * not suggest "Kentucky" from "DISTILLED IN KENTUCKY" (precision over recall;
 * the verifier in verification.ts accepts the broader cue set). */
const COUNTRY_OF_ORIGIN_PATTERN = /(?:PRODUCT OF|PRODUCED IN|MADE IN)\s+([A-Z][A-Z ]{2,40}?)(?=\s+(?:IMPORTED|BOTTLED|DISTILLED|PRODUCED|NET|GOVERNMENT|\d)|$)/;

/** Lines that are clearly statements rather than a brand name. */
const NON_BRAND_LINE =
  /GOVERNMENT|WARNING|SURGEON|NET CONTENTS|PROOF|%|\bML\b|FLOZ|BOTTLED|DISTILLED|PRODUCED|IMPORTED|PRODUCT OF/;

const CLASS_TYPE_KEYWORD =
  /\b(?:WHISKEY|WHISKY|BOURBON|RYE|GIN|VODKA|RUM|TEQUILA|MEZCAL|BRANDY|COGNAC|LIQUEUR|WINE|CHAMPAGNE|CIDER|MEAD|BEER|ALE|LAGER|STOUT|PORTER|SPIRITS?)\b/;
const PRODUCER_CUE =
  /^(?:BOTTLED BY|DISTILLED BY|PRODUCED BY|PRODUCED AND BOTTLED BY|BREWED BY|VINTED BY|MADE BY|IMPORTED BY)\b/;
const IMPORTER_CUE = /\bIMPORTED BY\b/;

function isMostlyUppercase(line: string): boolean {
  const letters = line.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 4) return false;
  const uppercase = letters.replace(/[^A-Z]/g, '');
  return uppercase.length / letters.length >= 0.8;
}

/**
 * Best-effort prefill values read from extracted label text. Only intended to
 * seed empty application fields for uploads; every suggestion still requires
 * agent review, so precision is favored over recall.
 */
export function suggestApplicationFields(rawText: string): Partial<ApplicationData> {
  const suggestion: Partial<ApplicationData> = {};
  const lines = nonEmptyLines(rawText);

  // Brand names are usually the prominent all-caps line near the top;
  // fall back to the first line that is not an obvious statement.
  const brandCandidates = lines.filter((line) => !NON_BRAND_LINE.test(normalizeForSearch(line)));
  const brandLine = brandCandidates.find(isMostlyUppercase) ?? brandCandidates[0];
  if (brandLine) {
    suggestion.brandName = brandLine;
  }

  // Class/type is usually the designation line under the brand.
  const classLine = lines.find(
    (line) => line !== brandLine && CLASS_TYPE_KEYWORD.test(normalizeForSearch(line))
  );
  if (classLine) suggestion.classType = classLine;

  const producerLine = lines.find((line) => PRODUCER_CUE.test(normalizeForSearch(line)));
  if (producerLine) suggestion.producerAddress = producerLine;

  const importerLine = lines.find((line) => IMPORTER_CUE.test(normalizeForSearch(line)));
  if (importerLine) {
    suggestion.importerAddress = importerLine.replace(/^\s*imported\s+by:?\s*/i, '').trim();
  }

  const abvCandidates = extractAbvCandidates(rawText);
  const abv = (abvCandidates.find((candidate) => candidate.hasAlcoholContext) ?? abvCandidates[0])?.value;
  if (abv !== undefined) suggestion.alcoholContent = `${abv}% Alc./Vol.`;

  const proof = extractProofValues(rawText)[0];
  if (proof !== undefined) suggestion.proof = `${proof} Proof`;

  const volume = extractVolumes(rawText)[0];
  if (volume) suggestion.netContents = volume.source;

  const originMatch = normalizeForSearch(rawText).match(COUNTRY_OF_ORIGIN_PATTERN);
  if (originMatch) {
    const country = originMatch[1].trim();
    suggestion.countryOfOrigin = country.charAt(0) + country.slice(1).toLowerCase();
  }

  return suggestion;
}
