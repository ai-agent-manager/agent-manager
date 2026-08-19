import { readConfig, getRecordVersion } from '../bundle/cache.js';
import { readRepoConfig } from '../bundle/repo-config.js';
import { findRepoRoot } from '../lib/repo.js';
import type { InstallScope } from '../config/scopes.js';
import type { SkillSourcePin } from '../bundle/skill-source.js';
import type { InstallResult, UninstallResult } from '../provisioners/types.js';
import { createSkillProvisioner } from '../provisioners/registry.js';
import { installFromRepo, installFromArtefact, installFromBundle } from './install.js';

/** Supplies a bearer token for a pinned content URL when one is available. */
export type AccessTokenProvider = (contentUrl: string) => Promise<string | undefined>;

export interface InstalledSkillRecord {
  /** Config key, e.g. "github.com/org/repo/my-skill" or "my-skill" */
  installKey: string;
  /** Bare skill directory name */
  skillId: string;
  toolId: string;
  scope: InstallScope;
  repoRoot?: string;
  sourcePin?: SkillSourcePin;
  /** Best-effort display version: bundle version, artefact version, or repo ref. */
  version: string;
  installedAt: string;
  method: 'symlink' | 'copy';
  /** Resolved flat link name as it appears on disk */
  linkName: string;
}

/** Thrown when a bare id matches more than one installed skill. */
export class AmbiguousIdentifierError extends Error {
  readonly matches: InstalledSkillRecord[];
  constructor(id: string, matches: InstalledSkillRecord[]) {
    const summary = matches
      .map((m) => `  ${m.installKey} (tool: ${m.toolId}, scope: ${m.scope === 'system' ? 'local' : m.scope})`)
      .join('\n');
    super(
      `Ambiguous identifier '${id}'. Matches:\n${summary}\n` +
        `  Use the fully qualified key to disambiguate.`,
    );
    this.matches = matches;
  }
}

export class SkillNotFoundError extends Error {
  constructor(id: string) {
    super(`No installed skill found matching '${id}'.`);
  }
}

/**
 * Enumerate all installed skills across all tools and both scopes.
 * When scopeFilter is set, only that scope's installs are returned.
 */
export async function listInstalled(
  scopeFilter?: InstallScope | 'all',
): Promise<InstalledSkillRecord[]> {
  const records: InstalledSkillRecord[] = [];

  const includeSystem = !scopeFilter || scopeFilter === 'all' || scopeFilter === 'system';
  const includeRepo = !scopeFilter || scopeFilter === 'all' || scopeFilter === 'repo';

  if (includeSystem) {
    const config = await readConfig();
    for (const [toolId, toolInstalls] of Object.entries(config.installations)) {
      for (const [key, rec] of Object.entries(toolInstalls)) {
        records.push(toRecord(key, toolId, 'system', rec, undefined));
      }
    }
  }

  if (includeRepo) {
    const repoRoot = await findRepoRoot();
    if (repoRoot) {
      const repoConfig = await readRepoConfig(repoRoot);
      if (repoConfig) {
        for (const [toolId, toolInstalls] of Object.entries(repoConfig.installations)) {
          for (const [key, rec] of Object.entries(toolInstalls)) {
            records.push(toRecord(key, toolId, 'repo', rec, repoRoot));
          }
        }
      }
    }
  }

  return records;
}

function toRecord(
  installKey: string,
  toolId: string,
  scope: InstallScope,
  rec: {
    bundleVersion?: string;
    sourcePin?: SkillSourcePin;
    installedAt: string;
    method: 'symlink' | 'copy';
    linkName?: string;
  },
  repoRoot: string | undefined,
): InstalledSkillRecord {
  const segments = installKey.split('/');
  const skillId = segments[segments.length - 1]!;
  const version =
    getRecordVersion(rec) || rec.sourcePin?.artefactVersion || rec.sourcePin?.ref || '';
  return {
    installKey,
    skillId,
    toolId,
    scope,
    ...(repoRoot ? { repoRoot } : {}),
    ...(rec.sourcePin ? { sourcePin: rec.sourcePin } : {}),
    version,
    installedAt: rec.installedAt,
    method: rec.method,
    linkName: rec.linkName ?? skillId,
  };
}

