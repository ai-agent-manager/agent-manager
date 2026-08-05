import path from 'node:path';
import { getHomeDir } from '../lib/platform.js';

/** Root directory for agentman data */
export function getAgentmanDir(): string {
  return path.join(getHomeDir(), '.agentman');
}

/** Directory containing all cached bundles */
export function getBundlesDir(): string {
  return path.join(getAgentmanDir(), 'bundles');
}

/** Directory for a specific bundle version */
export function getBundleVersionDir(version: string): string {
  return path.join(getBundlesDir(), version);
}

/** Symlink pointing to the active bundle version */
export function getCurrentBundleLink(): string {
  return path.join(getAgentmanDir(), 'current');
}

/** Path to the user config file */
export function getConfigPath(): string {
  return path.join(getAgentmanDir(), 'config.json');
}

/** Lock file guarding concurrent writes to the user config file */
export function getConfigLockPath(): string {
  return path.join(getAgentmanDir(), 'config.json.lock');
}

/** Temp directory for downloads */
export function getTempDir(): string {
  return path.join(getAgentmanDir(), 'tmp');
}

/** Directory containing cached repository downloads */
export function getReposDir(): string {
  return path.join(getAgentmanDir(), 'repos');
}

/** Cache directory for a specific repository at a given ref */
export function getRepoCacheDir(owner: string, repo: string, ref: string): string {
  return path.join(getReposDir(), owner, repo, ref);
}

/** Directory containing cached skill artefact downloads */
export function getArtefactsDir(): string {
  return path.join(getAgentmanDir(), 'artefacts');
}

/** Cache directory for a specific artefact at a given version */
export function getArtefactCacheDir(name: string, version: string): string {
  return path.join(getArtefactsDir(), name, version);
}

/** Directory for saved auth state (restricted permissions) */
export function getAuthDir(): string {
  return path.join(getAgentmanDir(), 'auth');
}

/** Path to the Atlassian Studio auth state file */
export function getAtlassianAuthPath(): string {
  return path.join(getAuthDir(), 'atlassian-studio.json');
}

/** Maximum age (in ms) before auth state is considered expired */
export const AUTH_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
