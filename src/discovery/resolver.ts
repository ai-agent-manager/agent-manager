/**
 * Resolve skills listed in a discovery document into SkillInfo entries.
 *
 * Handles both `http` (bundle download) and `git` (clone + scan) skill types,
 * optionally passing an access token for authenticated endpoints.
 */

import { downloadBundle } from '../bundle/downloader.js';
import { extractBundle } from '../bundle/extractor.js';
import { scanBundle, type SkillInfo } from '../bundle/scanner.js';
import { setCurrentBundle } from '../bundle/cache.js';
import { importGitSkills } from './git-importer.js';
import type { DiscoveryDocument, DiscoverySkill } from './types.js';

export interface ResolvedSkills {
  /** All skills successfully resolved from the discovery document. */
  skills: SkillInfo[];
  /** Skills that failed to resolve, with error details. */
  errors: Array<{ skill: DiscoverySkill; error: string }>;
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
): Promise<ResolvedSkills> {
  const allSkills: SkillInfo[] = [];
  const errors: Array<{ skill: DiscoverySkill; error: string }> = [];
  let bundleVersion: string | undefined;

  for (const skill of discovery.skills) {
    try {
      switch (skill.type) {
        case 'http': {
          onProgress?.(`Downloading skill bundle: ${skill.name}...`);
          // For HTTP skills, the URL is the base URL for the bundle index
          const { zipPath, version } = await downloadBundle(skill.url);
          const result = await extractBundle(zipPath);
          if (result.isNew) {
            await setCurrentBundle(result.manifest.version);
          }
          bundleVersion = version;

          const contents = await scanBundle(result.bundleDir, result.manifest.agents);
          allSkills.push(...contents.skills);
          break;
        }

        case 'git': {
          onProgress?.(`Cloning skill repository: ${skill.name}...`);
          const { skills: gitSkills } = await importGitSkills(skill.url, skill.name);
          allSkills.push(...gitSkills);
          break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ skill, error: message });
    }
  }

  return { skills: allSkills, errors, bundleVersion };
}
