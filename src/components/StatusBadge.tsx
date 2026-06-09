import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import type { VerificationStatus } from '../types';
import { statusCopy } from './statusMeta';

export function StatusBadge({ status, compact = false }: { status: VerificationStatus; compact?: boolean }) {
  const Icon =
    status === 'pass' ? CheckCircle2 : status === 'warning' || status === 'needs_review' ? AlertTriangle : XCircle;

  return (
    <span className={`status-badge status-${status} ${compact ? 'compact' : ''}`}>
      <Icon size={compact ? 14 : 16} aria-hidden="true" />
      {statusCopy[status]}
    </span>
  );
}
