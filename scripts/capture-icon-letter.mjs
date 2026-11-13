/** Captures the letter "A" from the real CLI ASCII-art banner (src/cli.ts BANNER) as a
 * screenshot, the same way scripts/capture-banner.mjs captures the full banner, then
 * embeds it into desktop/assets/icon.svg as the Dock/app icon glyph — replacing the
 * plain white "a" text with the actual cyan block-art letter from the terminal banner.
 *
 * Usage: node scripts/capture-icon-letter.mjs
 */
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const ANSI_PATTERN = /\x1B\[[0-9;]*[a-zA-Z]/g;
const stripAnsi = (value) => value.replace(ANSI_PATTERN, '');

// Run the real CLI banner-printing path and capture its literal stdout (same technique
// as capture-banner.mjs), so the icon reflects the real banner art.
const child = execFile(process.execPath, ['dist/index.js', 'ui', '--no-open'], { cwd: root });
let captured = '';
child.stdout.on('data', (chunk) => { captured += chunk.toString(); });
await new Promise((resolve) => setTimeout(resolve, 1500));
child.kill('SIGTERM');
await new Promise((resolve) => child.on('close', resolve));

const lines = stripAnsi(captured).split('\n');
const artStart = lines.findIndex((line) => /[█╗╝║╔╚═]/.test(line));
if (artStart === -1) throw new Error(`Could not locate banner art in CLI output:\n${captured}`);
// The first 6 non-blank lines after artStart spell "AGENT"; each letter is an 8-character-
// wide block in this font, so columns 0-7 isolate the "A" glyph cleanly on every row.
const agentLines = lines.slice(artStart, artStart + 6);
const letterA = agentLines.map((line) => line.slice(0, 8)).join('\n');
if (!letterA.includes('█')) throw new Error(`Could not extract the "A" glyph from banner art:\n${captured}`);

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; background: transparent; }
  pre { margin: 0; padding: 12px; display: inline-block; font-family: "SF Mono", "Menlo", "Consolas", monospace;
    font-size: 130px; line-height: 1.15; color: #22d3c8; white-space: pre; background: transparent; }
</style></head><body><pre id="art">${letterA}</pre></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
await page.setContent(html);
const element = await page.$('#art');
const buffer = await element.screenshot({ omitBackground: true });
await browser.close();

const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
const iconSvgUrl = new URL('../desktop/assets/icon.svg', import.meta.url);
const svg = await readFile(iconSvgUrl, 'utf8');
const updated = svg.replace(
  /<text[^>]*>.*?<\/text>/s,
  `<image href="${dataUrl}" x="0" y="0" width="1024" height="1024" preserveAspectRatio="xMidYMid meet"/>`,
);
if (updated === svg) throw new Error('Could not find the <text> glyph element to replace in desktop/assets/icon.svg');
await writeFile(iconSvgUrl, updated);
console.log(`Embedded the captured "A" glyph (${buffer.length} bytes) into desktop/assets/icon.svg`);
