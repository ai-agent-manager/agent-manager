import { createHash } from 'node:crypto';
import { listBundles, listRemoteVersions, downloadBundleVersion, selectBundle, removeBundle,
  listSkillVersionInstances, listInstalledSkillVersions, switchInstalledSkillVersion,
  type ManagedBundle, type InstalledInstance } from '../../operations/versions.js';
import { loadBundleVersion, type Session } from '../../operations/session.js';
import { getBundleVersionDir } from '../../config/paths.js';
import { getCurrentBundleVersion } from '../../bundle/cache.js';
import { canonicaliseContentRoot } from '../../bundle/downloader.js';
import { buildPinForDirectorySource, buildSourcePin } from '../../bundle/skill-source.js';
import { assertBundleVersion, resolvePinnedBundle } from '../../bundle/version-identity.js';
import { withMutation } from '../../lib/mutation.js';
import { installedDto, safeText, safeUrl } from '../dto.js';
import { ConflictError, HttpError, ValidationError } from '../errors.js';
import { readJsonBody, sendJson, requestMutation } from '../http.js';
import * as v from '../validate.js';
import type { Router } from '../router.js';
import type { SessionStore } from '../session-store.js';
import type { JobRegistry } from '../jobs.js';
import type { BundleDto, RemoteBundleDto } from '../api-types.js';

