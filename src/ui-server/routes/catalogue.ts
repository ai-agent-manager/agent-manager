import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { buildSessionCatalogue, buildRepositoryCatalogue } from '../../operations/catalogue.js';
import { catalogueDto } from '../dto.js';
import { HttpError, ValidationError } from '../errors.js';
import { sendJson } from '../http.js';
import * as v from '../validate.js';
import type { Router } from '../router.js';
import type { SessionStore } from '../session-store.js';

export function catalogueRoutes(router: Router, sessions: SessionStore, defaultRoot: string | null): void {
  router.route('GET', '/api/catalogue/skills/:skillId', async ({ res, params, query }) => {
    const fields = v.query(query, ['scope', 'repoRoot']);
    const scope = fields.scope === undefined ? 'system' : v.choice(fields.scope, 'scope', ['system', 'repo']);
    const repoRoot = scope === 'repo' ? await v.assertRepoRoot(fields.repoRoot, defaultRoot) : undefined;
    if (fields.repoRoot !== undefined && scope !== 'repo') throw new ValidationError('repoRoot requires repository scope.');
    const skillId = v.identifier(params.skillId, 'skillId');
    const revision = sessions.snapshot().sessionRevision;
    const session = sessions.assertRevision(revision);
    const catalogue = repoRoot ? await buildRepositoryCatalogue(session, repoRoot) : buildSessionCatalogue(session);
    const entry = catalogue.find((item) => item.kind === 'skill' && item.skillId === skillId);
    if (!entry || entry.kind !== 'skill') throw new HttpError(404, 'Skill not found in the permitted catalogue.', 'NOT_FOUND');
    let readme: string | undefined;
    const candidate = entry.candidates.length === 1 ? entry.candidates[0] : undefined;
    if (candidate) {
      const root = await realpath(candidate.skill.dirPath);
      for (const name of ['README.md', 'SKILL.md']) {
        try {
          const file = await realpath(path.join(root, name));
          if (path.dirname(file) !== root) continue;
          const handle = await open(file, 'r');
          try {
            const buffer = Buffer.alloc(256 * 1024);
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
            readme = buffer.subarray(0, bytesRead).toString('utf8');
          } finally { await handle.close(); }
          break;
        } catch { /* A description is sufficient when no readable README exists. */ }
      }
    }
    sessions.assertRevision(revision);
    sendJson(res, 200, { entry: catalogueDto([entry])[0], readme });
  });
}
