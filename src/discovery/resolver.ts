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
import { buildSourcePin, type ArtefactSkillSource, type BundleSkillSource } from '../bundle/skill-source.js';
import type { DiscoveryDocument, DiscoverySource } from './types.js';

export interface ResolvedSources {
  /** All skills successfully resolved from the discovery document. */
  skills: SkillInfo[];
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
  const allSkills: SkillInfo[] = [];
  const allRovoAgents: RovoAgentInfo[] = [];
  const errors: Array<{ source: DiscoverySource; error: string; isIntegrity: boolean }> = [];
  let bundleVersion: string | undefined;

  for (const source of discovery.sources) {
    try {
      switch (source.type) {
        case 'http': {
          onProgress?.(`Downloading source bundle: ${source.name}...`);
          // For HTTP sources, the URL is the base URL for the bundle index
          const { zipPath, version } = await downloadBundle(source.url, undefined, accessToken);
          const result = await extractBundle(zipPath);
          if (result.isNew) {
            await setCurrentBundle(result.manifest.version);
          }
          bundleVersion = version;

          const contents = await scanBundle(result.bundleDir, result.manifest.agents);
          const httpPin = buildSourcePin({ type: 'bundle', baseUrl: source.url, installLayout: 'flat' } as BundleSkillSource, version);
          allSkills.push(...contents.skills.map((skill) => ({ ...skill, sourcePin: httpPin })));
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
          allSkills.push(...gitSkills.map((skill) => ({ ...skill, sourcePin: gitPin })));
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
          const download = await downloadArtefact(artefactSource);
          const resolvedSource: ArtefactSkillSource = {
            ...artefactSource,
            version: download.version,
            sha256: download.sha256 ?? artefactSha256,
          };
          const pin = buildSourcePin(resolvedSource);
          const scanResult = await scanArtefactForSkills(download.extractDir, resolvedSource);
          allSkills.push(...scanResult.skills.map((skill) => ({ ...skill, sourcePin: pin })));
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
