/**
 * Resolve skills listed in a discovery document into SkillInfo entries.
 *
 * Handles `http` (bundle download), `git` (clone + scan), and `artefact`
 * (zip download + scan) skill types, optionally passing an access token
 * for authenticated endpoints.
 */

import { downloadBundle } from '../bundle/downloader.js';
import { extractBundle } from '../bundle/extractor.js';
import type { BundleManifest } from '../bundle/manifest.js';
import { scanBundle, type SkillInfo, type RovoAgentInfo } from '../bundle/scanner.js';
import { importGitSkills } from './git-importer.js';
import { downloadArtefact } from '../bundle/artefact-downloader.js';
import { IntegrityError } from '../bundle/downloader.js';
import { scanArtefactForSkills } from '../bundle/artefact-scanner.js';
import {
  buildSourcePin,
  bundleSourceKey,
  type ArtefactSkillSource,
  type BundleSkillSource,
} from '../bundle/skill-source.js';
import { getValidBearerToken, type AuthSession } from '../auth/index.js';
import type { DiscoveryDocument, DiscoverySource, SourceType, SourceStatus } from './types.js';

/** A skill resolved from a discovery source, tagged with catalogue metadata. */
export interface ResolvedSkill extends SkillInfo {
  sourceName: string;
  sourceType: SourceType;
  sourceStatus?: SourceStatus;
}

export interface ResolvedSources {
  /** All skills successfully resolved from the discovery document. */
  skills: ResolvedSkill[];
  /** All rovo agents successfully resolved from the discovery document. */
  rovoAgents: RovoAgentInfo[];
  /** Sources that failed to resolve, with error details. */
  errors: Array<{ source: DiscoverySource; error: string; isIntegrity: boolean }>;
  /** Bundle version if an HTTP bundle was downloaded (for cache management). */
  bundleVersion?: string;
  /**
   * Manifest from an HTTP bundle source, when one was resolved.
   * Prefer a source that contributed Rovo agents; otherwise the last HTTP source.
   * Needed by the Chrome Extension bridge (and similar) when using discovery.
   */
  manifest?: BundleManifest;
  /**
   * Cached bundle directory for {@link manifest}, when an HTTP source was resolved.
   */
  bundleDir?: string;
}

/**
 * Resolve all skills from a discovery document.
 *
 * @param discovery    The parsed discovery document.
 * @param accessToken  Optional Bearer token for authenticated HTTP requests.
 * @param onProgress   Optional callback for progress updates.
 */
export interface ResolveDiscoveryOptions {
  /** SHA-256 pin for artefact sources — overrides sidecar lookup when set. */
  artefactSha256?: string;
  /**
   * When set, a fresh bearer is loaded/refreshed from the token store before
   * each authenticated HTTP download (preferred over a static accessToken).
   */
  authSession?: AuthSession;
}

async function resolveDownloadBearer(
  accessToken: string | undefined,
  authSession: AuthSession | undefined,
): Promise<string | undefined> {
  if (authSession) {
    return getValidBearerToken(authSession.discoveryBaseUrl, authSession.auth);
  }
  return accessToken;
}

/**
 * Resolve all skills from a discovery document.
 *
 * @param discovery    The parsed discovery document.
 * @param accessToken  Optional static bearer (e.g. AGENTMAN_ACCESS_TOKEN). Ignored when `options.authSession` is set.
 * @param onProgress   Optional callback for progress updates.
 * @param options      Optional configuration (artefact integrity pin, auth session, etc.).
 */
