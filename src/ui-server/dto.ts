import type { CatalogueEntry } from '../discovery/catalogue.js';
import type { InstalledSkillRecord } from '../operations/manage.js';
import type { InstallResult } from '../provisioners/types.js';
import type { StoredSource } from '../bundle/cache.js';
import type { CatalogueEntryDto, InstalledRecordDto, InstallResultDto, StoredSourceDto } from './api-types.js';

/** Display URLs must never carry credentials or query-string access tokens. */
export function safeUrl(value: string): string {
  if (!/^https?:/i.test(value)) return value;
  try { const url = new URL(value); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href; }
  catch { return '[invalid URL]'; }
}
export function safeText(value: string): string {
  // Core diagnostics sometimes include upstream response bodies. Those belong
  // to the backend, even when nested inside membership warnings.
  return value.replace(/API error (\d+) for [\s\S]*/g, 'API request failed (HTTP $1).')
    .replace(/(Token exchange failed \(HTTP \d+\)):[\s\S]*/g, '$1.')
    .replace(/https?:\/\/[^\s<>"']+/gi, safeUrl).replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]');
}
export function sourceDto(source: StoredSource): StoredSourceDto {
  return { kind: source.kind, value: safeUrl(source.value) };
}
export function catalogueDto(entries: CatalogueEntry[]): CatalogueEntryDto[] {
  return entries.filter((entry) => entry.kind === 'skill').map((entry) => ({
    kind: 'skill', skillId: entry.skillId, displayName: entry.displayName, description: entry.description,
    projectNames: entry.projectNames?.slice(),
    candidates: entry.candidates.map((candidate) => ({
      installKey: candidate.installKey, sourceName: candidate.sourceName, sourceType: candidate.sourceType,
      sourceStatus: candidate.sourceStatus,
      version: candidate.skill.sourcePin?.bundleVersion ?? candidate.skill.sourcePin?.artefactVersion ?? candidate.skill.sourcePin?.ref,
    })),
  }));
}
export function installedDto(record: InstalledSkillRecord): InstalledRecordDto {
  const pin = record.sourcePin;
  const value = pin?.repoUrl ?? pin?.bundleBaseUrl ?? pin?.bundleDirectory ?? pin?.artefactUrl;
  return {
    installKey: record.installKey, skillId: record.skillId, toolId: record.toolId, scope: record.scope,
    repoRoot: record.repoRoot, version: record.version, installedAt: record.installedAt,
    method: record.method, linkName: record.linkName,
    source: pin ? { type: pin.sourceType, value: value ? safeUrl(value) : undefined } : undefined,
  };
}
export function installResultDto(result: InstallResult): InstallResultDto {
  return {
    installed: result.installed.map(({ name, method, path }) => ({ name, method, path })),
    errors: result.errors.map(({ name, error }) => ({ name, error: safeText(error) })),
  };
}
