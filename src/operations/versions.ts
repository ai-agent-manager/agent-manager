import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { assertBundleUnreferenced } from '../bundle/references.js';
import type { BundleIdentity } from '../bundle/version-identity.js';
import { OperationConflictError } from '../lib/mutation.js';
import { listPinnedBundles, readBundleIdentity, resolvePinnedBundle } from '../bundle/version-identity.js';
import { withMutation } from '../lib/mutation.js';
import { checkOperationCancelled, withOperationCancellation } from './cancellation.js';
import { downloadBundle, fetchIndex } from '../bundle/downloader.js';
import { extractBundle } from '../bundle/extractor.js';
import { listCachedBundles, getCurrentBundleVersion, setCurrentBundle, updateSkillVersion, type CachedBundle } from '../bundle/cache.js';
import { scanBundle } from '../bundle/scanner.js';
import type { BundleSource } from '../bundle/source.js';
import { getBundlesDir, getBundleVersionDir } from '../config/paths.js';
import { getSkillTools } from '../config/tools.js';
import { getValidBearerToken, type AuthSession } from '../auth/index.js';
import { getBundleSourceTelemetryProperties, trackTelemetryError } from '../telemetry.js';
import { listInstalled } from './manage.js';
import type { SessionEvents } from './session.js';

export interface VersionAvailability {
  version: string;
  hasSkill: boolean;
  published: string;
  isCurrent: boolean;
}

async function resolveBearer(session?: AuthSession, signal?: AbortSignal) {
  if (!session) return undefined;
  return getValidBearerToken(session.discoveryBaseUrl, session.auth, ...(signal ? [{ signal }] : []));
}

export async function listRemoteVersions(source: BundleSource, auth?: AuthSession, events: SessionEvents = {}) {
  return withOperationCancellation(events.signal, async () => {
    if (source.type !== 'url') throw new Error('Remote bundle versions require a bundle URL source.');
    const bearer = await resolveBearer(auth, events.signal);
    checkOperationCancelled(events.signal);
    const index = await fetchIndex(source.baseUrl, bearer);
    return index.agents;
  });
}

/** Download only; selecting the current bundle remains a separate operation. */
export async function downloadBundleVersion(
  source: BundleSource, version: string, auth?: AuthSession, events: SessionEvents = {},
) {
  return withOperationCancellation(events.signal, async () => {
    if (source.type !== 'url') throw new Error('Bundle downloads require a bundle URL source.');
    const bearer = await resolveBearer(auth, events.signal);
    checkOperationCancelled(events.signal);
    events.onProgress?.(`Downloading bundle ${version}...`);
    const { zipPath } = await downloadBundle(source.baseUrl, version, bearer);
    checkOperationCancelled(events.signal);
    try {
      events.onProgress?.('Extracting bundle...');
      return await extractBundle(zipPath, { contentRoot: source.baseUrl });
    } catch (error) {
      checkOperationCancelled(events.signal);
      trackTelemetryError('bundle_extract_failed', error, {
        ...getBundleSourceTelemetryProperties(source), version,
      });
      throw error;
    }
  });
}

export interface ManagedBundle extends CachedBundle {
  bundleId?: string;
  contentRoot?: string;
  unsupportedReason?: string;
}

