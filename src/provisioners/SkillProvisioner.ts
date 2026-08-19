import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Provisioner, InstalledSkill, InstallResult, ProvisionerScope, UninstallResult } from './types.js';
import type { SkillInfo } from '../bundle/scanner.js';
import type { InstallScope } from '../config/scopes.js';
import { createLink, removeLink, resolveSkillVersion } from '../lib/symlink.js';
import { ensureDir, pathExists } from '../lib/fs.js';
import { recordInstall, removeInstallRecord, readConfig, getRecordVersion } from '../bundle/cache.js';
import { recordRepoInstall, removeRepoInstallRecord, readRepoConfig } from '../bundle/repo-config.js';
import { deriveInstallNamespace, buildInstallKey, buildLinkName } from '../bundle/skill-source.js';
import type { SkillSourcePin } from '../bundle/skill-source.js';

type InstallRecordMap = Record<
  string,
  { bundleVersion?: string; installedAt?: string; method?: string; sourcePin?: SkillSourcePin; linkName?: string }
>;

type ResolveResult =
  | { type: 'found'; key: string }
  | { type: 'ambiguous'; keys: string[] }
  | { type: 'not-found' };

/**
 * Resolve a caller-supplied name to a config key.
 * If `name` is an exact key, return it directly.
 * If it matches as a bare skillId (last segment) across one or more keys,
 * return the single match or signal ambiguity when more than one key matches.
 */
function resolveInstallKey(name: string, records: InstallRecordMap): ResolveResult {
  // Run the exact key through the same bare-id matching as everything else, rather than
  // returning early on it: an exact-key hit (typically a legacy bare-key record) can still
  // be ambiguous when a namespaced record for a *different* source shares the same bare id.
  const matches = Object.keys(records).filter((k) => {
    if (k === name) return true;
    const segments = k.split('/');
    return segments[segments.length - 1] === name;
  });

  if (matches.length === 1) return { type: 'found', key: matches[0] };
  if (matches.length > 1) return { type: 'ambiguous', keys: matches };
  return { type: 'not-found' };
}

export abstract class SkillProvisioner implements Provisioner {
  abstract readonly id: string;
  abstract readonly name: string;
  readonly type = 'skill' as const;

  protected readonly scope: InstallScope;
  protected readonly repoRoot: string | undefined;

  constructor(options?: ProvisionerScope) {
    this.scope = options?.scope ?? 'system';
    this.repoRoot = options?.repoRoot;

    if (this.scope === 'repo' && !this.repoRoot) {
      throw new Error('repoRoot is required when scope is "repo"');
    }
  }

  /** Subclasses return the tool's system-wide skills directory */
  abstract getSkillsDir(): string;

  /** Subclasses return the tool's repo-level skills directory */
  abstract getRepoSkillsDir(repoRoot: string): string;

  /** Optional note displayed in the TUI */
  getNote(): string | undefined {
    return undefined;
  }

  /** Resolve the effective skills directory based on scope */
  getEffectiveSkillsDir(): string {
    if (this.scope === 'repo' && this.repoRoot) {
      return this.getRepoSkillsDir(this.repoRoot);
    }
    return this.getSkillsDir();
  }

  async detect(): Promise<{ available: boolean; reason?: string }> {
    return { available: true };
  }

  async getInstalled(): Promise<InstalledSkill[]> {
    const skillsDir = this.getEffectiveSkillsDir();
    if (!(await pathExists(skillsDir))) return [];

    let toolInstalls: InstallRecordMap = {};
    if (this.scope === 'repo' && this.repoRoot) {
      const repoConfig = await readRepoConfig(this.repoRoot);
      toolInstalls = repoConfig?.installations[this.id] ?? {};
    } else {
      const config = await readConfig();
      toolInstalls = config.installations[this.id] ?? {};
    }

    const installed: InstalledSkill[] = [];
    const coveredLinkNames = new Set<string>();

    for (const [key, record] of Object.entries(toolInstalls)) {
      const segments = key.split('/');
      const bareId = segments[segments.length - 1];
      // Prefer stored linkName; fall back to bare skill ID for legacy records.
      const linkName = record.linkName ?? bareId;
      coveredLinkNames.add(linkName);

      const skillPath = path.join(skillsDir, linkName);
      if (!(await pathExists(skillPath))) continue;

      const version = await resolveSkillVersion(skillPath);
      const pinnedVersion = record?.sourcePin?.artefactVersion ?? record?.sourcePin?.ref;
      const recordVer = record ? getRecordVersion(record) : undefined;

      installed.push({
        name: key,
        bundleVersion: (version ?? (recordVer || undefined) ?? pinnedVersion) || 'unknown',
        installedAt: record?.installedAt ?? 'unknown',
        method: (record?.method as 'symlink' | 'copy') ?? (version ? 'symlink' : 'copy'),
        path: skillPath,
      });
    }

    // Catch orphaned flat installs that have no config record.
    const entries = await readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (coveredLinkNames.has(entry.name)) continue;

      const skillPath = path.join(skillsDir, entry.name);
      const version = await resolveSkillVersion(skillPath);

      installed.push({
        name: entry.name,
        bundleVersion: version ?? 'unknown',
        installedAt: 'unknown',
        method: version ? 'symlink' : 'copy',
        path: skillPath,
      });
    }

