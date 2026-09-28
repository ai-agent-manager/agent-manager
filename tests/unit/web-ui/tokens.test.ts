import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

// WCAG 1.4.11: control boundaries and focus indicators need 3:1 against adjacent colours.
// Lives in the root suite because the web-ui vitest stubs CSS imports (even ?raw) and has no Node types.
const css = readFileSync(path.resolve('web-ui/src/styles/tokens.css'), 'utf8');
function tokens(prefix: string) {
  const line = css.split('\n').find((candidate) => candidate.startsWith(prefix));
  if (!line) throw new Error(`No token block starts with ${prefix}`);
  return Object.fromEntries([...line.matchAll(/--([\w-]+):\s*(#[0-9a-f]{3,6})\b/gi)].map((match) => [match[1], match[2]]));
}
function luminance(hex: string) {
  const digits = hex.slice(1); const full = digits.length === 3 ? [...digits].map((d) => d + d).join('') : digits;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((c) => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

it.each([[':root {', 'light'], [':root[data-theme="dark"]', 'dark']])('%s tokens give controls and focus rings at least 3:1 contrast (%s)', (prefix) => {
  const t = tokens(prefix);
  for (const surface of ['surface', 'background']) expect(contrast(t['control-border']!, t[surface]!), `control-border vs ${surface}`).toBeGreaterThanOrEqual(3);
  for (const surface of ['surface', 'background', 'accent-soft']) expect(contrast(t.focus!, t[surface]!), `focus vs ${surface}`).toBeGreaterThanOrEqual(3);
});
it('stops the spinner entirely under reduced motion', () => {
  const rule = css.split('\n').find((line) => line.startsWith('@media (prefers-reduced-motion: reduce)'));
  expect(rule).toContain('.spinner { animation: none; }');
});
