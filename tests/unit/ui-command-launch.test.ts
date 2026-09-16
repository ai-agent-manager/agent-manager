import { expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

it('launches the real UI command without a TTY and exits cleanly on SIGINT', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'agentman-ui-cli-'));
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.tsx', 'ui', path.resolve('tests/fixtures/valid-bundle'), '--no-open', '--port', '0'], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOME: home, USERPROFILE: home, AGENTMAN_DISABLE_STARTUP_UPDATE_CHECKS: 'true', DO_NOT_TRACK: 'true' },
  });
  let output = '';
  child.stdout.on('data', (data) => { output += data.toString(); });
  child.stderr.on('data', (data) => { output += data.toString(); });
  const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
  try {
    await vi.waitFor(() => expect(output).toMatch(/Web UI: http:\/\/127\.0\.0\.1:\d+\/\?token=/), { timeout: 5000 });
    const url = new URL(output.match(/Web UI: (http:\S+)/)![1]!);
    const token = url.searchParams.get('token');
    await vi.waitFor(async () => {
      const response = await fetch(`${url.origin}/api/session`, { headers: { authorization: `Bearer ${token}` } });
      expect((await response.json()).state).toBe('ready');
    });
    if (process.platform === 'win32') {
      // Windows does not deliver POSIX SIGINT to child processes. Exercise the
      // same graceful stop through HTTP; signal handlers are unit-tested too.
      await fetch(`${url.origin}/api/shutdown`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
    } else child.kill('SIGINT');
    expect(await exited).toBe(0);
    expect(output).not.toContain('Raw mode is not supported');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited; await rm(home, { recursive: true, force: true });
  }
});

it('ui --help exits successfully without starting the server or a browser', async () => {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.tsx', 'ui', '--help'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
  try {
    await vi.waitFor(() => expect(child.exitCode).toBe(0), { timeout: 5000 });
    expect(output).toContain('Usage');
    expect(output).not.toContain('Web UI: http');
    expect(output).not.toContain('Press Ctrl-C');
  } finally { if (child.exitCode === null) child.kill('SIGKILL'); await exited; }
});
