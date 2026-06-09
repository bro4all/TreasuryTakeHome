import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Enforces the no-outbound-requests design: every source is same-origin.
 * blob:/data: cover uploaded images, the OCR worker, and sample artwork;
 * wasm-unsafe-eval is required to instantiate the Tesseract WASM core.
 *
 * Injected only for production builds — Vite's dev server uses an inline
 * React Fast Refresh preamble that a strict CSP would block.
 */
const CSP_CONTENT = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'"
].join('; ');

function injectCsp(): Plugin {
  return {
    name: 'inject-csp-meta',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP_CONTENT },
          injectTo: 'head-prepend'
        }
      ];
    }
  };
}

export default defineConfig({
  plugins: [react(), injectCsp()],
  test: {
    environment: 'node',
    globals: true
  }
});
