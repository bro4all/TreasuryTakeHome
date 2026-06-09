/**
 * Exact-match comparison for the mandatory health warning statement
 * (27 CFR Part 16). The statute fixes the wording, and TTB requires the
 * "GOVERNMENT WARNING:" prefix in capital letters and bold type. OCR can
 * prove wording and capitalization; boldness still needs a human eye, so
 * findings always carry a visual-confirmation note for the pass case.
 */
import { tokensMatch } from './text';

export const STANDARD_GOVERNMENT_WARNING =
  'GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.';

export type WarningPrefixStyle = 'allCaps' | 'titleCase' | 'other' | 'missing';

export interface AlteredWord {
  expected: string;
  actual: string;
}

export interface WarningComparison {
  prefixStyle: WarningPrefixStyle;
  /** Fraction of statutory words present (exactly or as close OCR variants). */
  coverage: number;
  /** Statutory words with no counterpart in the label text. */
  missingWords: string[];
  /** Word substitutions within one or two characters of the statutory word. */
  alteredWords: AlteredWord[];
  /** Words inserted between statutory words — exact matching forbids
   * additions just as much as omissions. */
  extraWords: string[];
  /** Words butted directly against the statutory text at its boundaries:
   * immediately before the prefix on the same line, or appended after the
   * final statutory word on its closing line. These can also be OCR
   * line-merge artifacts, so they warrant review rather than rejection. */
  boundaryExtras: string[];
  /** Raw text around the warning, for evidence display. */
  snippet: string;
}

