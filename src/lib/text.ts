/**
 * Text normalization and OCR-tolerant fuzzy matching primitives.
 *
 * OCR output from photographed labels contains predictable noise: swapped
 * glyphs (O/0, I/1, S/5), dropped punctuation, and merged whitespace. The
 * matchers here tolerate small character-level errors in words while never
 * fuzzy-matching numeric tokens, since "45" vs "46" is a substantive
 * difference on an alcohol label.
 */

/** Uppercases, strips accents/punctuation, and expands common label abbreviations. */
export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/(\d),(?=\d{3}\b)/g, '$1') // thousands separators: 1,000 -> 1000
    .replace(/&/g, ' AND ')
    .toUpperCase()
    .replace(/ALC\.?\s*\/\s*VOL\.?/g, 'ALCOHOL BY VOLUME')
    .replace(/\bM\s*L\b(?!\s+[A-Z0-9]\b)/g, 'ML')
    .replace(/\bFL\.?\s*OZ\b\.?/g, 'FLOZ')
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/[^A-Z0-9.%/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits normalized text into comparison tokens. Single letters are OCR
 * noise and dropped; single digits are substantive ("5 Main St"). */
function tokenize(value: string): string[] {
  return normalizeForSearch(value)
    .split(' ')
    .filter((token) => token.length > 1 || /\d/.test(token));
}

/** Token-bounded substring test: "ACE" must not match inside "SPACE". */
function containsPhrase(normalizedText: string, normalizedTarget: string): boolean {
  return ` ${normalizedText} `.includes(` ${normalizedTarget} `);
}

/** Trimmed, non-empty lines of an OCR text block. */
export function nonEmptyLines(rawText: string): string[] {
  return rawText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Single lines plus joined runs of adjacent lines, up to maxSpan long —
 * the candidate "statements" a wrapped label statement can occupy. Singles
 * come first so equal scores resolve to the most specific window. */
export function lineWindows(lines: string[], maxSpan: number): string[] {
  const windows: string[] = [...lines];
  for (let span = 2; span <= maxSpan; span += 1) {
    for (let i = 0; i + span <= lines.length; i += 1) {
      windows.push(lines.slice(i, i + span).join(' '));
    }
  }
  return windows;
}

export const NO_MATCH_EVIDENCE = 'No clear matching text found in OCR output.';

/** Classic Levenshtein edit distance with an early-exit cap. */
export function levenshtein(a: string, b: string, max = Number.POSITIVE_INFINITY): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > max) return max + 1;
    [previous, current] = [current, previous];
  }

  return previous[b.length];
}

const hasDigit = /\d/;

/** Edit distance allowed for a fuzzy token match, scaled by token length. */
export function allowedEditDistance(token: string): number {
  if (hasDigit.test(token)) return 0; // numbers must match exactly
  if (token.length >= 8) return 2;
  if (token.length >= 5) return 1;
  return 0;
}

/** Whether an OCR token should be treated as the same word as a target token. */
export function tokensMatch(candidate: string, target: string): boolean {
  if (candidate === target) return true;
  const allowance = Math.min(allowedEditDistance(candidate), allowedEditDistance(target));
  if (allowance === 0) return false;
  return levenshtein(candidate, target, allowance) <= allowance;
}

export interface CoverageResult {
  /** Fraction of target tokens found in the text (0..1). */
  score: number;
  /** Target tokens with no exact or fuzzy counterpart in the text. */
  missing: string[];
  /** Target tokens matched only via fuzzy comparison (possible OCR noise). */
  fuzzyMatched: string[];
}

/** Token-level coverage of `target` within `text`, tolerant of OCR misreads.
 * Production reaches this only as fuzzyPhraseMatch's fallback; the windowed
 * checks use orderedCoverage, which also enforces word order and density. */
export function phraseCoverage(text: string, target: string): CoverageResult {
  const targetTokens = tokenize(target);
  if (targetTokens.length === 0) return { score: 1, missing: [], fuzzyMatched: [] };

  const textTokens = tokenize(text);
  const textTokenSet = new Set(textTokens);
  const missing: string[] = [];
  const fuzzyMatched: string[] = [];
  let matches = 0;

  for (const token of targetTokens) {
    if (textTokenSet.has(token)) {
      matches += 1;
      continue;
    }
    const fuzzyHit = textTokens.some((candidate) => tokensMatch(candidate, token));
    if (fuzzyHit) {
      matches += 1;
      fuzzyMatched.push(token);
    } else {
      missing.push(token);
    }
  }

  return { score: matches / targetTokens.length, missing, fuzzyMatched };
}

