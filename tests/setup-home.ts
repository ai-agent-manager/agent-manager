import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, vi } from 'vitest';

// Tests that exercise shared operations must never lock or modify the user's
// real agentman state. Each test file gets its own home (including on Windows).
const originalHome = process.env.HOME;
const originalProfile = process.env.USERPROFILE;
// os.tmpdir() can itself be a symlink (e.g. macOS: /var -> /private/var) or a
// Windows 8.3 short name (C:\Users\RUNNER~1 on CI), either of which makes the
// bundle cache root's realpath differ from itself and trips the "must not be a
// symlink" cache safety check. Resolve it with the native realpath, which is
// what the runtime uses and the only variant that expands short names.
const testHome = mkdtempSync(path.join(realpathSync.native(os.tmpdir()), 'agentman-test-home-'));
process.env.HOME = testHome;
process.env.USERPROFILE = testHome;
afterAll(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalProfile;
  rmSync(testHome, { recursive: true, force: true });
});

// vi.waitFor defaults to a 1 s deadline, which Ink keystroke flows and server
// readiness polls exceed on busy CI runners (two different files tripped it on
// consecutive ubuntu-latest runs). Give unqualified waits a CI budget that
// matches the test timeout; local runs keep the tight default so slowness is noticed.
if (process.env.CI) {
  const waitFor = vi.waitFor.bind(vi);
  vi.waitFor = ((callback, options) => waitFor(callback, typeof options === 'number' ? options : { timeout: 10_000, ...options })) as typeof vi.waitFor;
}
