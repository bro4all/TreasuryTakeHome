import type { QueueStatus, VerificationStatus } from '../types';

export const statusCopy: Record<VerificationStatus, string> = {
  pass: 'Pass',
  warning: 'Review',
  fail: 'Issue',
  needs_review: 'Needs data'
};

/** Fallback display status for records that have no verification summary yet.
 * Without findings nothing has been verified, so never imply a pass. */
export function statusFromQueue(status: QueueStatus): VerificationStatus {
  return status === 'error' ? 'fail' : 'needs_review';
}
