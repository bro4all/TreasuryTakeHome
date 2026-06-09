import { Wand2 } from 'lucide-react';
import type { ApplicationData, LabelRecord, VerificationStatus, VerificationSummary } from '../types';

export type ApplicationField = keyof ApplicationData;

const formFields: Array<{
  key: ApplicationField;
  label: string;
  placeholder: string;
  multiline?: boolean;
}> = [
  { key: 'id', label: 'Application ID', placeholder: 'COLA-26-00000' },
  { key: 'brandName', label: 'Brand name', placeholder: 'OLD TOM DISTILLERY' },
  { key: 'classType', label: 'Class/type', placeholder: 'Kentucky Straight Bourbon Whiskey' },
  { key: 'alcoholContent', label: 'Alcohol content', placeholder: '45% Alc./Vol.' },
  { key: 'proof', label: 'Proof', placeholder: '90 Proof' },
  { key: 'netContents', label: 'Net contents', placeholder: '750 mL' },
  {
    key: 'producerAddress',
    label: 'Producer / bottler / importer',
    placeholder: 'Bottled by Old Tom Distillery, Louisville, KY',
    multiline: true
  },
  { key: 'countryOfOrigin', label: 'Country of origin', placeholder: 'United States' },
  {
    key: 'importerAddress',
    label: 'Importer address',
    placeholder: 'Required for imports',
    multiline: true
  }
];

function SummaryPill({ label, value, tone }: { label: string; value: number; tone: VerificationStatus }) {
  return (
    <div className={`summary-pill status-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

interface ApplicationPanelProps {
  record: LabelRecord;
  summary: VerificationSummary;
  onFieldChange: (field: ApplicationField, value: string) => void;
  onSuggestFromLabel: () => void;
}

export function ApplicationPanel({ record, summary, onFieldChange, onSuggestFromLabel }: ApplicationPanelProps) {
  const hasText = Boolean(record.ocrText.trim());

  return (
    <aside className="application-panel" aria-label="Application data">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Application data</p>
          <h2>COLA fields</h2>
        </div>
        <div
          className="score-ring"
          data-tone={summary.status}
          style={{ '--score': summary.score } as React.CSSProperties}
          aria-label={`Match score ${summary.score} percent`}
        >
          <span>{summary.score}%</span>
        </div>
      </div>

      <div className="summary-stack">
        <SummaryPill label="Pass" value={summary.passed} tone="pass" />
        <SummaryPill label="Review" value={summary.warnings + summary.needsReview} tone="warning" />
        <SummaryPill label="Issue" value={summary.failed} tone="fail" />
      </div>

      <button
        className="secondary-button suggest-button"
        type="button"
        onClick={onSuggestFromLabel}
        disabled={!hasText}
        title={hasText ? 'Fill empty fields from extracted label text' : 'Run OCR or paste label text first'}
      >
        <Wand2 size={16} aria-hidden="true" />
        Suggest empty fields from label
      </button>

      <form className="field-grid" onSubmit={(event) => event.preventDefault()}>
        {formFields.map((field) => (
          <label key={field.key} className="field-label">
            <span>{field.label}</span>
            {field.multiline ? (
              <textarea
                name={field.key}
                value={record.application[field.key]}
                placeholder={field.placeholder}
                onChange={(event) => onFieldChange(field.key, event.target.value)}
              />
            ) : (
              <input
                name={field.key}
                value={record.application[field.key]}
                placeholder={field.placeholder}
                onChange={(event) => onFieldChange(field.key, event.target.value)}
              />
            )}
          </label>
        ))}
      </form>
    </aside>
  );
}
