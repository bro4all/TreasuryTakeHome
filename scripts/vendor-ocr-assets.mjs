#!/usr/bin/env node
/**
 * Copies every asset Tesseract.js needs at runtime from node_modules into
 * public/tesseract so the deployed app serves OCR entirely same-origin.
 *
 * Federal networks commonly block outbound CDN traffic; without this step
 * tesseract.js silently falls back to jsdelivr/projectnaptha downloads.
 */
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'tesseract');

const assets = [
  // Worker script (browser entry point for OCR jobs).
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  // LSTM cores with embedded WASM. The worker picks the variant matching the
  // browser's SIMD support at runtime, so all three must be present.
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  [
    'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
    'tesseract-core-relaxedsimd-lstm.wasm.js'
  ],
  // English language model (best-quality integer build, gzipped).
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz']
];

mkdirSync(outDir, { recursive: true });

let copied = 0;
for (const [source, target] of assets) {
  const from = join(root, 'node_modules', source);
  const to = join(outDir, target);
  if (!existsSync(from)) {
    console.error(`vendor-ocr-assets: missing ${source}. Run npm install first.`);
    process.exitCode = 1;
    continue;
  }
  if (existsSync(to) && statSync(to).size === statSync(from).size) {
    continue; // already vendored
  }
  copyFileSync(from, to);
  copied += 1;
}

console.log(
  copied
    ? `vendor-ocr-assets: copied ${copied} file(s) to public/tesseract`
    : 'vendor-ocr-assets: assets already up to date'
);