/** Phrase match score: 1 for an exact normalized substring, else token coverage. */
export function fuzzyPhraseMatch(text: string, target: string): CoverageResult {
  const normalizedTarget = normalizeForSearch(target);
  if (!normalizedTarget) return { score: 1, missing: [], fuzzyMatched: [] };
  if (containsPhrase(normalizeForSearch(text), normalizedTarget)) {
    return { score: 1, missing: [], fuzzyMatched: [] };
  }
  return phraseCoverage(text, target);
}

/**
 * Order-aware coverage with a compactness penalty: the score reflects the
 * longest subsequence of target tokens appearing in the text in the same
 * order (fuzzy per-token, numbers exact), discounted when the matched tokens
 * are spread across interleaving words. Bag-of-words coverage lets "KENTUCKY
 * WHISKEY, STRAIGHT FROM THE BOURBON TRAIL" satisfy "Kentucky Straight
 * Bourbon Whiskey"; ordered matching does not — and the density discount
 * stops in-order tokens scattered across a window ("HARBOR SPIRITS …
 * Coastal Cargo LLC, Baltimore, MD") from scoring as one statement.
 */
export function orderedCoverage(text: string, target: string): CoverageResult {
  const targetTokens = tokenize(target);
  if (targetTokens.length === 0) return { score: 1, missing: [], fuzzyMatched: [] };
  const textTokens = tokenize(text);

  const rows = textTokens.length;
  const cols = targetTokens.length;
  const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0));
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      table[i][j] = tokensMatch(textTokens[i], targetTokens[j])
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const matched = new Array<boolean>(cols).fill(false);
  const fuzzyMatched: string[] = [];
  let firstHit = -1;
  let lastHit = -1;
  let hits = 0;
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (tokensMatch(textTokens[i], targetTokens[j])) {
      matched[j] = true;
      if (textTokens[i] !== targetTokens[j]) fuzzyMatched.push(targetTokens[j]);
      if (firstHit === -1) firstHit = i;
      lastHit = i;
      hits += 1;
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }

  const missing = targetTokens.filter((_, index) => !matched[index]);
  const coverage = (cols - missing.length) / cols;
  const span = hits > 0 ? lastHit - firstHit + 1 : 0;
  const density = hits > 0 ? hits / span : 0;
  return { score: coverage * Math.sqrt(density), missing, fuzzyMatched };
}

export interface WindowMatchResult extends CoverageResult {
  /** The line(s) that produced the best score, for evidence display. */
  window: string;
}

/**
 * Phrase match constrained to one statement: the target must be covered, in
 * order, by one to three adjacent lines (label statements wrap, and stacked
 * typography puts one word per line). This prevents a match being assembled
 * from tokens scattered across unrelated parts of the label — e.g. the brand
 * line supplying half of a producer address that names a different producer —
 * and the ordered scoring stops bag-of-words rearrangements within a window.
 */
export function bestWindowMatch(rawText: string, target: string): WindowMatchResult {
  const normalizedTarget = normalizeForSearch(target);
  if (!normalizedTarget) return { score: 1, missing: [], fuzzyMatched: [], window: '' };

  let lines = nonEmptyLines(rawText);

  // Pasted text sometimes arrives with newlines stripped; a single giant
  // "line" would defeat statement-level matching, so fall back to sentence
  // segmentation.
  if (lines.length === 1 && tokenize(lines[0]).length > 24) {
    lines = lines[0]
      .split(/(?<=[.;!?])\s+/)
      .map((segment) => segment.trim())
      .filter(Boolean);
  }

  if (lines.length === 0) {
    return { score: 0, missing: tokenize(target), fuzzyMatched: [], window: '' };
  }

  const windows = lineWindows(lines, 3);

  let best: WindowMatchResult = { score: -1, missing: [], fuzzyMatched: [], window: '' };
  for (const window of windows) {
    const coverage = containsPhrase(normalizeForSearch(window), normalizedTarget)
      ? { score: 1, missing: [] as string[], fuzzyMatched: [] as string[] }
      : orderedCoverage(window, target);
    // Prefer higher scores; on ties prefer the shorter (more specific) window.
    if (
      coverage.score > best.score ||
      (coverage.score === best.score && window.length < best.window.length)
    ) {
      best = { ...coverage, window };
    }
  }

  return best;
}
