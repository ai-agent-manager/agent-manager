import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const checkout = fileURLToPath(new URL('../../', import.meta.url));
/** Isolate state and remove ambient credentials/provider overrides for real flows. */
export async function sandbox() {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'agentman-integration-')));
  const home = path.join(directory, 'home'), repo = path.join(directory, 'repo'), source = path.join(directory, 'source');
  await mkdir(home); await mkdir(repo);
  await cp(path.join(checkout, 'tests/fixtures/valid-bundle'), source, { recursive: true });
  const keys = new Set(['HOME', 'USERPROFILE', 'DO_NOT_TRACK', 'API_BASE_URL', 'AGENTMAN_DISABLE_STARTUP_UPDATE_CHECKS',
    ...Object.keys(process.env).filter((key) => key.startsWith('AGENTMAN_'))]);
  const previous = Object.fromEntries([...keys].map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, { HOME: home, USERPROFILE: home, DO_NOT_TRACK: 'true', AGENTMAN_DISABLE_STARTUP_UPDATE_CHECKS: 'true' });
  const close = async () => {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  try {
    await promisify(execFile)('git', ['init', '--quiet', repo]);
    return { directory, home, repo, source, close };
  } catch (error) { await close(); throw error; }
}
export function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
