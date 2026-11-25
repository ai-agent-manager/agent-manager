/**
 * build.mjs
 *
 * Bundles the CLI and the embeddable UI server into dist/ with esbuild, so the
 * published package ships React, Ink and every other pure-JS dependency inside
 * its own files. npm/npx cannot hoist or reuse a stale copy of something that
 * is not resolved from node_modules — that is what broke the 1.23 → 1.24 npx
 * upgrade (two Reacts). Type declarations are still emitted by tsc for
 * `@ai-agent-manager/cli/ui-server` consumers (the desktop app).
 */

import { readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const pkg = JSON.parse(await readFile('package.json', 'utf8'));

// Only packages that cannot be bundled stay as runtime dependencies:
// @napi-rs/keyring is a native addon, playwright is optional and ships browsers.
// react-devtools-core is Ink's opt-in DEV tooling and is never installed by us.
const external = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.optionalDependencies ?? {}), 'react-devtools-core'];

await rm('dist', { recursive: true, force: true });

const tsPackage = require.resolve('typescript/package.json');
const tsc = path.join(path.dirname(tsPackage), JSON.parse(await readFile(tsPackage, 'utf8')).bin.tsc);
execFileSync(process.execPath, [tsc, '--emitDeclarationOnly'], { stdio: 'inherit' });

await build({
  entryPoints: { index: 'src/index.tsx', 'ui-server/index': 'src/ui-server/index.ts' },
  outdir: 'dist',
  chunkNames: 'chunks/[name]-[hash]',
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node22.12',
  jsx: 'automatic',
  external,
  sourcemap: 'linked',
  sourcesContent: false,
  legalComments: 'linked',
  logLevel: 'warning',
  // Bundled CommonJS packages call require() for Node built-ins, which ESM
  // output does not provide on its own.
  banner: { js: "import { createRequire as __agentmanCreateRequire } from 'node:module';\nconst require = __agentmanCreateRequire(import.meta.url);" },
});

console.log(`build: bundled dist/ (external: ${external.join(', ')})`);
