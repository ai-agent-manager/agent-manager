/** Captures the real CLI ASCII-art banner (src/cli.ts BANNER, printed via `agentman`)
 * as a screenshot: runs the actual CLI to get the literal terminal output, renders
 * it in a headless-Chromium "terminal" page with monospace font, and screenshots the
 * cropped art region. Produces web-ui/src/assets/banner.png, used as the sidebar
 * brand mark in place of the "a" icon + "Agent Manager" text.
 *
 * Usage: node scripts/capture-banner.mjs
 */
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
// eslint-disable-next-line no-control-regex -- ANSI escape sequences are control characters by definition.
const ANSI_PATTERN = /\x1B\[[0-9;]*[a-zA-Z]/g;
const stripAnsi = (value) => value.replace(ANSI_PATTERN, '');

// Run the real CLI banner-printing path and capture its literal stdout, the same way
// a user would see it in their terminal (src/index.tsx -> console.log(BANNER)).
const child = execFile(process.execPath, ['dist/index.js', 'ui', '--no-open'], { cwd: root });
let captured = '';
child.stdout.on('data', (chunk) => { captured += chunk.toString(); });
await new Promise((resolve) => setTimeout(resolve, 1500));
child.kill('SIGTERM');
await new Promise((resolve) => child.on('close', resolve));

// Keep everything from the first art line up to (excluding) the tagline that follows the
// banner, preserving the blank line between the "AGENT" and "MANAGER" blocks for fidelity
// to the real terminal output — this is a screenshot, not a re-typeset logo.
const plain = stripAnsi(captured);
const lines = plain.split('\n');
const firstArt = lines.findIndex((line) => /[█╗╝║╔╚═]/.test(line));
const taglineIndex = lines.findIndex((line) => line.includes('Your AI agent skills'));
if (firstArt === -1 || taglineIndex === -1 || taglineIndex <= firstArt) {
  throw new Error(`Could not locate banner art in CLI output:\n${captured}`);
}
const bannerText = lines.slice(firstArt, taglineIndex)
  .join('\n')
  .replace(/\n+$/, '') // trailing blank line(s) before the tagline
  .replace(/\s*v\d+\.\d+\.\d+\s*$/, ''); // drop the trailing version number; reported elsewhere in the UI

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; background: transparent; }
  pre { margin: 0; padding: 16px; display: inline-block; font-family: "SF Mono", "Menlo", "Consolas", monospace;
    font-size: 16px; line-height: 1.15; color: #22d3c8; white-space: pre; background: transparent; }
</style></head><body><pre id="art">${bannerText.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 4 });
await page.setContent(html);
const element = await page.$('#art');
const buffer = await element.screenshot({ omitBackground: true });
await browser.close();

const outDir = fileURLToPath(new URL('../web-ui/src/assets/', import.meta.url));
await mkdir(outDir, { recursive: true });
await writeFile(new URL('banner.png', `file://${outDir}`), buffer);
console.log(`Captured banner screenshot -> web-ui/src/assets/banner.png (${buffer.length} bytes)`);
