import * as esbuild from 'esbuild';
import { cpSync } from 'node:fs';

/**
 * esbuild configuration for the Agentman Chrome Extension.
 *
 * Builds a self-contained dist/ directory that can be loaded directly
 * via chrome://extensions → "Load unpacked".
 *
 * Chrome content scripts and popup scripts cannot use ES module imports,
 * so we bundle them into self-contained IIFE files. The service worker
 * supports ES modules natively in Manifest V3.
 */

const shared = {
  bundle: true,
  sourcemap: true,
  target: 'es2022',
  logLevel: 'info',
};

// Content script — must be a single file with no import statements.
// Uses IIFE format since content scripts run in the page context.
await esbuild.build({
  ...shared,
  entryPoints: ['src/content/content.ts'],
  outfile: 'dist/content/content.js',
  format: 'iife',
});

// Popup script — must be a single file since it's loaded via <script> in popup.html.
// Uses IIFE format for broad compatibility.
await esbuild.build({
  ...shared,
  entryPoints: ['src/popup/popup.ts'],
  outfile: 'dist/popup/popup.js',
  format: 'iife',
});

// Service worker — MV3 supports "type": "module", but it has no local imports,
// so we can bundle it as ESM for consistency.
await esbuild.build({
  ...shared,
  entryPoints: ['src/background/service-worker.ts'],
  outfile: 'dist/background/service-worker.js',
  format: 'esm',
});

// Copy static assets into dist/ so it's a self-contained extension directory.
cpSync('manifest.json', 'dist/manifest.json');
cpSync('icons', 'dist/icons', { recursive: true });
cpSync('src/popup/popup.html', 'dist/popup/popup.html');
cpSync('src/popup/popup.css', 'dist/popup/popup.css');

console.log('\nStatic assets copied to dist/');
