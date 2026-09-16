import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { OperationConflictError } from '../lib/mutation.js';
import { readRepoConfig } from '../bundle/repo-config.js';
import { getBundleVersionDir } from '../config/paths.js';
import { canonicaliseContentRoot } from '../bundle/downloader.js';
import { assertBundleVersion, readBundleIdentity, resolvePinnedBundle } from '../bundle/version-identity.js';
import { parseManifest } from '../bundle/manifest.js';
import { scanBundle } from '../bundle/scanner.js';
import type { BundleContents } from '../bundle/scanner.js';
import type { InstallScope } from '../config/scopes.js';
import { buildScopedCatalogue } from '../catalogue-scope/index.js';
import { buildPinForDirectorySource, buildSourcePin } from '../bundle/skill-source.js';
import type { ResolvedSkill } from '../discovery/resolver.js';
import type { Session } from './session.js';

type CatalogueSession = Pick<Session, 'manifest' | 'discoveryBundleVersion' | 'discoverySkills' | 'source' | 'bundleContents'>;

export interface CatalogueOptions {
  scope?: InstallScope;
  repoBundle?: { version: string; contents: BundleContents };
}

export function effectiveBundleVersion(session: CatalogueSession): string {
  return session.manifest?.version ?? session.discoveryBundleVersion ?? 'unknown';
}

export function toCatalogueSkills(session: CatalogueSession, options: CatalogueOptions = {}): ResolvedSkill[] {
  if (session.discoverySkills) return session.discoverySkills;
  const repoBundle = options.scope === 'repo' ? options.repoBundle : undefined;
  const version = repoBundle?.version ?? effectiveBundleVersion(session);
  const contents = repoBundle?.contents ?? session.bundleContents;
  const source = session.source;
  const pin = source?.type === 'directory'
    ? buildPinForDirectorySource(source.dirPath, version)
    : source?.type === 'url'
      ? buildSourcePin({ type: 'bundle', baseUrl: source.baseUrl, installLayout: 'flat' }, version)
      : undefined;
  return (contents?.skills ?? []).map((skill) => ({
    ...skill, sourcePin: skill.sourcePin ?? pin, sourceName: 'bundle', sourceType: 'http',
  }));
}

/** Consumers cannot override the membership scope determined by session loading. */
export function buildSessionCatalogue(session: Session, options: CatalogueOptions = {}) {
  return buildScopedCatalogue(toCatalogueSkills(session, options), (options.scope === 'repo' ? options.repoBundle?.contents : undefined)?.rovoAgents ?? session.bundleContents?.rovoAgents ?? [], session.catalogueScope);
}

/** Resolve a legacy repository catalogue from per-install pins, never the
 * deprecated repository-wide version. Mixed versions require an explicit choice.
 */
export async function loadRepositoryBundle(session: CatalogueSession, repoRoot: string): Promise<CatalogueOptions['repoBundle']> {
  if (session.discoverySkills || !session.source || session.source.type === 'discovery') return undefined;
  const source = session.source;
  const config = await readRepoConfig(repoRoot);
  const pins = Object.values(config?.installations ?? {}).flatMap((records) => Object.values(records))
    .map((record) => record.sourcePin)
    .filter((pin) => pin?.sourceType === 'bundle' && !pin.bundleSourceName && (
      source.type === 'url'
        ? pin.bundleBaseUrl && canonicaliseContentRoot(pin.bundleBaseUrl) === canonicaliseContentRoot(source.baseUrl)
        : !pin.bundleBaseUrl
    ));
  const versions = [...new Set(pins.map((pin) => pin!.bundleVersion))];
  if (versions.length === 0) return undefined;
  if (versions.length !== 1 || !versions[0]) throw new OperationConflictError('Repository skills use mixed bundle versions. Select their versions individually before using a repository catalogue.');
  const version = versions[0];
  assertBundleVersion(version);
  const bundleDir = getBundleVersionDir(version);
  if (source.type === 'url') await resolvePinnedBundle(pins[0], version);
  else {
    const identity = await readBundleIdentity(bundleDir);
    const directory = await realpath(source.dirPath).catch(() => path.resolve(source.dirPath));
    if (identity.directory !== directory && !identity.directoryAliases?.includes(directory)) throw new OperationConflictError('Repository bundle belongs to an unknown or different directory source.');
  }
  const manifest = parseManifest(await readFile(path.join(bundleDir, 'manifest.json'), 'utf8'));
  if (manifest.version !== version) throw new OperationConflictError('Repository manifest does not match its pinned version.');
  return { version, contents: await scanBundle(bundleDir, manifest.agents) };
}

export async function buildRepositoryCatalogue(session: Session, repoRoot: string) {
  const repoBundle = await loadRepositoryBundle(session, repoRoot);
  return buildSessionCatalogue(session, { scope: 'repo', repoBundle });
}
