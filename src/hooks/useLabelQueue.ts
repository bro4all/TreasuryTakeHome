import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { sampleLabels } from '../data/sampleLabels';
import { recognizeLabelText } from '../lib/ocr/engine';
import { suggestApplicationFields } from '../lib/extract';
import { summarizeFindings, verifyLabel } from '../lib/verification';
import { MAX_UPLOAD_BYTES } from '../lib/constants';
import { formatDurationMs } from '../lib/format';
import type { ApplicationData, LabelRecord } from '../types';

/** Matches the OCR worker pool size so batch lanes never queue on a worker. */
const BATCH_CONCURRENCY = 2;

interface QueueState {
  records: LabelRecord[];
  selectedId: string;
}

type QueueAction =
  | { type: 'select'; id: string }
  | { type: 'patchRecord'; id: string; patch: Partial<LabelRecord> }
  | { type: 'patchApplication'; id: string; field: keyof ApplicationData; value: string }
  | { type: 'setApplication'; id: string; application: ApplicationData }
  | { type: 'setExtractedText'; id: string; value: string }
  | {
      type: 'completeOcr';
      id: string;
      text: string;
      ocrConfidence?: number;
      preprocessSteps?: string[];
      elapsed: number;
      ocrRan: boolean;
    }
  | { type: 'addRecords'; records: LabelRecord[] }
  | { type: 'removeRecord'; id: string }
  | { type: 'restoreSamples' };

/** Findings must never go stale: any change to the comparison inputs
 * (application data or extracted text) re-runs verification immediately.
 * Skipped mid-scan; OCR completion verifies against fresh data anyway. */
function reverify(record: LabelRecord): LabelRecord {
  if (record.ocrStatus === 'scanning') return record;
  const findings = verifyLabel(record.ocrText.trim(), record.application);
  return { ...record, findings, summary: summarizeFindings(findings) };
}

function reducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case 'select':
      return { ...state, selectedId: action.id };
    case 'patchRecord':
      return {
        ...state,
        records: state.records.map((record) =>
          record.id === action.id ? { ...record, ...action.patch } : record
        )
      };
    case 'patchApplication':
      return {
        ...state,
        records: state.records.map((record) => {
          if (record.id !== action.id) return record;
          const next = {
            ...record,
            application: { ...record.application, [action.field]: action.value },
            applicationId: action.field === 'id' ? action.value : record.applicationId
          };
          // The application ID is not a verified field; skip the re-verify.
          return action.field === 'id' ? next : reverify(next);
        })
      };
    case 'setApplication':
      return {
        ...state,
        records: state.records.map((record) =>
          record.id === action.id ? reverify({ ...record, application: action.application }) : record
        )
      };
    case 'setExtractedText':
      return {
        ...state,
        records: state.records.map((record) => {
          if (record.id !== action.id) return record;
          // Edits are ignored mid-scan: OCR completion would overwrite them,
          // and flipping ocrStatus here would defeat the in-flight guards.
          if (record.ocrStatus === 'scanning') return record;
          return reverify({
            ...record,
            ocrText: action.value,
            ocrStatus: action.value.trim() ? 'ready' : record.ocrStatus,
            ocrMessage: action.value.trim()
              ? 'Edited extracted text — findings update as you type'
              : record.ocrMessage
          });
        })
      };
    case 'completeOcr':
      // Completion verifies against the application data in the store at this
      // moment, so edits made while OCR ran are always reflected.
      return {
        ...state,
        records: state.records.map((record) => {
          if (record.id !== action.id) return record;
          return reverify({
            ...record,
            ocrText: action.text,
            ocrStatus: 'complete' as const,
            ocrProgress: 1,
            ocrMessage: action.text
              ? 'Verification complete'
              : 'No text could be read from this image — paste the label text manually',
            ocrConfidence: action.ocrConfidence ?? record.ocrConfidence,
            preprocessSteps: action.preprocessSteps ?? record.preprocessSteps,
            lastRunMs: action.elapsed,
            ...(action.ocrRan ? { lastOcrMs: action.elapsed } : {})
          });
        })
      };
    case 'addRecords': {
      const records = [...action.records, ...state.records];
      return { records, selectedId: action.records[0]?.id ?? state.selectedId };
    }
    case 'removeRecord': {
      const index = state.records.findIndex((record) => record.id === action.id);
      const records = state.records.filter((record) => record.id !== action.id);
      let selectedId = state.selectedId;
      if (action.id === state.selectedId) {
        selectedId = records[Math.min(index, records.length - 1)]?.id ?? '';
      }
      return { records, selectedId };
    }
    case 'restoreSamples':
      return { records: [...sampleLabels], selectedId: sampleLabels[0]?.id ?? '' };
  }
}

