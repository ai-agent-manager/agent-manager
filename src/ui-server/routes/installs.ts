import { listInstalled, resolveIdentifier, updateInstalled, removeInstalled } from '../../operations/manage.js';
import { installResolvedSkills } from '../../operations/install.js';
import { effectiveBundleVersion } from '../../operations/catalogue.js';
import { createDiscoveryAccessTokenProvider } from '../../auth/access-token-provider.js';
import { withMutation } from '../../lib/mutation.js';
import { mergeInstallResults } from '../../lib/merge-install-results.js';
import type { InstallScope } from '../../config/scopes.js';
import type { InstallResult } from '../../provisioners/types.js';
import { installedDto, installResultDto, safeText } from '../dto.js';
import { ConflictError } from '../errors.js';
import { readJsonBody, sendJson } from '../http.js';
import * as v from '../validate.js';
import type { Router } from '../router.js';
import type { SessionStore } from '../session-store.js';
import type { JobRegistry } from '../jobs.js';

export function installRoutes(router: Router, sessions: SessionStore, jobs: JobRegistry, defaultRoot: string | null): void {
  const root = async (value: unknown, scope?: string) => {
    if (scope === 'system' && value === undefined) return undefined;
    if (value !== undefined || scope === 'repo') return v.assertRepoRoot(value, defaultRoot);
    return defaultRoot ? v.assertRepoRoot(undefined, defaultRoot) : undefined;
  };
  router.route('GET', '/api/installs', async ({ res, query }) => {
    const fields = v.query(query, ['scope', 'repoRoot']);
    const scope = fields.scope === undefined ? 'all' : v.choice(fields.scope, 'scope', ['system', 'repo', 'all']);
    const repoRoot = await root(fields.repoRoot, scope);
    sendJson(res, 200, { records: (await listInstalled(scope === 'all' && !repoRoot ? 'system' : scope, { repoRoot })).map(installedDto) });
  });
  router.route('GET', '/api/installs/:installKey', async ({ res, params, query }) => {
    const fields = v.query(query, ['scope', 'toolId', 'repoRoot']);
    const scope = fields.scope === undefined ? undefined : v.choice(fields.scope, 'scope', ['system', 'repo']);
    const toolId = fields.toolId === undefined ? undefined : v.tool(fields.toolId);
    const repoRoot = await root(fields.repoRoot, scope);
    sendJson(res, 200, { record: installedDto(await resolveIdentifier(v.identifier(params.installKey, 'installKey'),
      scope ?? (repoRoot ? undefined : 'system'), toolId, { repoRoot })) });
  });
  router.route('POST', '/api/installs', async ({ req, res, query }) => {
    v.query(query, []);
    const fields = v.object(await readJsonBody(req), ['sessionRevision', 'skillId', 'installKey', 'scope', 'repoRoot', 'toolIds']);
    const revision = v.revision(fields.sessionRevision);
    const skillId = v.identifier(fields.skillId, 'skillId');
    const installKey = v.identifier(fields.installKey, 'installKey');
    const scope = v.choice(fields.scope, 'scope', ['system', 'repo']);
    const toolIds = v.tools(fields.toolIds);
    const repoRoot = await root(fields.repoRoot, scope);
    const captured = await sessions.candidate(revision, skillId, installKey, scope, repoRoot);
    const fingerprint = JSON.stringify(captured.skill);
    const id = jobs.start('install', async (ctx) => {
      ctx.phase('commit');
      return withMutation(async () => {
        const candidate = await sessions.candidate(revision, skillId, installKey, scope, repoRoot);
        if (JSON.stringify(candidate.skill) !== fingerprint) throw new ConflictError('The repository catalogue changed. Refresh and select the skill again.', 'CANDIDATE_CHANGED');
        // Revalidate the repository immediately before filesystem mutation.
        if (scope === 'repo') await v.assertRepoRoot(repoRoot, defaultRoot);
        const session = sessions.assertRevision(revision);
        const results: InstallResult[] = [];
        for (const toolId of toolIds) {
          ctx.progress(`Installing ${skillId} for ${toolId}...`);
          results.push(await installResolvedSkills({ skills: [candidate.skill], scope, repoRoot, toolId, bundleVersion: effectiveBundleVersion(session) }));
        }
        return { result: installResultDto(mergeInstallResults(results)) };
      });
    });
    sendJson(res, 202, { jobId: id });
  });
  async function instance(fields: Record<string, unknown>): Promise<{ scope: InstallScope; toolId: string; repoRoot?: string }> {
    const scope = v.choice(fields.scope, 'scope', ['system', 'repo']);
    const toolId = v.tool(fields.toolId);
    return { scope, toolId, repoRoot: await root(fields.repoRoot, scope) };
  }
  router.route('POST', '/api/installs/:installKey/update', async ({ req, res, params, query }) => {
    v.query(query, []); sessions.assertAuthAvailable();
    const fields = v.object(await readJsonBody(req), ['scope', 'toolId', 'repoRoot']);
    const { scope, toolId, repoRoot } = await instance(fields);
    const key = v.identifier(params.installKey, 'installKey');
    const captured = await resolveIdentifier(key, scope, toolId, { repoRoot });
    const source = sessions.current()?.source;
    const getToken = createDiscoveryAccessTokenProvider(source?.type === 'discovery' ? { baseUrl: source.baseUrl, document: source.discovery } : null);
    sessions.assertAuthAvailable();
    const id = jobs.start('install-update', async (ctx) => {
      if (JSON.stringify(await resolveIdentifier(key, scope, toolId, { repoRoot })) !== JSON.stringify(captured)) throw new ConflictError('The installation changed. Refresh and retry.', 'INSTALL_CHANGED');
      ctx.phase('download');
      const result = await updateInstalled(key, scope, toolId, (contentUrl) => ctx.auth(() => getToken(contentUrl, { onAuthPrompt: ctx.authPrompt, signal: ctx.signal })), { repoRoot });
      return { result: installResultDto(result) };
    });
    sendJson(res, 202, { jobId: id });
  });
  router.route('DELETE', '/api/installs/:installKey', async ({ req, res, params, query }) => {
    const fields = v.query(query, ['scope', 'toolId', 'repoRoot']);
    v.object(await readJsonBody(req), []);
    const { scope, toolId, repoRoot } = await instance(fields);
    const result = await removeInstalled(v.identifier(params.installKey, 'installKey'), scope, toolId, { repoRoot });
    sendJson(res, 200, { result: { removed: result.removed.map(({ name }) => ({ name })), errors: result.errors.map(({ name, error }) => ({ name, error: safeText(error) })) } });
  });
}
