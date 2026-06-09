/**
 * Batch report export. Produces a flat CSV (one row per finding) that opens
 * cleanly in Excel, plus a small download helper.
 */
import { displayRunMs } from './format';
import type { LabelRecord } from '../types';

const CSV_HEADER = [
  'Application ID',
  'File name',
  'Overall status',
  'Match score (%)',
  'Requirement',
  'Finding',
  'Confidence (%)',
  'Expected',
  'Evidence',
  'Next action',
  'Details',
  'Run time (ms)'
];

export function csvEscape(value: string): string {
  // Neutralize spreadsheet formula injection: cells starting with =, +, -, @
  // (or tab/CR) would otherwise execute as formulas when opened in Excel.
  const neutralized = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  const needsQuotes = /[",\n\r]/.test(neutralized);
  const escaped = neutralized.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

export function findingsToCsv(records: LabelRecord[]): string {
  const rows: string[][] = [CSV_HEADER];

  for (const record of records) {
    if (!record.findings.length) {
      rows.push([
        record.applicationId,
        record.fileName,
        'not run',
        '',
        '',
        '',
        '',
        '',
        '',
        'Run verification before exporting.',
        '',
        ''
      ]);
      continue;
    }
    for (const finding of record.findings) {
      rows.push([
        record.applicationId,
        record.fileName,
        record.summary?.status ?? 'not run',
        record.summary ? String(record.summary.score) : '',
        finding.label,
        finding.status,
        String(finding.confidence),
        finding.expected,
        finding.evidence,
        finding.recommendation,
        finding.details?.join(' | ') ?? '',
        displayRunMs(record) !== undefined ? String(displayRunMs(record)) : ''
      ]);
    }
  }

  // BOM keeps Excel from misreading UTF-8.
  return `${'\uFEFF'}${rows.map((row) => row.map(csvEscape).join(',')).join('\r\n')}\r\n`;
}

export function downloadTextFile(fileName: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  // Firefox only honors clicks on anchors that are in the document.
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