    return installed;
  }

  async install(items: SkillInfo[], bundleVersion: string, sourcePin?: SkillSourcePin): Promise<InstallResult> {
    const skillsDir = this.getEffectiveSkillsDir();
    await ensureDir(skillsDir);

    const result: InstallResult = { installed: [], errors: [] };

    let toolInstalls: InstallRecordMap = {};
    if (this.scope === 'repo' && this.repoRoot) {
      const repoConfig = await readRepoConfig(this.repoRoot);
      toolInstalls = repoConfig?.installations[this.id] ?? {};
    } else {
      const config = await readConfig();
      toolInstalls = config.installations[this.id] ?? {};
    }

    // Reverse index for the Fix-1 collision guard below: every linkName currently
    // on record, mapped back to the install key that owns it.
    const linkNameToKey = new Map<string, string>();
    for (const [key, record] of Object.entries(toolInstalls)) {
      const segments = key.split('/');
      const bareId = segments[segments.length - 1];
      linkNameToKey.set(record.linkName ?? bareId, key);
    }

    // A pre-content-root bundle install is flat, so its pin yields no namespace
    // and cannot be matched to the new one by identity. It is only safe to treat
    // such a record as the predecessor of a named-source install when exactly one
    // source in this run offers that skill id — otherwise the first source to
    // install would consume a record that may belong to another.
    const namedBundleClaims = new Map<string, number>();
    for (const item of items) {
      const pin = item.sourcePin ?? sourcePin;
      if (pin?.sourceType === 'bundle' && pin.bundleSourceName) {
        namedBundleClaims.set(item.dirName, (namedBundleClaims.get(item.dirName) ?? 0) + 1);
      }
    }

    for (const item of items) {
      const effectivePin = item.sourcePin ?? sourcePin;
      let installKey = item.dirName;
      try {
        const namespace = effectivePin ? deriveInstallNamespace(effectivePin) : null;
        installKey = buildInstallKey(namespace, item.dirName);

        let linkName: string;
        if (namespace) {
          // "~" is the sole namespace/dirName boundary character (flattenNamespace never
          // emits it either), so a dirName containing "~" would break the one-to-one
          // mapping between linkName and install key.
          if (item.dirName.includes('~')) {
            throw new Error(
              `Skill directory name "${item.dirName}" contains "~", which is reserved as the ` +
              `namespace separator and cannot be used under the namespaced install layout.`,
            );
          }
          linkName = buildLinkName(namespace, item.dirName);

          const linkOwner = linkNameToKey.get(linkName);
          if (linkOwner && linkOwner !== installKey) {
            throw new Error(
              `Link name "${linkName}" is already used by install "${linkOwner}". Refusing to ` +
              `silently replace it with "${installKey}".`,
            );
          }

          // TODO: this will false-positive on a legitimate version-bump reinstall of the
          // same non-release-style artefact (e.g. app-1.0.0.zip -> app-2.0.0.zip, same
          // install key by design) once the artefact install/update flow is wired up.
          // Harmless today because that flow isn't connected yet (see CLAUDE.md) — revisit
          // when it is.
          if (effectivePin?.sourceType === 'artefact' && namespace.split('/').length === 2) {
            const existing = toolInstalls[installKey];
            if (
              existing?.sourcePin?.artefactUrl &&
              existing.sourcePin.artefactUrl !== effectivePin.artefactUrl
            ) {
              throw new Error(
                `Install key "${installKey}" already points at a different artefact URL ` +
                `(${existing.sourcePin.artefactUrl}) than the one being installed ` +
                `(${effectivePin.artefactUrl}).`,
              );
            }
          }
        } else {
          linkName = item.dirName;
        }

        const linkPath = path.join(skillsDir, linkName);
        const linkResult = await createLink(item.dirPath, linkPath);

        result.installed.push({
          name: installKey,
          method: linkResult.method,
          path: linkPath,
        });

        if (this.scope === 'repo' && this.repoRoot) {
          await recordRepoInstall(this.repoRoot, this.id, installKey, {
            installedAt: new Date().toISOString(),
            method: linkResult.method,
            sourcePin: effectivePin,
            linkName,
          }, bundleVersion || undefined);
        } else {
          await recordInstall(this.id, installKey, {
            bundleVersion: bundleVersion || undefined,
            installedAt: new Date().toISOString(),
            method: linkResult.method,
            sourcePin: effectivePin,
            linkName,
          });
        }

        linkNameToKey.set(linkName, installKey);

        // Migrate a pre-existing legacy bare-key install of the same source now that the
        // namespaced install above has succeeded — only after, so a failure earlier in this
        // iteration (e.g. the collision guards, or a disk error) never leaves the skill with
        // neither the old install nor the new one working. The legacy linkName (bare dirName)
        // is always distinct from the namespaced linkName, so this can't trip the collision
        // guard above on this same run.
        if (namespace) {
          const legacy = toolInstalls[item.dirName];
          const legacyIsFlatBundleOfThisSkill =
            legacy?.sourcePin?.sourceType === 'bundle' &&
            !legacy.sourcePin.bundleSourceName &&
            effectivePin?.sourceType === 'bundle' &&
            Boolean(effectivePin.bundleSourceName) &&
            namedBundleClaims.get(item.dirName) === 1;
          if (
            legacy?.sourcePin &&
            (deriveInstallNamespace(legacy.sourcePin) === namespace || legacyIsFlatBundleOfThisSkill)
          ) {
            const legacyLinkName = legacy.linkName ?? item.dirName;
            await removeLink(path.join(skillsDir, legacyLinkName));

            if (this.scope === 'repo' && this.repoRoot) {
              await removeRepoInstallRecord(this.repoRoot, this.id, item.dirName);
            } else {
              await removeInstallRecord(this.id, item.dirName);
            }

            delete toolInstalls[item.dirName];
            linkNameToKey.delete(legacyLinkName);
          }
        }
      } catch (error) {
        result.errors.push({
          name: installKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  async uninstall(names: string[]): Promise<UninstallResult> {
    const skillsDir = this.getEffectiveSkillsDir();
    const result: UninstallResult = { removed: [], errors: [] };

    let toolInstalls: InstallRecordMap = {};
    if (this.scope === 'repo' && this.repoRoot) {
      const repoConfig = await readRepoConfig(this.repoRoot);
      toolInstalls = repoConfig?.installations[this.id] ?? {};
    } else {
      const config = await readConfig();
      toolInstalls = config.installations[this.id] ?? {};
    }

    for (const name of names) {
      const resolved = resolveInstallKey(name, toolInstalls);

      if (resolved.type === 'ambiguous') {
        result.errors.push({
          name,
          error: `Multiple installs match '${name}'. Specify one of: ${resolved.keys.join(', ')}`,
        });
        continue;
      }

      if (resolved.type === 'not-found') {
        // Fall back to treating the name as a bare linkName for orphaned flat installs.
        const linkPath = path.join(skillsDir, name);
        try {
          await removeLink(linkPath);
          result.removed.push({ name });
        } catch (error) {
          result.errors.push({
            name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        continue;
      }

      const key = resolved.key;
      const record = toolInstalls[key];
      const segments = key.split('/');
      const bareId = segments[segments.length - 1];
      const linkName = record?.linkName ?? bareId;
      const linkPath = path.join(skillsDir, linkName);

      try {
        await removeLink(linkPath);

        if (this.scope === 'repo' && this.repoRoot) {
          await removeRepoInstallRecord(this.repoRoot, this.id, key);
        } else {
          await removeInstallRecord(this.id, key);
        }

        result.removed.push({ name });
      } catch (error) {
        result.errors.push({
          name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }
}
