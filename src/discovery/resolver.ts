/**
 * Resolve skills listed in a discovery document into SkillInfo entries.
 *
 * Handles both `http` (bundle download) and `git` (clone + scan) skill types,
 * optionally passing an access token for authenticated endpoints.
 */

import { downloadBundle } from '../bundle/downloader.js';
import { extractBundle } from '../bundle/extractor.js';
import { scanBundle, type SkillInfo, type RovoAgentInfo } from '../bundle/scanner.js';
import { setCurrentBundle } from '../bundle/cache.js';
import { importGitSkills } from './git-importer.js';
import type { DiscoveryDocument, DiscoverySource } from './types.js';

export interface ResolvedSources {
  /** All skills successfully resolved from the discovery document. */
  skills: SkillInfo[];
  /** All rovo agents successfully resolved from the discovery document. */
  rovoAgents: RovoAgentInfo[];
  /** Sources that failed to resolve, with error details. */
  errors: Array<{ source: DiscoverySource; error: string }>;
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
export async function resolveDiscoverySkills(
  discovery: DiscoveryDocument,
  accessToken?: string,
  onProgress?: (message: string) => void,
): Promise<ResolvedSources> {
  const allSkills: SkillInfo[] = [];
  const allRovoAgents: RovoAgentInfo[] = [];
  const errors: Array<{ source: DiscoverySource; error: string }> = [];
  let bundleVersion: string | undefined;

  for (const source of discovery.sources) {
    try {
      switch (source.type) {
        case 'http': {
          onProgress?.(`Downloading source bundle: ${source.name}...`);
          // For HTTP sources, the URL is the base URL for the bundle index
          const { zipPath, version } = await downloadBundle(source.url);
          const result = await extractBundle(zipPath);
          if (result.isNew) {
            await setCurrentBundle(result.manifest.version);
          }
          bundleVersion = version;

          const contents = await scanBundle(result.bundleDir, result.manifest.agents);
          allSkills.push(...contents.skills);
          allRovoAgents.push(...contents.rovoAgents);
          break;
        }

        case 'git': {
          onProgress?.(`Cloning source repository: ${source.name}...`);
          const { skills: gitSkills } = await importGitSkills(source.url, source.name);
          allSkills.push(...gitSkills);
          break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ source, error: message });
    }
  }

  return { skills: allSkills, rovoAgents: allRovoAgents, errors, bundleVersion };
}
