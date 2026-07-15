import { readdir, readFile, readlink, rm, symlink, unlink, mkdir, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import {
    getAgentmanDir,
    getBundlesDir,
    getBundleVersionDir,
    getCurrentBundleLink,
    getConfigPath,
} from "../config/paths.js";
import { parseManifest } from "./manifest.js";
import { readRepoConfig, writeRepoConfig } from "./repo-config.js";
import { scanBundle } from "./scanner.js";
import { getPlatform } from "../lib/platform.js";
import type { SkillSourcePin } from "./skill-source.js";

export interface CachedBundle {
    version: string;
    published: string;
    bundleDir: string;
    isCurrent: boolean;
}

export interface AgentmanConfig {
    baseUrl?: string;
    startupUpdateChecksDisabled?: boolean;
    installations: Record<string, Record<string, InstallRecord>>;
}

/**
 * Record of a single skill installation persisted in ~/.agentman/config.json.
 *
 * bundleVersion is optional so that repo/artefact installs (which have no
 * concept of a bundle version) can omit it without inventing a dummy value.
 * Legacy bundle installs always set this field, so existing config files
 * continue to parse cleanly. When reading, prefer sourcePin if present;
 * fall back to bundleVersion for bundle-sourced skills.
 */
export interface InstallRecord {
    /**
     * @deprecated Use sourcePin.bundleVersion instead. Kept for backward
     * compatibility with bundle installs written by earlier versions of agentman.
     * Absent for repo/artefact installs.
     */
    bundleVersion?: string;
    installedAt: string;
    method: "symlink" | "copy";
    /** Source pin persisted at install time for multi-source tracking. */
    sourcePin?: SkillSourcePin;
    /** Flat link name under the tool's skills dir (one level only). Absent for legacy flat installs — use bare skillId. */
    linkName?: string;
}

// Non-bundle source types (repo/artefact) carry no bundleVersion in their pin;
// they will need their own display value once those install flows are live.
export function getRecordVersion(record: { sourcePin?: SkillSourcePin; bundleVersion?: string }): string {
    return record.sourcePin?.bundleVersion ?? record.bundleVersion ?? '';
}

/**
 * List all cached bundle versions.
 */
export async function listCachedBundles(): Promise<CachedBundle[]> {
    const bundlesDir = getBundlesDir();
    await mkdir(bundlesDir, { recursive: true });

    let currentVersion: string | null = null;
    try {
        const linkTarget = await readlink(getCurrentBundleLink());
        currentVersion = path.basename(linkTarget);
    } catch {
        // No current symlink
    }

    const entries = await readdir(bundlesDir, { withFileTypes: true });
    const bundles: CachedBundle[] = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const manifestPath = path.join(bundlesDir, entry.name, "manifest.json");
        try {
            const raw = await readFile(manifestPath, "utf-8");
            const manifest = parseManifest(raw);
            bundles.push({
                version: manifest.version,
                published: manifest.published,
                bundleDir: path.join(bundlesDir, entry.name),
                isCurrent: entry.name === currentVersion,
            });
        } catch {
            // Skip directories without valid manifests
        }
    }

    // Sort by published date, newest first
    bundles.sort((a, b) => b.published.localeCompare(a.published));
    return bundles;
}

/**
 * Replace a symlink (or directory) at `linkPath` with a new one pointing to `targetPath`.
 * Uses junctions on Windows to avoid requiring admin/Developer Mode.
 */
async function replaceSymlink(linkPath: string, targetPath: string): Promise<void> {
    try {
        const s = await lstat(linkPath);
        if (s.isDirectory()) {
            await rm(linkPath, { recursive: true, force: true });
        } else {
            await unlink(linkPath);
        }
    } catch {
        // Path doesn't exist — nothing to remove
    }

    const symlinkType = getPlatform() === "windows" ? "junction" : "dir";
    await symlink(targetPath, linkPath, symlinkType);
}

async function resolveInstalledSkillPath(
    toolId: string,
    scope: 'system' | 'repo',
    repoRoot: string | undefined,
    skillName: string,
): Promise<{ ok: true; skillPath: string } | { ok: false; error: string }> {
    const { createSkillProvisioner } = await import('../provisioners/registry.js');

    try {
        const provisioner = createSkillProvisioner(toolId, scope, repoRoot);
        return { ok: true, skillPath: path.join(provisioner.getEffectiveSkillsDir(), skillName) };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith('Unknown tool:')) {
            return { ok: false, error: message };
        }
        return { ok: false, error: `Unknown tool: ${toolId}` };
    }
}

/**
 * Set the 'current' symlink to point to a specific bundle version.
 * This only changes which bundle is used for NEW installations.
 * Existing installed skills are NOT modified.
 */
export async function setCurrentBundle(version: string): Promise<void> {
    const targetDir = getBundleVersionDir(version);
    const linkPath = getCurrentBundleLink();

    try {
        await unlink(linkPath);
    } catch {
        // Link doesn't exist yet
    }

    const symlinkType = getPlatform() === "windows" ? "junction" : "dir";
    await symlink(targetDir, linkPath, symlinkType);
}

