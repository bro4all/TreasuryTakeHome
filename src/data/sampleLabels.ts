import type { ApplicationData, LabelRecord } from '../types';
import { STANDARD_GOVERNMENT_WARNING, summarizeFindings, verifyLabel } from '../lib/verification';

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/** Hard word-wrap for SVG <text> rendering (no foreignObject: it taints the
 * canvas in some browsers, which would block real OCR on the sample images). */
function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function labelSvg(title: string, subtitle: string, lines: string[], warningPrefix = 'GOVERNMENT WARNING:'): string {
  const warningBody = STANDARD_GOVERNMENT_WARNING.replace('GOVERNMENT WARNING:', '').trim();
  const detailLines = lines.map(
    (line, index) => `<text x="100" y="${252 + index * 36}" class="detail">${escapeSvg(line)}</text>`
  );
  const warningLines = wrapText(warningBody, 52).map(
    (line, index) => `<text x="100" y="${586 + index * 36}" class="warningText">${escapeSvg(line)}</text>`
  );

  return svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="900" height="1180" viewBox="0 0 900 1180">
      <defs>
        <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#fffdf7"/>
          <stop offset="1" stop-color="#f3f0e6"/>
        </linearGradient>
      </defs>
      <rect width="900" height="1180" fill="#172033"/>
      <rect x="38" y="38" width="824" height="1104" rx="18" fill="url(#paper)" stroke="#d2c39c" stroke-width="6"/>
      <rect x="66" y="70" width="768" height="1040" rx="10" fill="none" stroke="#25334f" stroke-width="3"/>
      <text x="450" y="150" class="brand" text-anchor="middle">${escapeSvg(title)}</text>
      <text x="450" y="190" class="subtitle" text-anchor="middle">${escapeSvg(subtitle)}</text>
      <line x1="124" y1="210" x2="776" y2="210" stroke="#25334f" stroke-width="2"/>
      ${detailLines.join('')}
      <text x="100" y="540" class="warningTitle">${escapeSvg(warningPrefix)}</text>
      ${warningLines.join('')}
      <text x="450" y="1045" class="footer" text-anchor="middle">Certificate label artwork sample</text>
      <style>
        .brand { font: 700 58px Georgia, serif; fill: #172033; letter-spacing: 0; }
        .subtitle { font: 500 25px Arial, sans-serif; fill: #5a4636; letter-spacing: 0; }
        .detail { font: 500 31px Arial, sans-serif; fill: #172033; letter-spacing: 0; }
        .warningTitle { font: 800 28px Arial, sans-serif; fill: #111827; letter-spacing: 0; }
        .warningText { font: 600 27px Arial, sans-serif; fill: #111827; letter-spacing: 0; }
        .footer { font: 500 22px Arial, sans-serif; fill: #536070; letter-spacing: 0; }
      </style>
    </svg>
  `);
}

function escapeSvg(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface SampleSpec {
  id: string;
  fileName: string;
  agency: string;
  priority: LabelRecord['priority'];
  submittedAt: string;
  subtitle: string;
  detailLines: string[];
  warningPrefix?: string;
  /** Brand as printed on the artwork, when it differs from the application. */
  labelBrand?: string;
  application: ApplicationData;
}

function buildSample(spec: SampleSpec): LabelRecord {
  const warningPrefix = spec.warningPrefix ?? 'GOVERNMENT WARNING:';
  const warning = STANDARD_GOVERNMENT_WARNING.replace('GOVERNMENT WARNING:', warningPrefix);
  const labelBrand = spec.labelBrand ?? spec.application.brandName;
  const labelText = [labelBrand, spec.subtitle, ...spec.detailLines, warning].join('\n');
  const findings = verifyLabel(labelText, spec.application);

  return {
    id: spec.id,
    fileName: spec.fileName,
    applicationId: spec.application.id,
    agency: spec.agency,
    priority: spec.priority,
    submittedAt: spec.submittedAt,
    source: 'sample',
    imageUrl: labelSvg(labelBrand, spec.subtitle, spec.detailLines, warningPrefix),
    ocrText: labelText,
    ocrStatus: 'complete',
    ocrProgress: 1,
    ocrMessage: 'Sample text preloaded — use Run OCR to read the artwork for real',
    application: spec.application,
    findings,
    summary: summarizeFindings(findings)
  };
}

export const sampleLabels: LabelRecord[] = [
  buildSample({
    id: 'sample-1',
    fileName: 'old-tom-distillery-front.svg',
    agency: 'Louisville Spirits Co.',
    priority: 'Standard',
    submittedAt: '2026-05-28',
    subtitle: 'Kentucky Straight Bourbon Whiskey',
    detailLines: [
      '45% Alc./Vol. (90 Proof)',
      'Net Contents 750 mL',
      'Bottled by Old Tom Distillery, Louisville, KY'
    ],
    application: {
      id: 'COLA-26-10492',
      brandName: 'OLD TOM DISTILLERY',
      classType: 'Kentucky Straight Bourbon Whiskey',
      alcoholContent: '45% Alc./Vol.',
      proof: '90 Proof',
      netContents: '750 mL',
      producerAddress: 'Bottled by Old Tom Distillery, Louisville, KY',
      countryOfOrigin: 'United States',
      importerAddress: ''
    }
  }),
  buildSample({
    id: 'sample-2',
    fileName: 'stones-throw-back.svg',
    agency: 'Red Barn Import Group',
    priority: 'Importer batch',
    submittedAt: '2026-06-01',
    subtitle: 'Kentucky Straight Bourbon Whiskey',
    detailLines: [
      '45% Alc./Vol. (90 Proof)',
      '750 mL',
      'Bottled by Red Barn Distilling, Bardstown, KY'
    ],
    labelBrand: "STONE'S THROW",
    application: {
      id: 'COLA-26-10503',
      brandName: "Stone's Throw",
      classType: 'Kentucky Straight Bourbon Whiskey',
      alcoholContent: '45% Alc./Vol.',
      proof: '90 Proof',
      netContents: '750 mL',
      producerAddress: 'Bottled by Red Barn Distilling, Bardstown, KY',
      countryOfOrigin: 'United States',
      importerAddress: ''
    }
  }),
  buildSample({
    id: 'sample-3',
    fileName: 'blue-harbor-import.svg',
    agency: 'Harbor Spirits LLC',
    priority: 'Rush',
    submittedAt: '2026-06-03',
    subtitle: 'Aged Barbados Rum',
    detailLines: [
      '40% Alc./Vol. (80 Proof)',
      'Net Contents 750 mL',
      'Imported by Harbor Spirits LLC, Baltimore, MD',
      'Product of Barbados'
    ],
    application: {
      id: 'COLA-26-10547',
      brandName: 'BLUE HARBOR RUM',
      classType: 'Aged Barbados Rum',
      alcoholContent: '40% Alc./Vol.',
      proof: '80 Proof',
      netContents: '750 mL',
      producerAddress: 'Imported by Harbor Spirits LLC, Baltimore, MD',
      countryOfOrigin: 'Barbados',
      importerAddress: 'Harbor Spirits LLC, Baltimore, MD'
    }
  }),
  buildSample({
    id: 'sample-4',
    fileName: 'north-coast-warning-case.svg',
    agency: 'North Coast Craft',
    priority: 'Standard',
    submittedAt: '2026-06-04',
    subtitle: 'Distilled Gin',
    detailLines: [
      '47% Alc./Vol. (94 Proof)',
      'Net Contents 750 mL',
      'Distilled by North Coast Craft, Portland, OR'
    ],
    warningPrefix: 'Government Warning:',
    application: {
      id: 'COLA-26-10561',
      brandName: 'NORTH COAST GIN',
      classType: 'Distilled Gin',
      alcoholContent: '47% Alc./Vol.',
      proof: '94 Proof',
      netContents: '750 mL',
      producerAddress: 'Distilled by North Coast Craft, Portland, OR',
      countryOfOrigin: 'United States',
      importerAddress: ''
    }
  }),
  buildSample({
    id: 'sample-5',
    fileName: 'canyon-mesa-abv-mismatch.svg',
    agency: 'Canyon Mesa Winery',
    priority: 'Importer batch',
    submittedAt: '2026-06-06',
    subtitle: 'Red Wine',
    detailLines: [
      '13.4% Alc./Vol.',
      'Net Contents 750 mL',
      'Produced and bottled by Canyon Mesa Winery, Sonoma, CA'
    ],
    application: {
      id: 'COLA-26-10588',
      brandName: 'CANYON MESA RED',
      classType: 'Red Wine',
      alcoholContent: '14.1% Alc./Vol.',
      proof: '',
      netContents: '750 mL',
      producerAddress: 'Produced and bottled by Canyon Mesa Winery, Sonoma, CA',
      countryOfOrigin: 'United States',
      importerAddress: ''
    }
  })
];