/** Words for diffing: uppercase, punctuation stripped, single chars kept. */
function diffWords(value: string): string[] {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Candidate words annotated with the source line they came from, so that
 * boundary checks can distinguish same-line appendage from following lines. */
function candidateTokens(region: string): { words: string[]; lineOf: number[] } {
  const words: string[] = [];
  const lineOf: number[] = [];
  region.split('\n').forEach((line, index) => {
    for (const word of diffWords(line)) {
      words.push(word);
      lineOf.push(index);
    }
  });
  return { words, lineOf };
}

/** Classifies the prefix AT the anchored warning, so an all-caps mention
 * elsewhere on the label cannot vouch for a title-case statement. */
function prefixStyleAt(rawText: string, anchorIndex: number): WarningPrefixStyle {
  const fromAnchor = rawText.slice(anchorIndex);
  if (/^GOVERNMENT\s+WARNING\s*:/.test(fromAnchor)) return 'allCaps';
  if (/^Government\s+Warning\s*:?/.test(fromAnchor)) return 'titleCase';
  return 'other';
}

/** Longest-common-subsequence keep/drop flags for the canonical word list. */
function lcsAlignment(canonical: string[], candidate: string[]): boolean[] {
  const rows = canonical.length;
  const cols = candidate.length;
  const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0));

  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      table[i][j] =
        canonical[i] === candidate[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const matched = new Array<boolean>(rows).fill(false);
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (canonical[i] === candidate[j]) {
      matched[i] = true;
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return matched;
}

export function compareGovernmentWarning(rawText: string): WarningComparison {
  // Compare from the warning anchor when present so unrelated label text
  // (brand, address) cannot mask missing words or supply false matches.
  // If several anchors exist, prefer the one followed by the statutory body
  // (decoy mentions like "use the GOVERNMENT WARNING: template" lack it).
  // Falls back to the "Surgeon General" clause when OCR mangles the prefix,
  // backing off a little to catch the mangled prefix words themselves.
  const anchors = [...rawText.matchAll(/government\s+warning/gi)];
  const bodyAnchors = anchors.filter((match) =>
    /surgeon\s+general/i.test(rawText.slice(match.index ?? 0, (match.index ?? 0) + 160))
  );
  const directAnchor =
    bodyAnchors.find((match) => prefixStyleAt(rawText, match.index ?? 0) === 'allCaps') ??
    bodyAnchors[0] ??
    anchors[0] ??
    null;
  const fallbackAnchor = directAnchor ? null : rawText.match(/according\s+to\s+the\s+surgeon\s+general/i);
  const prefixStyle: WarningPrefixStyle =
    directAnchor !== null ? prefixStyleAt(rawText, directAnchor.index ?? 0) : 'missing';
  const regionStart = directAnchor?.index ?? Math.max(0, (fallbackAnchor?.index ?? 0) - 60);
  const region = rawText.slice(regionStart, regionStart + STANDARD_GOVERNMENT_WARNING.length * 2);

  const canonical = diffWords(STANDARD_GOVERNMENT_WARNING);
  const { words: candidate, lineOf } = candidateTokens(region);
  const matched = lcsAlignment(canonical, candidate);

  // Pair unmatched canonical words with leftover candidate words that are a
  // small edit distance away; those are OCR misreads rather than omissions.
  const usedCandidates = new Set<number>();
  {
    let j = 0;
    for (let i = 0; i < canonical.length; i += 1) {
      if (!matched[i]) continue;
      while (j < candidate.length && candidate[j] !== canonical[i]) j += 1;
      if (j < candidate.length) {
        usedCandidates.add(j);
        j += 1;
      }
    }
  }

  const missingWords: string[] = [];
  const alteredWords: AlteredWord[] = [];
  let candidateCursor = 0;
  for (let i = 0; i < canonical.length; i += 1) {
    if (matched[i]) continue;
    let foundAlteration = false;
    for (let j = candidateCursor; j < candidate.length; j += 1) {
      if (usedCandidates.has(j)) continue;
      if (tokensMatch(candidate[j], canonical[i])) {
        alteredWords.push({ expected: canonical[i], actual: candidate[j] });
        usedCandidates.add(j);
        candidateCursor = j + 1;
        foundAlteration = true;
        break;
      }
    }
    if (!foundAlteration) missingWords.push(canonical[i]);
  }

  const present = canonical.length - missingWords.length;
  const coverage = canonical.length ? present / canonical.length : 1;

  // Words inserted between matched statutory words are alterations of the
  // mandatory text. Candidates after the last match are unrelated label text
  // (the region extends past the warning) and are not counted as insertions.
  const usedIndices = [...usedCandidates];
  const firstUsed = usedIndices.length ? Math.min(...usedIndices) : 0;
  const lastUsed = usedIndices.length ? Math.max(...usedIndices) : -1;
  const extraWords: string[] = [];
  for (let j = firstUsed; j < lastUsed; j += 1) {
    if (!usedCandidates.has(j)) extraWords.push(candidate[j]);
  }

  // Boundary checks. (a) A word butted against the prefix on the same line
  // ("STATE GOVERNMENT WARNING:") sits before the diff region and would
  // otherwise be invisible. (b) Words appended after the final statutory word
  // on its own closing line ("…health problems eventually.") would otherwise
  // be indistinguishable from the unrelated label text that follows.
  const boundaryExtras: string[] = [];
  if (directAnchor?.index !== undefined) {
    const lineStart = rawText.lastIndexOf('\n', directAnchor.index) + 1;
    const before = diffWords(rawText.slice(lineStart, directAnchor.index));
    if (before.length) boundaryExtras.push(before[before.length - 1]);
  }
  if (lastUsed >= 0) {
    for (let j = lastUsed + 1; j < candidate.length && lineOf[j] === lineOf[lastUsed]; j += 1) {
      if (!usedCandidates.has(j)) boundaryExtras.push(candidate[j]);
    }
  }

  const snippetSource = region.replace(/\s+/g, ' ').trim();
  const snippet = snippetSource
    ? snippetSource.slice(0, 220) + (snippetSource.length > 220 ? '…' : '')
    : 'No warning text found in OCR output.';

  return { prefixStyle, coverage, missingWords, alteredWords, extraWords, boundaryExtras, snippet };
}
