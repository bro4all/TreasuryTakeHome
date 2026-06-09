export type VerificationStatus = 'pass' | 'warning' | 'fail' | 'needs_review';

export type QueueStatus = 'ready' | 'pending' | 'scanning' | 'complete' | 'error';

export type RequirementId =
  | 'readableText'
  | 'brandName'
  | 'classType'
  | 'alcoholContent'
  | 'netContents'
  | 'producerAddress'
  | 'importerAddress'
  | 'countryOfOrigin'
  | 'governmentWarning';

export interface ApplicationData {
  id: string;
  brandName: string;
  classType: string;
  alcoholContent: string;
  proof: string;
  netContents: string;
  producerAddress: string;
  countryOfOrigin: string;
  importerAddress: string;
}

export interface VerificationFinding {
  id: RequirementId;
  label: string;
  status: VerificationStatus;
  confidence: number;
  expected: string;
  evidence: string;
  recommendation: string;
  /** Optional follow-up specifics, e.g. missing words or OCR misread pairs. */
  details?: string[];
}

export interface VerificationSummary {
  status: VerificationStatus;
  score: number;
  passed: number;
  warnings: number;
  failed: number;
  needsReview: number;
}

export interface LabelRecord {
  id: string;
  fileName: string;
  applicationId: string;
  agency: string;
  priority: 'Standard' | 'Importer batch' | 'Rush';
  submittedAt: string;
  imageUrl: string;
  source: 'sample' | 'upload';
  ocrText: string;
  ocrStatus: QueueStatus;
  ocrProgress: number;
  ocrMessage: string;
  /** Tesseract mean word confidence (0-100) from the last OCR run. */
  ocrConfidence?: number;
  /** Preprocessing applied before the last OCR run. */
  preprocessSteps?: string[];
  error?: string;
  application: ApplicationData;
  findings: VerificationFinding[];
  summary?: VerificationSummary;
  /** Duration of the most recent processing run (verification, or OCR +
   * verification when OCR executed). */
  lastRunMs?: number;
  /** Duration of the most recent run that actually performed OCR — the number
   * that matters for the 5-second target. Never overwritten by text-only
   * re-verification. */
  lastOcrMs?: number;
}

export interface ToastMessage {
  id: string;
  tone: 'info' | 'success' | 'error';
  message: string;
}
