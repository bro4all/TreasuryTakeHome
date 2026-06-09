/** Human-friendly duration for run-time displays. Sub-100ms runs (text-only
 * re-verification) read as a glitchy "0.0 s" otherwise. */
export function formatDurationMs(ms: number): string {
  if (ms < 100) return 'under 0.1 s';
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Run time to display for a record: OCR-inclusive time wins over a later
 * text-only re-verification, so the 5-second-target reading stays honest. */
export function displayRunMs(record: { lastOcrMs?: number; lastRunMs?: number }): number | undefined {
  return record.lastOcrMs ?? record.lastRunMs;
}
