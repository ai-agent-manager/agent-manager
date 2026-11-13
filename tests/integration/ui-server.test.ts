import { afterEach, beforeEach, expect, it } from 'vitest';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { startUiServer } from '../../src/ui-server/index.js';
import { boundedServer } from '../support/lifecycle.js';
import { sandbox } from '../support/sandbox.js';
import { api, events, finished } from '../support/http.js';
import type { SessionDto, SnapshotDto } from '../../src/ui-server/api-types.js';

let state: Awaited<ReturnType<typeof sandbox>>, ui: Awaited<ReturnType<typeof startUiServer>>;
beforeEach(async () => {
  state = await sandbox();
  ui = boundedServer(await startUiServer({ port: 0, cwd: state.repo, startupSource: state.source, staticDir: null }));
});
afterEach(async () => { try { await ui?.stop(); } finally { await state?.close(); } });
it('installs and removes through HTTP with SSE readiness and matching filesystem records', async () => {
  const stream = await events(ui);
  let session: SessionDto | undefined;
  try {
    while (session?.state !== 'ready') {
      const frame = await stream.read();
      if (frame.event === 'snapshot') session = (frame.data as SnapshotDto).session;
      if (frame.event === 'session') session = frame.data as SessionDto;
    }
    const skill = session.catalogue[0]!;
    const response = await api(ui, '/api/installs', 'POST', { sessionRevision: session.sessionRevision, skillId: skill.skillId,
      installKey: skill.candidates[0]!.installKey, scope: 'system', toolIds: ['claude-code'] });
    expect(response.status).toBe(202);
    expect(await finished(ui, (await response.json()).jobId)).toMatchObject({ state: 'succeeded' });
    const destination = path.join(state.home, '.claude/skills/test-skill');
    const configPath = path.join(state.home, '.agentman/config.json');
    const record = JSON.parse(await readFile(configPath, 'utf8')).installations['claude-code']['test-skill'];
    expect(record.sourcePin.bundleVersion).toBe(session.bundleVersion);
    expect(await readFile(path.join(destination, 'SKILL.md'), 'utf8')).toContain('Test Skill');
    if (record.method === 'symlink') expect(await realpath(destination)).toBe(await realpath(path.join(state.home, '.agentman/bundles', session.bundleVersion!, 'test-skill')));
    else { expect(record.method).toBe('copy'); expect((await lstat(destination)).isSymbolicLink()).toBe(false); }
    const removed = await api(ui, '/api/installs/test-skill?scope=system&toolId=claude-code', 'DELETE');
    expect(removed.status).toBe(200);
    await expect(lstat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(await readFile(configPath, 'utf8')).installations['claude-code']?.['test-skill']).toBeUndefined();
  } finally { await stream.close(); }
});
