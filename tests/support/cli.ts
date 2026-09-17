import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { api, eventually } from './http.js';
import { deadline } from './lifecycle.js';

/** Launch the actual entry point, with no shell or npm wrapper to orphan on Windows. */
export async function startCli(options: { entry: string; cwd: string; source: string; env?: NodeJS.ProcessEnv; port?: number; preload?: string }) {
  const guardDirectory = await mkdtemp(path.join(os.tmpdir(), 'agentman-browser-guard-'));
  const sentinel = path.join(guardDirectory, 'attempts');
  const child = spawn(process.execPath, ['--import', new URL('./no-browser.mjs', import.meta.url).href,
    ...(options.preload ? ['--import', pathToFileURL(options.preload).href] : []),
    options.entry, 'ui', options.source, '--no-open', '--port', String(options.port ?? 0)], {
    cwd: options.cwd, env: { ...process.env, ...options.env, AGENTMAN_TEST_BROWSER_SENTINEL: sentinel }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '', launchError: Error | undefined;
  child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
  child.on('error', (error) => { launchError = error; });
  const exited = new Promise<void>((resolve) => child.once('close', () => resolve()));
  const alive = () => child.exitCode === null && child.signalCode === null && !launchError;
  const cleanup = async () => {
    try {
      if (alive()) child.kill('SIGKILL');
      await deadline(exited, 3_000, 'CLI child did not exit within 3s after forced shutdown.');
      const attempts = await readFile(sentinel, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return '';
      });
      if (attempts) throw new Error(`CLI attempted a browser launch despite --no-open (${attempts.trim()}). The test guard prevented the launch.`);
    } finally { await rm(guardDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  };
  try {
    const url = await eventually(async () => {
      if (launchError) throw launchError;
      if (!alive()) throw new Error(`CLI exited before serving its UI: ${output.replace(/token=[^\s&]+/g, 'token=[redacted]')}`);
      return output.match(/Web UI: (http:\S+)/)?.[1];
    }, (value) => !!value, 15_000);
    const token = new URL(url!).searchParams.get('token')!;
    let stopping: Promise<void> | undefined;
    return { url: url!, token, stop: () => stopping ??= (async () => {
      try {
        if (alive()) await deadline((async () => {
          await api({ url: url!, token }, '/api/shutdown', 'POST');
          await exited;
        })(), 5_000, 'CLI shutdown exceeded 5s; forcing the test child to exit.');
      } finally { await cleanup(); }
    })() };
  } catch (error) { await cleanup(); throw error; }
}
