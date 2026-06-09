import { Loader2, ScanLine } from 'lucide-react';
import type { LabelRecord, VerificationSummary } from '../types';
import { PERFORMANCE_TARGET_MS } from '../lib/constants';
import { displayRunMs, formatDurationMs } from '../lib/format';
import { StatusBadge } from './StatusBadge';

const queueStatusCopy: Record<LabelRecord['ocrStatus'], string> = {
  ready: 'Ready',
  pending: 'Pending',
  scanning: 'Scanning',
  complete: 'Complete',
  error: 'Error'
};

interface LabelPreviewProps {
  record: LabelRecord;
  summary: VerificationSummary;
  onRunOcr: () => void;
}

export function LabelPreview({ record, summary, onRunOcr }: LabelPreviewProps) {
  const scanning = record.ocrStatus === 'scanning';
  const runMs = displayRunMs(record);
  const withinTarget = runMs !== undefined && runMs <= PERFORMANCE_TARGET_MS;

  return (
    <section className="preview-panel" aria-label="Label image preview">
      <div className="panel-heading preview-heading">
        <div>
          <p className="panel-kicker">{record.applicationId}</p>
          <h2>{record.fileName}</h2>
        </div>
        <div className="preview-actions">
          <StatusBadge status={summary.status} />
          <button className="icon-text-button" type="button" onClick={onRunOcr} disabled={scanning}>
            {scanning ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <ScanLine size={16} aria-hidden="true" />}
            Run OCR
          </button>
        </div>
      </div>

      <div className="preview-grid">
        <div className="image-frame">
          <img
            src={record.imageUrl}
            alt={`Label artwork for ${record.application.brandName || record.fileName}`}
          />
        </div>

        <div className="ocr-status">
          <div className="status-row">
            <span>{queueStatusCopy[record.ocrStatus]}</span>
            <strong>{Math.round(record.ocrProgress * 100)}%</strong>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(record.ocrProgress * 100)}
            aria-label="OCR progress"
          >
            <div
              className={scanning ? 'progress-fill is-scanning' : 'progress-fill'}
              style={{ width: `${Math.round(record.ocrProgress * 100)}%` }}
            />
          </div>
          <p aria-live="polite">{record.error ?? record.ocrMessage}</p>

          <dl className="evidence-list">
            <div>
              <dt>Submitted</dt>
              <dd>{record.submittedAt}</dd>
            </div>
            <div>
              <dt>Applicant</dt>
              <dd>{record.agency}</dd>
            </div>
            <div>
              <dt>{record.lastOcrMs !== undefined ? 'OCR run' : 'Last run'}</dt>
              <dd>
                {runMs !== undefined ? (
                  <span className={withinTarget ? 'target-chip target-ok' : 'target-chip target-over'}>
                    {formatDurationMs(runMs)} · {withinTarget ? 'within' : 'over'} {PERFORMANCE_TARGET_MS / 1000} s
                    target
                  </span>
                ) : (
                  'Not run'
                )}
              </dd>
            </div>
            {record.ocrConfidence !== undefined ? (
              <div>
                <dt>OCR confidence</dt>
                <dd>{record.ocrConfidence}%</dd>
              </div>
            ) : null}
            {record.preprocessSteps?.length ? (
              <div>
                <dt>Image prep</dt>
                <dd>{record.preprocessSteps.join(', ')}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      </div>
    </section>
  );
}