export async function resolveDiscoverySkills(
  discovery: DiscoveryDocument,
  accessToken?: string,
  onProgress?: (message: string) => void,
  options?: ResolveDiscoveryOptions,
): Promise<ResolvedSources> {
  const artefactSha256 = options?.artefactSha256;
  const authSession = options?.authSession;
  const allSkills: ResolvedSkill[] = [];
  const allRovoAgents: RovoAgentInfo[] = [];
  const errors: Array<{ source: DiscoverySource; error: string; isIntegrity: boolean }> = [];
  let bundleVersion: string | undefined;
  let manifest: BundleManifest | undefined;
  let bundleDir: string | undefined;
  /** True once we've captured a bundle that contributed Rovo agents. */
  let hasRovoBundle = false;

  for (const source of discovery.sources) {
    const sourceMeta = {
      sourceName: source.name,
      sourceType: source.type,
      ...(source.status ? { sourceStatus: source.status } : {}),
    };
    try {
      switch (source.type) {
        case 'http': {
          onProgress?.(`Downloading source bundle: ${source.name}...`);
          // source.url is the content root: the client appends index.json and
          // <version>/… to it and inserts no path of its own.
          const sourceKey = bundleSourceKey(source.name);
          const bearer = await resolveDownloadBearer(accessToken, authSession);
          const { zipPath, version } = await downloadBundle(source.url, undefined, bearer, sourceKey);
          const result = await extractBundle(zipPath, { sourceKey, contentRoot: source.url });
          // Deliberately no setCurrentBundle here: the `current` symlink points
          // into the version-keyed cache, which a source-scoped extract never
          // populates, so setting it would leave a dangling link and a phantom
          // "current" version. Teaching the current-bundle machinery about
          // source-scoped paths belongs with the cache work in #50.
          bundleVersion = version;

          const contents = await scanBundle(result.bundleDir, result.manifest.agents);
          const httpSource: BundleSkillSource = {
            type: 'bundle',
            baseUrl: source.url,
            sourceName: source.name,
            installLayout: 'namespaced',
          };
          const httpPin = buildSourcePin(httpSource, version);
          allSkills.push(...contents.skills.map((skill) => ({ ...skill, sourcePin: httpPin, ...sourceMeta })));
          allRovoAgents.push(...contents.rovoAgents);

          // Keep metadata for the Chrome Extension bridge and similar consumers.
          // Prefer a source that actually contributed Rovo agents.
          if (!hasRovoBundle) {
            manifest = result.manifest;
            bundleDir = result.bundleDir;
            if (contents.rovoAgents.length > 0) {
              hasRovoBundle = true;
            }
          }
          break;
        }

        case 'git': {
          onProgress?.(`Cloning source repository: ${source.name}...`);
          const { skills: gitSkills } = await importGitSkills(source.url, source.name);
          // No ref pinned: the importer shallow-clones and doesn't surface the
          // resolved commit, so ref stays undefined here.
          const gitPin = buildSourcePin({
            type: 'repo',
            repoUrl: source.url,
            installLayout: 'namespaced',
          });
          allSkills.push(...gitSkills.map((skill) => ({ ...skill, sourcePin: gitPin, ...sourceMeta })));
          break;
        }

        case 'artefact': {
          onProgress?.(`Downloading artefact: ${source.name}...`);
          const artefactSource: ArtefactSkillSource = {
            type: 'artefact',
            artefactUrl: source.url,
            installLayout: 'namespaced',
            sha256: artefactSha256,
          };
          const bearer = await resolveDownloadBearer(accessToken, authSession);
          const download = await downloadArtefact(artefactSource, {
            bearerToken: bearer,
          });
          const resolvedSource: ArtefactSkillSource = {
            ...artefactSource,
            version: download.version,
            sha256: download.sha256 ?? artefactSha256,
          };
          const pin = buildSourcePin(resolvedSource);
          const scanResult = await scanArtefactForSkills(download.extractDir, resolvedSource);
          allSkills.push(...scanResult.skills.map((skill) => ({ ...skill, sourcePin: pin, ...sourceMeta })));
          break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isIntegrity = err instanceof IntegrityError;
      errors.push({ source, error: message, isIntegrity });
    }
  }

  return {
    skills: allSkills,
    rovoAgents: allRovoAgents,
    errors,
    bundleVersion,
    ...(manifest ? { manifest } : {}),
    ...(bundleDir ? { bundleDir } : {}),
  };
}