function remoteSources(session: Session) {
  const source = session.source;
  if (source?.type === 'url') return [{ baseUrl: source.baseUrl, name: undefined as string | undefined }];
  if (source?.type === 'discovery') return source.discovery.sources.filter((item) => item.type === 'http')
    .map((item) => ({ baseUrl: canonicaliseContentRoot(item.url), name: item.name }));
  return [];
}
function bundleDto(entry: ManagedBundle): BundleDto {
  return { bundleId: entry.bundleId, removalId: entry.removalId, version: entry.version, published: entry.published,
    source: entry.contentRoot ? { type: 'url', value: safeUrl(entry.contentRoot), name: entry.sourceName }
      : entry.directory ? { type: 'directory', value: entry.directory } : undefined,
    cacheKind: entry.cacheKind, isCurrent: entry.isCurrent, canSelect: false,
    reason: entry.unsupportedReason ? safeText(entry.unsupportedReason) : undefined };
}
async function selectable(session: Session, entry: ManagedBundle): Promise<string | undefined> {
  if (!entry.bundleId) return entry.unsupportedReason ?? 'The cache has no verified source identity.';
  if (entry.cacheKind !== 'flat') return 'Select named-source bundle versions for each installed skill.';
  const source = session.source;
  if (!source || source.type === 'discovery') return 'HTTP discovery catalogues select versions per installed skill. Global catalogue selection requires a directory source.';
  const pin = source.type === 'url'
    ? buildSourcePin({ type: 'bundle', baseUrl: source.baseUrl, installLayout: 'flat' }, entry.version)
    : buildPinForDirectorySource(source.dirPath, entry.version);
  try { await resolvePinnedBundle(pin, entry.version); return undefined; }
  catch { return 'This bundle belongs to a different source, or its origin cannot be verified.'; }
}
export function versionRoutes(router: Router, sessions: SessionStore, jobs: JobRegistry, defaultRoot: string | null): void {
  // Only indices observed for this exact session can authorize downloads. No
  // version, URL, source pin, or cache pathname is accepted from the browser.
  let remote = new Map<string, { revision: number; version: string; baseUrl: string; name?: string }>();
  const repo = (value: unknown) => value !== undefined || defaultRoot ? v.assertRepoRoot(value, defaultRoot) : Promise.resolve(undefined);
  async function instance(fields: Record<string, unknown>, key: unknown): Promise<InstalledInstance> {
    const scope = v.choice(fields.scope, 'scope', ['system', 'repo']);
    if (scope === 'system' && fields.repoRoot !== undefined) throw new ValidationError('Repository root is only valid for repository scope.');
    return { installKey: v.identifier(key, 'installKey'), toolId: v.tool(fields.toolId), scope,
      repoRoot: scope === 'repo' ? await v.assertRepoRoot(fields.repoRoot, defaultRoot) : undefined };
  }
  router.route('GET', '/api/bundles', async ({ res, query }) => {
    v.query(query, []);
    const session = sessions.current();
    const revision = sessions.snapshot().sessionRevision;
    const cached = await Promise.all((await listBundles()).map(async (entry) => {
      const dto = bundleDto(entry);
      dto.reason = session ? await selectable(session, entry) : dto.reason ?? 'Load a catalogue before selecting a bundle.';
      dto.canSelect = !dto.reason;
      dto.canRemove = !!entry.removalId && !entry.isCurrent && !sessions.usesBundle(entry.bundleDir);
      dto.removalReason = sessions.usesBundle(entry.bundleDir) ? 'This bundle serves the live catalogue. Load another source before removing it.' : entry.isCurrent ? 'Cannot remove the currently active bundle.' : undefined;
      return dto;
    }));
    if (revision !== sessions.snapshot().sessionRevision) throw new ConflictError('Session changed. Refresh the versions.', 'STALE_SESSION');
    sendJson(res, 200, { cached, current: await getCurrentBundleVersion(), canBrowseRemote: !!session && remoteSources(session).length > 0,
      reason: session && remoteSources(session).length ? undefined : 'Remote versions require an HTTP bundle source.' });
  });
  router.route('GET', '/api/bundles/remote', async ({ res, query }) => {
    v.query(query, []); sessions.assertAuthAvailable();
    const revision = sessions.snapshot().sessionRevision;
    const session = sessions.assertRevision(revision);
    const choices = new Map<string, { revision: number; version: string; baseUrl: string; name?: string }>();
    const bundles: RemoteBundleDto[] = [];
    const signal = AbortSignal.timeout(15_000);
    for (const source of remoteSources(session)) {
      sessions.assertAuthAvailable(); sessions.assertRevision(revision);
      // Read-only requests may refresh cached credentials, but never start an
      // interactive flow. Login has its own cancellable job and visible prompt.
      const entries = await listRemoteVersions({ type: 'url', baseUrl: source.baseUrl }, session.authSession, { signal }).catch((error: unknown) => {
        if (signal.aborted) throw new HttpError(504, 'Remote versions timed out. Finish any active sign-in, then retry.', 'REMOTE_TIMEOUT');
        throw error;
      });
      sessions.assertRevision(revision);
      for (const entry of entries) {
        assertBundleVersion(entry.version);
        if (choices.size >= 10_000) throw new ConflictError('The remote index is too large to browse.');
        const bundleId = createHash('sha256').update(JSON.stringify([revision, source, entry.version])).digest('hex');
        choices.set(bundleId, { revision, version: entry.version, ...source });
        bundles.push({ bundleId, version: entry.version, published: entry.published,
          source: { type: 'url', value: safeUrl(source.baseUrl), name: source.name } });
      }
    }
    sessions.assertRevision(revision); remote = choices;
    sendJson(res, 200, { bundles, sessionRevision: revision });
  });
  router.route('POST', '/api/bundles/download', async ({ req, res, query }) => {
    v.query(query, []);
    const body = v.object(await readJsonBody(req), ['sessionRevision', 'bundleId']);
    const revision = v.revision(body.sessionRevision);
    const session = sessions.assertRevision(revision);
    sessions.assertAuthAvailable();
    const selected = remote.get(v.bundleId(body.bundleId));
    if (!selected || selected.revision !== revision) throw new ConflictError('Refresh remote versions and select a bundle again.', 'STALE_BUNDLE');
    const jobId = jobs.start('bundle-download', async (ctx) => {
      sessions.assertRevision(revision); ctx.phase('download');
      await downloadBundleVersion({ type: 'url', baseUrl: selected.baseUrl }, selected.version, session.authSession, {
        sourceName: selected.name, signal: ctx.signal, onProgress: ctx.progress, onAuthPrompt: ctx.authPrompt,
        runAuth: (run) => { sessions.assertAuthAvailable(); sessions.assertRevision(revision); return ctx.auth(run); },
        beforeCommit: () => { sessions.assertRevision(revision); ctx.phase('commit'); },
      });
      return {};
    });
    sendJson(res, 202, { jobId });
  });
  router.route('POST', '/api/bundles/current', async ({ req, res, query }) => {
    v.query(query, []);
    const body = v.object(await readJsonBody(req), ['sessionRevision', 'bundleId', 'syncInstalled', 'repoRoot']);
    const revision = v.revision(body.sessionRevision), id = v.bundleId(body.bundleId);
    sessions.assertRevision(revision);
    const syncInstalled = v.boolean(body.syncInstalled, 'syncInstalled');
    if (syncInstalled === undefined) throw new ValidationError('Choose whether to sync installed skills.');
    const repoRoot = body.repoRoot === undefined ? undefined : await v.assertRepoRoot(body.repoRoot, defaultRoot);
    const jobId = jobs.start('bundle-select', async (ctx) => withMutation(async () => {
      ctx.phase('commit');
      const session = sessions.assertRevision(revision);
      const entry = (await listBundles()).find((item) => item.bundleId === id);
      if (!entry) throw new ConflictError('Bundle selection is stale. Refresh and retry.', 'STALE_BUNDLE');
      const reason = await selectable(session, entry);
      if (reason) throw new ConflictError(reason, 'UNSUPPORTED_BUNDLE');
      const warnings: string[] = [];
      const loaded = await loadBundleVersion(entry.version, { source: session.source, onProgress: ctx.progress, onWarning: (message) => warnings.push(message) });
      if (repoRoot) await v.assertRepoRoot(repoRoot, defaultRoot);
      sessions.assertRevision(revision);
      const result = await selectBundle(id, { syncInstalled, repoRoot, scope: repoRoot ? 'all' : 'system' });
      const published = await sessions.publishBundle(revision, { ...loaded, warnings });
      return { failures: result.failures.map(safeText), superseded: !published };
    }));
    sendJson(res, 202, { jobId });
  });
  router.route('DELETE', '/api/bundles/:bundleId', async ({ req, res, params, query }) => {
    v.query(query, []); v.object(await readJsonBody(req), []);
    await requestMutation(res, () => removeBundle(v.bundleId(params.bundleId), (entry) => {
      if (sessions.usesBundle(entry.bundleDir)) throw new ConflictError('This bundle serves the live catalogue. Load another source before removing it.', 'BUNDLE_IN_USE');
    })); sendJson(res, 200, {});
  });
  router.route('GET', '/api/skill-versions', async ({ res, query }) => {
    const fields = v.query(query, ['repoRoot']);
    const repoRoot = await repo(fields.repoRoot);
    sendJson(res, 200, { instances: (await listSkillVersionInstances(repoRoot, repoRoot ? 'all' : 'system')).map(installedDto) });
  });
  router.route('GET', '/api/skill-versions/:installKey/available', async ({ res, params, query }) => {
    const fields = v.query(query, ['scope', 'toolId', 'repoRoot']);
    const selected = await instance(fields, params.installKey);
    const available = await listInstalledSkillVersions(selected);
    sendJson(res, 200, { supported: !available.unsupportedReason, reason: available.unsupportedReason ? safeText(available.unsupportedReason) : undefined,
      bundles: available.versions.map((entry) => ({ ...bundleDto({ ...entry, cacheKind: entry.bundleDir === getBundleVersionDir(entry.version) ? 'flat' : 'named' }), canSelect: entry.hasSkill,
        hasSkill: entry.hasSkill, reason: entry.hasSkill ? undefined : 'This version does not contain the skill.' })) });
  });
  router.route('PUT', '/api/skill-versions', async ({ req, res, query }) => {
    v.query(query, []);
    const body = v.object(await readJsonBody(req), ['sessionRevision', 'bundleId', 'toolId', 'installKey', 'scope', 'repoRoot']);
    const revision = v.revision(body.sessionRevision), id = v.bundleId(body.bundleId);
    sessions.assertRevision(revision);
    const selected = await instance(body, body.installKey);
    const available = await listInstalledSkillVersions(selected);
    sessions.assertRevision(revision);
    if (available.unsupportedReason) throw new ConflictError(available.unsupportedReason, 'UNSUPPORTED_BUNDLE');
    const candidate = available.versions.find((entry) => entry.bundleId === id);
    if (!candidate) throw new ConflictError('Bundle selection is stale or belongs to another source. Refresh and retry.', 'STALE_BUNDLE');
    if (!candidate.hasSkill) throw new ConflictError('This version does not contain the skill.', 'SKILL_UNAVAILABLE');
    const jobId = jobs.start('skill-version-select', async (ctx) => withMutation(async () => {
      ctx.phase('commit'); sessions.assertRevision(revision);
      if (selected.repoRoot) await v.assertRepoRoot(selected.repoRoot, defaultRoot);
      sessions.assertRevision(revision);
      await switchInstalledSkillVersion(selected, id);
      return { success: true };
    }));
    sendJson(res, 202, { jobId });
  });
}
