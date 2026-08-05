import type { InstallResult } from '../provisioners/types.js';

export function mergeInstallResults(results: InstallResult[]): InstallResult {
  return {
    installed: results.flatMap((result) => result.installed),
    errors: results.flatMap((result) => result.errors),
  };
}