/** Inventory includes named-source caches; only verified entries receive IDs. */
export async function listBundles(): Promise<ManagedBundle[]> {
  const entries = await listCachedBundles();
  const sources = path.join(getBundlesDir(), 'sources');
  for (const source of await readdir(sources, { withFileTypes: true }).catch(() => [])) {
    if (!source.isDirectory()) continue;
    const sourceDir = path.join(sources, source.name);
    for (const version of await readdir(sourceDir, { withFileTypes: true })) {
      if (!version.isDirectory()) continue;
      entries.push({ version: version.name, published: '', bundleDir: path.join(sourceDir, version.name), isCurrent: false });
    }
  }
  const result: ManagedBundle[] = [];
  for (const entry of entries) {
    try {
      const identity = await readBundleIdentity(entry.bundleDir);
      result.push({ ...entry, ...identity });
    } catch (error) {
      result.push({ ...entry, unsupportedReason: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

async function resolveBundleId(bundleId: string): Promise<BundleIdentity> {
  const entry = (await listBundles()).find((bundle) => bundle.bundleId === bundleId);
  if (!entry) throw new OperationConflictError('Bundle selection is stale or unsupported.');
  return readBundleIdentity(entry.bundleDir);
}

export async function removeBundle(bundleId: string): Promise<void> {
  return withMutation(async () => {
    const entry = await resolveBundleId(bundleId);
    if (entry.bundleDir === getBundleVersionDir(await getCurrentBundleVersion() ?? '')) {
      throw new OperationConflictError('Cannot remove the currently active bundle.');
    }
    await assertBundleUnreferenced(entry.version, entry.bundleDir);
    await rm(entry.bundleDir, { recursive: true, force: true });
  });
}

export async function selectBundle(bundleId: string, options: { syncInstalled: boolean; repoRoot?: string }): Promise<{ failures: string[] }> {
  return withMutation(async () => {
    const entry = await resolveBundleId(bundleId);
    if (entry.bundleDir !== getBundleVersionDir(entry.version)) {
      throw new OperationConflictError('Named-source bundles are selected per installed skill.');
    }
    return switchBundleVersion({ ...options, version: entry.version });
  });
}

export async function listSkillVersionInstances(repoRoot?: string) {
  const records = await listInstalled('all', { repoRoot });
  return records.map((record) => ({
    ...record,
    skillName: record.installKey,
    toolName: getSkillTools().find((tool) => tool.id === record.toolId)?.name ?? record.toolId,
    currentVersion: record.version,
  }));
}

/** Legacy read-only inventory. Installation choices use listInstalledSkillVersions. */
export async function listVersionsContainingSkill(
  skillName: string,
  bundles?: CachedBundle[],
): Promise<VersionAvailability[]> {
  const versions: VersionAvailability[] = [];
  for (const bundle of bundles ?? await listCachedBundles()) {
    let hasSkill = false;
    try {
      const contents = await scanBundle(getBundleVersionDir(bundle.version));
      hasSkill = contents.skills.some((skill) => skill.dirName === skillName);
    } catch {
      // Unreadable cached versions remain visible, but cannot be selected.
    }
    versions.push({ version: bundle.version, hasSkill, published: bundle.published, isCurrent: bundle.isCurrent });
  }
  return versions;
}

/** Legacy TUI wrapper; HTTP callers select a verified bundle ID. */
export async function switchBundleVersion(options: {
  version: string; syncInstalled: boolean; repoRoot?: string;
}): Promise<{ failures: string[] }> {
  return withMutation(async () => {
    const selected = await readBundleIdentity(getBundleVersionDir(options.version));
    const current = await getCurrentBundleVersion();
    if (current) {
      const active = await readBundleIdentity(getBundleVersionDir(current)).catch(() => undefined);
      if (active && active.origin !== selected.origin) throw new OperationConflictError('The selected version belongs to a different active source.');
    }
    await setCurrentBundle(options.version);
    const failures: string[] = [];
    if (options.syncInstalled) {
      for (const record of await listInstalled('all', { repoRoot: options.repoRoot })) {
        // A global flat-bundle choice does not select versions for other sources.
        if (record.sourcePin?.sourceType !== 'bundle' || record.sourcePin.bundleSourceName) continue;
        const compatible = await resolvePinnedBundle(record.sourcePin, options.version).catch(() => undefined);
        if (!compatible) {
          failures.push(`${record.toolId}/${record.installKey}: skipped; this installation's origin could not be verified for the selected version. Select its version individually.`);
          continue;
        }
        const result = await updateSkillVersion(record.toolId, record.installKey, options.version,
          ...(record.scope === 'repo' ? [{ scope: 'repo' as const, repoRoot: record.repoRoot }] : []));
        if (!result.success) {
          failures.push(`${record.toolId}/${record.installKey}${record.scope === 'repo' ? ' (repo)' : ''}: ${result.error ?? 'Unknown error'}`);
        }
      }
    }
    return { failures };
  });
}

export interface InstalledInstance {
  installKey: string;
  toolId: string;
  scope: 'system' | 'repo';
  repoRoot?: string;
}

/** Re-read the exact instance; caller snapshots never authorize writes. */
async function readInstance(instance: InstalledInstance) {
  if (instance.scope === 'repo' && !instance.repoRoot) throw new OperationConflictError('repoRoot is required');
  const records = await listInstalled(instance.scope, { repoRoot: instance.repoRoot });
  const record = records.find((item) => item.installKey === instance.installKey && item.toolId === instance.toolId && item.scope === instance.scope);
  if (!record) throw new OperationConflictError('The selected installation no longer exists.');
  return record;
}

export async function listInstalledSkillVersions(instance: InstalledInstance) {
  const record = await readInstance(instance);
  const result = await listPinnedBundles(record.sourcePin);
  const versions = [];
  for (const bundle of result.bundles) {
    const contents = await scanBundle(bundle.bundleDir);
    versions.push({ ...bundle, hasSkill: contents.skills.some((skill) => skill.dirName === record.skillId), isCurrent: bundle.version === record.version });
  }
  return { versions, unsupportedReason: result.unsupportedReason };
}

/** Opaque IDs are resolved against source-constrained, revalidated cache entries. */
export async function switchInstalledSkillVersion(instance: InstalledInstance, bundleId: string): Promise<void> {
  return withMutation(async () => {
    const { versions, unsupportedReason } = await listInstalledSkillVersions(instance);
    const candidate = versions.find((item) => item.bundleId === bundleId && item.hasSkill);
    if (!candidate) throw new OperationConflictError(unsupportedReason ?? 'Bundle selection is stale or belongs to another source.');
    const result = await updateSkillVersion(instance.toolId, instance.installKey, candidate.version, instance);
    if (!result.success) {
      if (result.statusCode === 409) throw new OperationConflictError(result.error ?? 'Version selection is no longer supported');
      throw new Error(result.error ?? 'Version switch failed');
    }
  });
}
