import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/** Linux kernel evidence, in addition to BrowserWindow preferences. */
export async function assertRendererSandbox(pid: number): Promise<void> {
  if (process.platform !== 'linux') return;
  const status = await readFile(`/proc/${pid}/status`, 'utf8');
  assert.match(status, /^NoNewPrivs:\s+1$/m);
  assert.match(status, /^Seccomp:\s+2$/m);
  assert.match(status, /^CapEff:\s+0+$/m);
}
