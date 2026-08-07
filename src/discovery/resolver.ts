/**
 * Resolve skills listed in a discovery document into SkillInfo entries.
 *
 * Handles `http` (bundle download), `git` (clone + scan), and `artefact`
 * (zip download + scan) skill types, optionally passing an access token
 * for authenticated endpoints.
 */

import { downloadBundle } from '../bundle/downloader.js';
import { extractBundle } from '../bundle/extractor.js';
import { scanBundle, type SkillInfo, type RovoAgentInfo } from '../bundle/scanner.js';
import { setCurrentBundle } from '../bundle/cache.js';
import { importGitSkills } from './git-importer.js';
import { downloadArtefact } from '../bundle/artefact-downloader.js';
import { IntegrityError } from '../bundle/downloader.js';
import { scanArtefactForSkills } from '../bundle/artefact-scanner.js';
import { buildSourcePin, type ArtefactSkillSource, type BundleSkillSource, type InstallLayout } from '../bundle/skill-source.js';
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
}

/**
 * Resolve all skills from a discovery document.
 *
 * @param discovery    The parsed discovery document.
 * @param accessToken  Optional token for authenticated HTTP requests.
 * @param onProgress   Optional callback for progress updates.
 * @param options      Optional configuration (artefact integrity pin, etc.).
 */
export async function resolveDiscoverySkills(
  discovery: DiscoveryDocument,
  accessToken?: string,
  onProgress?: (message: string) => void,
  options?: ResolveDiscoveryOptions,
): Promise<ResolvedSources> {
  const artefactSha256 = options?.artefactSha256;
  const allSkills: ResolvedSkill[] = [];
  const allRovoAgents: RovoAgentInfo[] = [];
  const errors: Array<{ source: DiscoverySource; error: string; isIntegrity: boolean }> = [];
  let bundleVersion: string | undefined;

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
          // For HTTP sources, the URL is the base URL for the bundle index.
          // basePath (when set) addresses one bundle stream among several
          // hosted under the same origin — see DiscoverySource.basePath.
          const { zipPath, version } = await downloadBundle(source.url, undefined, accessToken, source.basePath);
          const result = await extractBundle(zipPath);
          if (result.isNew) {
            await setCurrentBundle(result.manifest.version);
          }
          // KNOWN LIMITATION: extractBundle()/setCurrentBundle() cache and track
          // the "current" bundle by version alone, with no source identity. Two
          // http sources (e.g. this one and an official source on the same
          // discovery document) that happen to publish the same version string
          // can collide in the cache / current-bundle symlink. Tracked upstream
          // in https://github.com/ai-agent-manager/agent-manager/issues/50,
          // which is itself blocked on the basePath source-identity work here.
          bundleVersion = version;

          const contents = await scanBundle(result.bundleDir, result.manifest.agents);
          // basePath-qualified sources are namespaced so a community skill can
          // never collide on disk with an official one sharing the same skillId;
          // the single-stream legacy layout (no basePath) stays flat, unchanged.
          const installLayout: InstallLayout = source.basePath ? 'namespaced' : 'flat';
          const httpPin = buildSourcePin(
            { type: 'bundle', baseUrl: source.url, basePath: source.basePath, installLayout } as BundleSkillSource,
            version,
          );
          allSkills.push(...contents.skills.map((skill) => ({ ...skill, sourcePin: httpPin, ...sourceMeta })));
          allRovoAgents.push(...contents.rovoAgents);
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
          const download = await downloadArtefact(artefactSource, { bearerToken: accessToken });
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

  return { skills: allSkills, rovoAgents: allRovoAgents, errors, bundleVersion };
}
