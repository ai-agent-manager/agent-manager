import type { InstallResult } from '../provisioners/types.js';

export function mergeInstallResults(results: InstallResult[]): InstallResult {
  const warnings = results.flatMap((result) => result.warnings ?? []);
  return {
    installed: results.flatMap((result) => result.installed),
    errors: results.flatMap((result) => result.errors),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