/**
 * Resolve a bare skill name or fully qualified install key to a single record.
 *
 * Exact installKey match wins; otherwise a bare skillId match is accepted when
 * unambiguous. Ambiguity throws AmbiguousIdentifierError so the caller can
 * present the qualified alternatives instead of guessing.
 *
 * `toolId` narrows the candidates to a single tool. The same skill installed
 * for several tools yields one record per tool — all sharing an installKey —
 * so a caller that already knows which tool it is acting on (e.g. a row picked
 * in the installed list) must pass it, or the lookup is ambiguous by
 * construction.
 */
export async function resolveIdentifier(
  id: string,
  scopeHint?: InstallScope,
  toolId?: string,
): Promise<InstalledSkillRecord> {
  const candidates = await listInstalled(scopeHint ?? 'all');
  const all = toolId ? candidates.filter((r) => r.toolId === toolId) : candidates;

  const exact = all.filter((r) => r.installKey === id);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) throw new AmbiguousIdentifierError(id, exact);

  const bySkillId = all.filter((r) => r.skillId === id);
  if (bySkillId.length === 1) return bySkillId[0]!;
  if (bySkillId.length > 1) throw new AmbiguousIdentifierError(id, bySkillId);

  throw new SkillNotFoundError(id);
}

/**
 * Re-pull the skill from its pinned source and reinstall.
 */
export async function updateInstalled(
  id: string,
  scopeHint?: InstallScope,
  toolIdHint?: string,
  getAccessToken?: AccessTokenProvider,
): Promise<InstallResult> {
  const record = await resolveIdentifier(id, scopeHint, toolIdHint);
  const { sourcePin, toolId, scope, repoRoot } = record;

  if (!sourcePin) {
    throw new Error(
      `Cannot update '${id}': no source pin recorded. ` +
        `Re-install the skill with the current version of agentman.`,
    );
  }

  if (sourcePin.sourceType === 'repo' && sourcePin.repoUrl) {
    const opResult = await installFromRepo({
      repoUrl: sourcePin.repoUrl,
      ref: sourcePin.ref,
      skillNames: [record.skillId],
      scope,
      toolId,
      repoRoot,
      forceUpdate: true,
    });
    return opResult.result;
  }

  if (sourcePin.sourceType === 'artefact' && sourcePin.artefactUrl) {
    // Deliberately not passing the pinned sha256: an update must accept a
    // republished artefact, re-verifying against the .sha256 sidecar and
    // re-pinning the new hash. The pin guards reproduce-installs, not updates.
    const opResult = await installFromArtefact({
      artefactUrl: sourcePin.artefactUrl,
      scope,
      toolId,
      repoRoot,
      forceUpdate: true,
      bearerToken: await getAccessToken?.(sourcePin.artefactUrl),
    });
    return opResult.result;
  }

  if (sourcePin.sourceType === 'bundle') {
    const pinnedUrl = sourcePin.bundleBaseUrl;
    if (!pinnedUrl) {
      throw new Error(
        `Cannot update '${id}': bundle source has no URL (local directory installs cannot be updated).`,
      );
    }
    // A pin without a source name predates content-root addressing, so its URL
    // is a base the client used to append `/agents/` to. Appending it here
    // reproduces exactly the URLs that install fetched — without it the pinned
    // URL is frozen at a path the publisher never served, and no publisher-side
    // migration could reach it.
    const bundleUrl = sourcePin.bundleSourceName ? pinnedUrl : `${pinnedUrl.replace(/\/+$/, '')}/agents`;
    const opResult = await installFromBundle({
      bundleUrl,
      ...(sourcePin.bundleSourceName ? { sourceName: sourcePin.bundleSourceName } : {}),
      bearerToken: await getAccessToken?.(bundleUrl),
      skillNames: [record.skillId],
      scope,
      toolId,
      repoRoot,
      forceUpdate: true,
    });
    return opResult.result;
  }

  throw new Error(`Cannot update '${id}': unrecognised source type '${sourcePin.sourceType}'.`);
}

/**
 * Remove the skill link and its install record.
 */
export async function removeInstalled(
  id: string,
  scopeHint?: InstallScope,
  toolIdHint?: string,
): Promise<UninstallResult> {
  const record = await resolveIdentifier(id, scopeHint, toolIdHint);
  const { installKey, toolId, scope, repoRoot } = record;

  const provisioner = createSkillProvisioner(toolId, scope, repoRoot);
  return provisioner.uninstall([installKey]);
}
