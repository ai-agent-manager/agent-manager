import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

// Tests that exercise shared operations must never lock or modify the user's
// real agentman state. Each test file gets its own home (including on Windows).
const originalHome = process.env.HOME;
const originalProfile = process.env.USERPROFILE;
// os.tmpdir() can itself be a symlink (e.g. macOS: /var -> /private/var), which
// would make the bundle cache root's realpath differ from itself and trip the
// "must not be a symlink" cache safety check. Resolve it first so the fake
// HOME the tests use is a real, non-symlinked path end to end.
const testHome = mkdtempSync(path.join(realpathSync(os.tmpdir()), 'agentman-test-home-'));
process.env.HOME = testHome;
process.env.USERPROFILE = testHome;
afterAll(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalProfile;
  rmSync(testHome, { recursive: true, force: true });
});
