/**
 * OCR engine built on Tesseract.js with two hard requirements from the
 * assignment baked in:
 *
 * 1. No outbound network calls. Every asset (worker script, WASM core,
 *    language model) is served same-origin from /tesseract, vendored by
 *    scripts/vendor-ocr-assets.mjs. Federal firewalls block the CDN
 *    fallbacks Tesseract.js would otherwise use.
 * 2. Results in seconds. Workers are created once and reused — a cold
 *    Tesseract worker costs several seconds of WASM + model loading that
 *    must not be paid per label. A small pool lets batch runs overlap.
 */
import { createWorker, OEM } from 'tesseract.js';
import type { Worker } from 'tesseract.js';
import { preprocessImage } from './preprocess';
import { OCR_POOL_SIZE } from '../constants';

export interface OcrProgress {
  status: string;
  progress: number;
}

export interface OcrResult {
  text: string;
  /** Tesseract's mean word confidence for the page, 0-100. */
  confidence: number;
  /** Human-readable preprocessing steps that were applied. */
  preprocessSteps: string[];
}

interface Slot {
  initPromise: Promise<Worker> | null;
  busy: boolean;
  onProgress: ((progress: OcrProgress) => void) | null;
}

const slots: Slot[] = [];
const waiters: Array<(slot: Slot) => void> = [];

/** Absolute same-origin URL for the vendored OCR assets. Blob-based workers
 * cannot resolve relative paths, so these must be absolute. */
function assetBase(): string {
  const base = new URL(import.meta.env.BASE_URL || '/', window.location.origin);
  return new URL('tesseract/', base).toString().replace(/\/$/, '');
}

/** Maps Tesseract's internal status strings onto a single 0..1 progress bar. */
function mapProgress(status: string, progress: number): OcrProgress {
  if (status.includes('core')) {
    return { status: 'Loading OCR engine (first run only)', progress: 0.05 + progress * 0.1 };
  }
  if (status.includes('traineddata') || status.includes('language')) {
    return { status: 'Loading language model (first run only)', progress: 0.15 + progress * 0.1 };
  }
  if (status.includes('initializing') || status.includes('initialized')) {
    return { status: 'Starting OCR engine', progress: 0.25 + progress * 0.05 };
  }
  if (status === 'recognizing text') {
    return { status: 'Reading label text', progress: 0.3 + progress * 0.7 };
  }
  return { status: 'Processing', progress: 0.3 };
}

function ensureWorker(slot: Slot): Promise<Worker> {
  if (!slot.initPromise) {
    const base = assetBase();
    slot.initPromise = createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: `${base}/worker.min.js`,
      corePath: base,
      langPath: base,
      gzip: true,
      logger: (message) => {
        if (typeof message.progress === 'number' && message.status) {
          slot.onProgress?.(mapProgress(message.status, message.progress));
        }
      }
    }).catch((error: unknown) => {
      // A failed init must not poison the slot forever (e.g. transient
      // asset-load failure); allow the next job to retry from scratch.
      slot.initPromise = null;
      throw error instanceof Error
        ? error
        : new Error('OCR engine failed to start. Check that /tesseract assets are deployed.');
    });
  }
  return slot.initPromise;
}

function acquireSlot(): Promise<Slot> {
  const free = slots.find((slot) => !slot.busy);
  if (free) {
    free.busy = true;
    return Promise.resolve(free);
  }
  if (slots.length < OCR_POOL_SIZE) {
    const slot: Slot = { initPromise: null, busy: true, onProgress: null };
    slots.push(slot);
    return Promise.resolve(slot);
  }
  return new Promise((resolve) => {
    waiters.push((slot) => resolve(slot));
  });
}

function releaseSlot(slot: Slot): void {
  slot.onProgress = null;
  const next = waiters.shift();
  if (next) {
    next(slot); // slot stays busy and moves straight to the next job
  } else {
    slot.busy = false;
  }
}

/**
 * Runs OCR on an image URL. Safe to call concurrently; jobs beyond the pool
 * size queue in arrival order.
 */
export async function recognizeLabelText(
  imageUrl: string,
  onProgress?: (progress: OcrProgress) => void
): Promise<OcrResult> {
  const slot = await acquireSlot();
  slot.onProgress = onProgress ?? null;

  try {
    onProgress?.({ status: 'Preparing image', progress: 0.02 });

    let input: HTMLCanvasElement | string = imageUrl;
    let preprocessSteps: string[];
    try {
      const preprocessed = await preprocessImage(imageUrl);
      input = preprocessed.canvas;
      preprocessSteps = preprocessed.steps;
    } catch {
      // Preprocessing is an enhancement; OCR still runs on the original.
      preprocessSteps = ['enhancement skipped (image could not be preprocessed)'];
    }

    const worker = await ensureWorker(slot);
    const result = await worker.recognize(input);

    return {
      text: result.data.text.trim(),
      confidence: Math.round(result.data.confidence ?? 0),
      preprocessSteps
    };
  } finally {
    releaseSlot(slot);
  }
}

/** Tears down all pooled workers (page unload, tests). */
export async function terminateOcr(): Promise<void> {
  const pending = slots.splice(0, slots.length);
  waiters.length = 0;
  await Promise.allSettled(
    pending.map(async (slot) => {
      const worker = slot.initPromise ? await slot.initPromise.catch(() => null) : null;
      await worker?.terminate();
    })
  );
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    void terminateOcr();
  });
}
