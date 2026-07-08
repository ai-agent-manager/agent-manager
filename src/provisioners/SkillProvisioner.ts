import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Provisioner, InstalledSkill, InstallResult, ProvisionerScope, UninstallResult } from './types.js';
import type { SkillInfo } from '../bundle/scanner.js';
import type { InstallScope } from '../config/scopes.js';
import { createLink, removeLink, resolveSkillVersion } from '../lib/symlink.js';
import { ensureDir, pathExists } from '../lib/fs.js';
import { recordInstall, removeInstallRecord, readConfig, getRecordVersion } from '../bundle/cache.js';
import { recordRepoInstall, removeRepoInstallRecord, readRepoConfig } from '../bundle/repo-config.js';
import type { SkillSourcePin } from '../bundle/skill-source.js';

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
    // Skill provisioners are always "available" — we create the directory if needed
    return { available: true };
  }

  async getInstalled(): Promise<InstalledSkill[]> {
    const skillsDir = this.getEffectiveSkillsDir();
    if (!(await pathExists(skillsDir))) return [];

    // Read install records from the appropriate config
    let toolInstalls: Record<string, { bundleVersion?: string; installedAt?: string; method?: string; sourcePin?: SkillSourcePin }> = {};
    if (this.scope === 'repo' && this.repoRoot) {
      const repoConfig = await readRepoConfig(this.repoRoot);
      toolInstalls = repoConfig?.installations[this.id] ?? {};
    } else {
      const config = await readConfig();
      toolInstalls = config.installations[this.id] ?? {};
    }

    const entries = await readdir(skillsDir, { withFileTypes: true });
    const installed: InstalledSkill[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

      const skillPath = path.join(skillsDir, entry.name);
      const version = await resolveSkillVersion(skillPath);
      const record = toolInstalls[entry.name];

      installed.push({
        name: entry.name,
        bundleVersion: (version ?? (record ? getRecordVersion(record) : undefined)) || 'unknown',
        installedAt: record?.installedAt ?? 'unknown',
        method: (record?.method as 'symlink' | 'copy') ?? (version ? 'symlink' : 'copy'),
        path: skillPath,
      });
    }

    return installed;
  }

  async install(items: SkillInfo[], bundleVersion: string, sourcePin?: SkillSourcePin): Promise<InstallResult> {
    const skillsDir = this.getEffectiveSkillsDir();
    await ensureDir(skillsDir);

    const result: InstallResult = { installed: [], errors: [] };

    for (const item of items) {
      const linkPath = path.join(skillsDir, item.dirName);
      try {
        const linkResult = await createLink(item.dirPath, linkPath);
        result.installed.push({
          name: item.dirName,
          method: linkResult.method,
          path: linkPath,
        });

        // Record in the appropriate config
        if (this.scope === 'repo' && this.repoRoot) {
          await recordRepoInstall(this.repoRoot, this.id, item.dirName, {
            installedAt: new Date().toISOString(),
            method: linkResult.method,
            sourcePin,
          }, bundleVersion || undefined);
        } else {
          await recordInstall(this.id, item.dirName, {
            bundleVersion: bundleVersion || undefined,
            installedAt: new Date().toISOString(),
            method: linkResult.method,
            sourcePin,
          });
        }
      } catch (error) {
        result.errors.push({
          name: item.dirName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  async uninstall(names: string[]): Promise<UninstallResult> {
    const skillsDir = this.getEffectiveSkillsDir();
    const result: UninstallResult = { removed: [], errors: [] };

    for (const name of names) {
      const linkPath = path.join(skillsDir, name);
      try {
        await removeLink(linkPath);

        if (this.scope === 'repo' && this.repoRoot) {
          await removeRepoInstallRecord(this.repoRoot, this.id, name);
        } else {
          await removeInstallRecord(this.id, name);
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