export interface BatchProgress {
  done: number;
  total: number;
}

export interface AddFilesResult {
  added: number;
  rejected: string[];
}

export type Notify = (tone: 'info' | 'success' | 'error', message: string) => void;

export function useLabelQueue(notify: Notify) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    records: [...sampleLabels],
    selectedId: sampleLabels[0]?.id ?? ''
  }));
  const [batch, setBatch] = useState<BatchProgress | null>(null);

  // Async pipelines must read the freshest state, not their closure snapshot.
  const recordsRef = useRef(state.records);
  useEffect(() => {
    recordsRef.current = state.records;
  }, [state.records]);

  const batchCancelRef = useRef(false);
  const batchRunningRef = useRef(false);
  /** Blob URLs for records removed mid-scan; revoked once their job settles. */
  const deferredRevokesRef = useRef(new Map<string, string>());

  const getRecord = useCallback(
    (id: string) => recordsRef.current.find((item) => item.id === id),
    []
  );

  // Contract: patches here must not change comparison inputs (application or
  // ocrText) without also supplying fresh findings — data edits go through
  // the reducer actions that re-verify.
  const patchRecord = useCallback((id: string, patch: Partial<LabelRecord>) => {
    dispatch({ type: 'patchRecord', id, patch });
  }, []);

  /**
   * OCR + verify one record. With `forceOcr` the image is always re-read;
   * otherwise existing extracted text is reused and only verification runs.
   */
  const processRecord = useCallback(
    async (id: string, forceOcr: boolean): Promise<boolean> => {
      const record = getRecord(id);
      if (!record || record.ocrStatus === 'scanning') return false;

      const start = performance.now();
      patchRecord(id, {
        ocrStatus: 'scanning',
        ocrProgress: 0.02,
        ocrMessage: 'Queued for OCR',
        error: undefined
      });

      try {
        let text = record.ocrText.trim();
        let ocrConfidence = record.ocrConfidence;
        let preprocessSteps = record.preprocessSteps;
        let ocrRan = false;

        if (forceOcr || !text) {
          const result = await recognizeLabelText(record.imageUrl, (progress) => {
            patchRecord(id, { ocrProgress: progress.progress, ocrMessage: progress.status });
          });
          text = result.text;
          ocrConfidence = result.confidence;
          preprocessSteps = result.preprocessSteps;
          ocrRan = true;
        }

        // Verification happens inside the reducer against in-store data, so
        // application edits made while OCR ran are always reflected.
        dispatch({
          type: 'completeOcr',
          id,
          text,
          ocrConfidence,
          preprocessSteps,
          elapsed: Math.round(performance.now() - start),
          ocrRan
        });
      } catch (error) {
        patchRecord(id, {
          ocrStatus: 'error',
          ocrProgress: 0,
          ocrMessage: 'OCR failed',
          error:
            error instanceof Error
              ? error.message
              : 'Unable to read image text. Try a clearer photo or paste the text manually.',
          lastRunMs: Math.round(performance.now() - start)
        });
      } finally {
        const deferredUrl = deferredRevokesRef.current.get(id);
        if (deferredUrl) {
          deferredRevokesRef.current.delete(id);
          URL.revokeObjectURL(deferredUrl);
        }
      }
      return true;
    },
    [getRecord, patchRecord]
  );

  const runOcr = useCallback((id: string) => void processRecord(id, true), [processRecord]);

  /** Re-verifies the currently extracted/pasted text without running OCR. */
  const verifyText = useCallback(
    (id: string) => {
      const record = getRecord(id);
      if (!record || record.ocrStatus === 'scanning') return;
      const start = performance.now();
      const text = record.ocrText.trim();
      const findings = verifyLabel(text, record.application);
      patchRecord(id, {
        ocrText: text,
        ocrStatus: text ? 'complete' : 'ready',
        ocrMessage: text ? 'Verification complete' : 'Text required before verification',
        findings,
        summary: summarizeFindings(findings),
        lastRunMs: Math.round(performance.now() - start)
      });
    },
    [getRecord, patchRecord]
  );

  const runBatch = useCallback(async () => {
    if (batchRunningRef.current) return; // ignore double-clicks before re-render
    const ids = recordsRef.current.map((record) => record.id);
    if (!ids.length) {
      notify('info', 'The queue is empty — upload labels first.');
      return;
    }

    batchRunningRef.current = true;
    batchCancelRef.current = false;
    setBatch({ done: 0, total: ids.length });
    const started = performance.now();
    const pending = [...ids];

    let skipped = 0;
    const lanes = Array.from({ length: BATCH_CONCURRENCY }, async () => {
      while (!batchCancelRef.current) {
        const id = pending.shift();
        if (!id) break;
        const processed = await processRecord(id, false);
        if (!processed) skipped += 1;
        setBatch((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
      }
    });

    await Promise.all(lanes);
    batchRunningRef.current = false;
    setBatch(null);

    const elapsed = formatDurationMs(performance.now() - started);
    const processedCount = ids.length - skipped;
    const skipNote = skipped ? ` (${skipped} skipped — already being scanned)` : '';
    if (batchCancelRef.current) {
      notify('info', `Batch stopped after ${elapsed}.`);
    } else {
      notify('success', `Batch complete: ${processedCount} label${processedCount === 1 ? '' : 's'} in ${elapsed}${skipNote}.`);
    }
  }, [notify, processRecord]);

  const stopBatch = useCallback(() => {
    batchCancelRef.current = true;
  }, []);

  const addFiles = useCallback((files: Iterable<File>): AddFilesResult => {
    const accepted: LabelRecord[] = [];
    const rejected: string[] = [];

    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        rejected.push(`${file.name} (not an image)`);
        continue;
      }
      if (file.type === 'image/svg+xml') {
        rejected.push(`${file.name} (vector SVG not supported — upload a photo such as PNG or JPEG)`);
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        rejected.push(`${file.name} (over ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB)`);
        continue;
      }
      const applicationId = `UPLOAD-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}-${accepted.length + 1}`;
      accepted.push({
        id: `upload-${crypto.randomUUID()}`,
        fileName: file.name,
        applicationId,
        agency: 'Uploaded label',
        priority: 'Standard',
        submittedAt: new Date().toISOString().slice(0, 10),
        imageUrl: URL.createObjectURL(file),
        source: 'upload',
        ocrText: '',
        ocrStatus: 'pending',
        ocrProgress: 0,
        ocrMessage: 'Image ready — run OCR to extract text',
        application: {
          id: applicationId,
          brandName: '',
          classType: '',
          alcoholContent: '',
          proof: '',
          netContents: '',
          producerAddress: '',
          countryOfOrigin: '',
          importerAddress: ''
        },
        findings: [],
        summary: undefined
      });
    }

    if (accepted.length) {
      dispatch({ type: 'addRecords', records: accepted });
    }
    return { added: accepted.length, rejected };
  }, []);

  /** Frees an upload's blob URL — deferred while the OCR worker may still be
   * reading it (revoked in processRecord's finally once the job settles). */
  const releaseUploadUrl = useCallback((record: LabelRecord) => {
    if (record.source !== 'upload') return;
    if (record.ocrStatus === 'scanning') {
      deferredRevokesRef.current.set(record.id, record.imageUrl);
    } else {
      URL.revokeObjectURL(record.imageUrl);
    }
  }, []);

  const removeRecord = useCallback(
    (id: string) => {
      const record = getRecord(id);
      if (record) releaseUploadUrl(record);
      dispatch({ type: 'removeRecord', id });
    },
    [getRecord, releaseUploadUrl]
  );

  /** Fills empty application fields from the extracted text. Returns the
   * field names that were filled so the caller can prompt a review. */
  const applySuggestions = useCallback(
    (id: string): string[] => {
      const record = getRecord(id);
      if (!record || !record.ocrText.trim()) return [];

      const suggestions = suggestApplicationFields(record.ocrText);
      const application = { ...record.application };
      const filled: string[] = [];
      for (const [key, value] of Object.entries(suggestions) as Array<[keyof ApplicationData, string]>) {
        if (value && !application[key].trim()) {
          application[key] = value;
          filled.push(key);
        }
      }
      if (filled.length) {
        dispatch({ type: 'setApplication', id, application });
      }
      return filled;
    },
    [getRecord]
  );

  const select = useCallback((id: string) => dispatch({ type: 'select', id }), []);
  const restoreSamples = useCallback(() => {
    // Free blob URLs for any uploads being discarded by the reset.
    for (const record of recordsRef.current) releaseUploadUrl(record);
    dispatch({ type: 'restoreSamples' });
  }, [releaseUploadUrl]);
  const updateApplication = useCallback((id: string, field: keyof ApplicationData, value: string) => {
    dispatch({ type: 'patchApplication', id, field, value });
  }, []);
  const updateExtractedText = useCallback((id: string, value: string) => {
    dispatch({ type: 'setExtractedText', id, value });
  }, []);

  const selectedRecord =
    state.records.find((record) => record.id === state.selectedId) ?? state.records[0];

  return {
    records: state.records,
    selectedRecord,
    batch,
    select,
    updateApplication,
    updateExtractedText,
    addFiles,
    removeRecord,
    restoreSamples,
    runOcr,
    verifyText,
    runBatch,
    stopBatch,
    applySuggestions
  };
}
