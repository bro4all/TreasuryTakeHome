import type { LabelRecord } from '../types';
import { PERFORMANCE_TARGET_MS } from '../lib/constants';
import { displayRunMs, formatDurationMs } from '../lib/format';

interface MetricsBarProps {
  records: LabelRecord[];
}

function Metric({
  label,
  value,
  tone = 'neutral'
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'warning' | 'fail' | 'pass';
}) {
  return (
    <div className={`metric metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function MetricsBar({ records }: MetricsBarProps) {
  const total = records.length;
  const complete = records.filter((record) => record.ocrStatus === 'complete').length;
  const issueCount = records.filter((record) => record.summary?.status === 'fail').length;
  const reviewCount = records.filter(
    (record) => record.summary?.status === 'warning' || record.summary?.status === 'needs_review'
  ).length;

  const timed = records.map(displayRunMs).filter((ms): ms is number => ms !== undefined);
  const averageMs = timed.length ? Math.round(timed.reduce((sum, ms) => sum + ms, 0) / timed.length) : 0;
  const averageDisplay = timed.length ? formatDurationMs(averageMs) : 'Not run';
  const averageTone = !timed.length ? 'neutral' : averageMs <= PERFORMANCE_TARGET_MS ? 'pass' : 'warning';

  return (
    <section className="metrics-bar" aria-label="Queue metrics">
      <Metric label="Labels" value={String(total)} />
      <Metric label="Verified" value={String(complete)} />
      <Metric label="Needs review" value={String(reviewCount)} tone={reviewCount ? 'warning' : 'neutral'} />
      <Metric label="Issues" value={String(issueCount)} tone={issueCount ? 'fail' : 'neutral'} />
      <Metric label={`Avg run (target ${PERFORMANCE_TARGET_MS / 1000} s)`} value={averageDisplay} tone={averageTone} />
    </section>
  );
}
