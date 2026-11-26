/**
 * build.mjs
 *
 * Bundles the CLI and the embeddable UI server into dist/ with esbuild, so the
 * published package ships React, Ink and every other pure-JS dependency inside
 * its own files. npm/npx cannot hoist or reuse a stale copy of something that
 * is not resolved from node_modules. Type declarations are still emitted by tsc for
 * `@ai-agent-manager/cli/ui-server` consumers (the desktop app).
 *
 * The build fails if the output imports any package outside RUNTIME_EXTERNALS,
 * and writes dist/THIRD_PARTY_NOTICES.txt for the code it inlines.
 */

import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire, isBuiltin } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const pkg = JSON.parse(await readFile('package.json', 'utf8'));

// The only packages dist/ may import at runtime. Everything else is bundled.
// @napi-rs/keyring is a native addon and playwright is optional and ships
// browsers, so both stay real (optional) dependencies. react-devtools-core is
// Ink's opt-in DEV tooling, loaded only if a developer installs it.
const RUNTIME_EXTERNALS = ['@napi-rs/keyring', 'playwright'];
const OPTIONAL_TOOLING = ['react-devtools-core'];
const external = [...RUNTIME_EXTERNALS, ...OPTIONAL_TOOLING];

const declared = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.optionalDependencies ?? {})].sort();
if (declared.join() !== [...RUNTIME_EXTERNALS].sort().join()) {
  fail(`package.json dependencies/optionalDependencies (${declared.join(', ')}) must match RUNTIME_EXTERNALS in scripts/build.mjs (${RUNTIME_EXTERNALS.join(', ')}).\n` +
    'Pure-JS libraries are bundled and belong in devDependencies; a native or optional package must be added to both.');
}

await rm('dist', { recursive: true, force: true });

const tsPackage = require.resolve('typescript/package.json');
const tsc = path.join(path.dirname(tsPackage), JSON.parse(await readFile(tsPackage, 'utf8')).bin.tsc);
execFileSync(process.execPath, [tsc, '--emitDeclarationOnly'], { stdio: 'inherit' });

const result = await build({
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
  // Ship React's production build; with NODE_ENV unset at runtime the
  // development build (and its overhead) would otherwise run for every user.
  define: { 'process.env.NODE_ENV': '"production"' },
  metafile: true,
  sourcemap: 'linked',
  sourcesContent: false,
  legalComments: 'linked',
  logLevel: 'warning',
  // Bundled CommonJS packages call require() for Node built-ins, which ESM
  // output does not provide on its own.
  banner: { js: "import { createRequire as __agentmanCreateRequire } from 'node:module';\nconst require = __agentmanCreateRequire(import.meta.url);" },
});

// A warning usually means code esbuild could not bundle (e.g. a dynamic
// require() or a native .node binding from a package in devDependencies),
// which would only fail at runtime on a user's machine.
if (result.warnings.length) fail(`esbuild reported ${result.warnings.length} warning(s); see above.`);

const unexpected = new Set();
for (const [file, output] of Object.entries(result.metafile.outputs)) {
  for (const { path: specifier, external: isExternal } of output.imports) {
    if (!isExternal || isBuiltin(specifier)) continue;
    const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
    if (!external.includes(name)) unexpected.add(`${specifier} (from ${file})`);
  }
}
if (unexpected.size) fail(`dist/ imports packages that are neither bundled nor allowed runtime dependencies:\n  ${[...unexpected].join('\n  ')}`);

await writeFile('dist/THIRD_PARTY_NOTICES.txt', await thirdPartyNotices(result.metafile));

console.log(`build: bundled dist/ (runtime imports: ${external.join(', ')}, Node built-ins)`);

/** Licence text for every package whose code ends up in dist/ (MIT/ISC/BSD require it to ship). */
async function thirdPartyNotices(metafile) {
  const roots = new Set();
  for (const output of Object.values(metafile.outputs)) {
    for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
      const index = input.lastIndexOf('node_modules/');
      if (index === -1 || bytesInOutput === 0) continue;
      const rest = input.slice(index + 'node_modules/'.length).split('/');
      roots.add(input.slice(0, index) + 'node_modules/' + rest.slice(0, rest[0].startsWith('@') ? 2 : 1).join('/'));
    }
  }
  const entries = new Map();
  const missing = [];
  for (const root of roots) {
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    const key = `${manifest.name}@${manifest.version}`;
    if (entries.has(key)) continue;
    const licenceFiles = (await readdir(root)).filter((name) => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(name)).sort().map((name) => path.join(root, name));
    // Some packages (e.g. yoga-layout) publish without a licence file; keep the
    // upstream text in scripts/third-party-licenses/<name>.txt for those.
    if (!licenceFiles.length) {
      const fallback = path.join('scripts/third-party-licenses', `${manifest.name.replace('/', '__')}.txt`);
      if (await readFile(fallback, 'utf8').then(() => true, () => false)) licenceFiles.push(fallback);
      else { missing.push(key); continue; }
    }
    const texts = await Promise.all(licenceFiles.map((file) => readFile(file, 'utf8')));
    entries.set(key, `${key}\nLicense: ${manifest.license ?? 'see below'}\n\n${texts.map((text) => text.trim()).join('\n\n')}`);
  }
  if (missing.length) fail(`No licence file found for bundled package(s): ${missing.join(', ')}. Add the upstream text as scripts/third-party-licenses/<name>.txt.`);
  const header = `${pkg.name} bundles the following third-party packages into dist/.\nTheir licence notices are reproduced below.\n`;
  return [header, ...[...entries.keys()].sort().map((key) => entries.get(key))].join(`\n${'='.repeat(80)}\n\n`) + '\n';
}

function fail(message) {
  console.error(`build: ${message}`);
  process.exit(1);
}