/**
 * Update a specific skill symlink to point to a different bundle version.
 * Used for manually switching individual skills between versions.
 *
 * @param toolId - The tool ID (e.g., 'claude-code')
 * @param skillName - The skill directory name
 * @param newVersion - The bundle version to install from
 * @returns Success status and error message if any
 */
export async function updateSkillVersion(
    toolId: string,
    skillName: string,
    newVersion: string,
    options?: { scope?: 'system' | 'repo'; repoRoot?: string },
): Promise<{ success: boolean; error?: string }> {
    const scope = options?.scope ?? 'system';
    const repoRoot = options?.repoRoot;
    const newBundleDir = getBundleVersionDir(newVersion);

    // Verify the skill exists in the target version
    try {
        const bundleContents = await scanBundle(newBundleDir);
        const skillExists = bundleContents.skills.some((s) => s.dirName === skillName);

        if (!skillExists) {
            return { success: false, error: `Skill '${skillName}' does not exist in version ${newVersion}` };
        }
    } catch {
        return { success: false, error: `Cannot access bundle version ${newVersion}` };
    }

    if (scope === 'repo') {
        if (!repoRoot) {
            return { success: false, error: 'repoRoot is required for repo-scoped skill updates' };
        }

        const repoConfig = await readRepoConfig(repoRoot);
        if (!repoConfig?.installations[toolId]?.[skillName]) {
            return { success: false, error: `Skill '${skillName}' is not installed at repo scope for ${toolId}` };
        }

        const skillPathResult = await resolveInstalledSkillPath(toolId, 'repo', repoRoot, skillName);
        if (!skillPathResult.ok) {
            return { success: false, error: skillPathResult.error };
        }
        const skillPath = skillPathResult.skillPath;
        const newTargetPath = path.join(newBundleDir, skillName);

        try {
            await replaceSymlink(skillPath, newTargetPath);

            // Update only the specific skill's bundleVersion — not the top-level one
            repoConfig.installations[toolId][skillName] = {
                ...repoConfig.installations[toolId][skillName],
                bundleVersion: newVersion,
                method: "symlink",
            };
            await writeRepoConfig(repoRoot, repoConfig);

            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    // System scope
    const config = await readConfig();

    if (!config.installations[toolId]?.[skillName]) {
        return { success: false, error: `Skill '${skillName}' is not installed for ${toolId}` };
    }

    const skillPathResult = await resolveInstalledSkillPath(toolId, 'system', undefined, skillName);
    if (!skillPathResult.ok) {
        return { success: false, error: skillPathResult.error };
    }
    const skillPath = skillPathResult.skillPath;
    const newTargetPath = path.join(newBundleDir, skillName);

    try {
        await replaceSymlink(skillPath, newTargetPath);

        if (!config.installations[toolId]) {
            config.installations[toolId] = {};
        }

        config.installations[toolId][skillName] = {
            ...config.installations[toolId][skillName],
            bundleVersion: newVersion,
            method: "symlink",
        };

        await writeConfig(config);

        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * Get the current (active) bundle version, or null if none.
 */
export async function getCurrentBundleVersion(): Promise<string | null> {
    try {
        const linkTarget = await readlink(getCurrentBundleLink());
        return path.basename(linkTarget);
    } catch {
        return null;
    }
}

/**
 * Remove a cached bundle version (cannot remove the current one).
 */
export async function removeCachedBundle(version: string): Promise<void> {
    const current = await getCurrentBundleVersion();
    if (current === version) {
        throw new Error("Cannot remove the currently active bundle. Switch to another version first.");
    }
    const dir = getBundleVersionDir(version);
    await rm(dir, { recursive: true, force: true });
}

/**
 * Read the agentman config file.
 */
export async function readConfig(): Promise<AgentmanConfig> {
    try {
        const raw = await readFile(getConfigPath(), "utf-8");
        return JSON.parse(raw) as AgentmanConfig;
    } catch {
        return { installations: {} };
    }
}

/**
 * Write the agentman config file.
 */
export async function writeConfig(config: AgentmanConfig): Promise<void> {
    await mkdir(getAgentmanDir(), { recursive: true });
    await writeFile(getConfigPath(), JSON.stringify(config, null, 2));
}

/**
 * Record an installation in the config.
 */
export async function recordInstall(toolId: string, skillName: string, record: InstallRecord): Promise<void> {
    const config = await readConfig();
    if (!config.installations[toolId]) {
        config.installations[toolId] = {};
    }
    config.installations[toolId][skillName] = record;
    await writeConfig(config);
}

/**
 * Remove an installation record from the config.
 */
export async function removeInstallRecord(toolId: string, skillName: string): Promise<void> {
    const config = await readConfig();
    if (config.installations[toolId]) {
        delete config.installations[toolId][skillName];
    }
    await writeConfig(config);
}
