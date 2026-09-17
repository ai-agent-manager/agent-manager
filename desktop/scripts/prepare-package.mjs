/** Build a real production dependency tree. electron-builder follows file:..
 * symlinks into the checkout, which would otherwise include CLI dev dependencies. */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const desktop = fileURLToPath(new URL('../', import.meta.url));
const root = path.dirname(desktop.replace(/[\\/]$/, ''));
const build = path.join(desktop, 'build'), app = path.join(build, 'app'), cli = path.join(build, 'cli');
await rm(app, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
await mkdir(app, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(desktop, 'package.json'), 'utf8'));
delete manifest.devDependencies; delete manifest.scripts;
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run packaging through npm run dist.');
const npmrc = path.join(build, 'npmrc'), globalconfig = path.join(build, 'global-npmrc');
await Promise.all([writeFile(npmrc, ''), writeFile(globalconfig, '')]);
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key))),
  npm_config_cache: path.join(build, 'npm-cache'), npm_config_userconfig: npmrc, npm_config_globalconfig: globalconfig };
if (manifest.dependencies['@ai-agent-manager/cli'] === 'file:..') {
  await rm(cli, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); await mkdir(cli);
  for (const name of ['dist', 'assets', 'schemas', 'LICENSE', 'package.json']) await cp(path.join(root, name), path.join(cli, name), { recursive: true });
  await cp(path.join(root, 'scripts/README.npm.md'), path.join(cli, 'README.md'));
  // Outputs are already built. Avoid the checkout's pack/prepare mutations.
  const result = await exec(process.execPath, [npm, 'pack', '--ignore-scripts', '--json'], { cwd: cli, env });
  const [{ filename }] = JSON.parse(result.stdout);
  manifest.dependencies['@ai-agent-manager/cli'] = `file:${path.join(cli, filename)}`;
}
await writeFile(path.join(app, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await cp(path.join(desktop, 'dist'), path.join(app, 'dist'), { recursive: true });
await exec(process.execPath, [npm, 'install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'], { cwd: app, env, maxBuffer: 4 * 1024 * 1024 });
const installed = JSON.parse(await readFile(path.join(app, 'node_modules/@ai-agent-manager/cli/package.json'), 'utf8'));
// npm version bumps the root package; the packaged shell follows its installed CLI.
manifest.version = installed.version;
// Do not publish the local staging tarball's absolute path in the application metadata.
manifest.dependencies['@ai-agent-manager/cli'] = installed.version;
await writeFile(path.join(app, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Prepared production CLI ${installed.version} and desktop dependencies.`);
