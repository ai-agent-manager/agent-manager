import { readFile, rename } from "node:fs/promises";
import path from "node:path";
import type { SkillSourcePin } from "./skill-source.js";
import { writeFileAtomic } from "../lib/fs.js";
import { withLock } from "../lib/file-lock.js";

/** Name of the per-repo config file */
export const REPO_CONFIG_FILENAME = ".agentman.json";

/**
 * Per-skill install record persisted in .agentman.json.
 *
 * bundleVersion is optional so that repo/artefact installs (which have no
 * concept of a bundle version) can omit it without inventing a dummy value.
 * Legacy bundle installs always set this field, so existing .agentman.json
 * files continue to parse cleanly. When reading, prefer sourcePin if present;
 * fall back to bundleVersion for bundle-sourced skills.
 */
export interface RepoInstallRecord {
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

export interface RepoAgentmanConfig {
    /**
     * Pinned bundle version hash for this repository.
     *
     * @deprecated Conceptually stale in the multi-source model: a repo may now
     * contain skills from bundle, repo, and artefact sources, each with their own
     * version coordinate in the per-skill sourcePin. This top-level field only
     * makes sense when all installs share a single bundle origin.
     *
     * Tracked for cleanup in a follow-up ticket. Do not introduce new reads of
     * this field — use sourcePin on individual RepoInstallRecords instead.
     */
    bundleVersion?: string;
    /** Installations keyed by tool ID, then skill name */
    installations: Record<string, Record<string, RepoInstallRecord>>;
}

function getRepoConfigPath(repoRoot: string): string {
    return path.join(repoRoot, REPO_CONFIG_FILENAME);
}

function getRepoConfigLockPath(repoRoot: string): string {
    return `${getRepoConfigPath(repoRoot)}.lock`;
}

/**
 * Read the per-repo `.agentman.json` config.
 * Returns `null` if the file does not exist.
 *
 * A file that exists but fails to parse as JSON is corrupt — it is backed up
 * alongside itself (nothing is silently discarded) and a warning is printed;
 * the caller gets `null`, the same as a missing file. Any other read error
 * (e.g. permissions) propagates.
 */
export async function readRepoConfig(repoRoot: string): Promise<RepoAgentmanConfig | null> {
    const configPath = getRepoConfigPath(repoRoot);
    let raw: string;
    try {
        raw = await readFile(configPath, "utf-8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return null;
        }
        throw error;
    }

    try {
        return JSON.parse(raw) as RepoAgentmanConfig;
    } catch {
        const backupPath = `${configPath}.corrupt-${Date.now()}`;
        await rename(configPath, backupPath).catch(() => {});
        console.warn(
            `Warning: config file at ${configPath} was corrupt and has been backed up to ${backupPath}. Starting with an empty config.`,
        );
        return null;
    }
}

/**
 * Write the per-repo `.agentman.json` config. Writes via a temp file +
 * rename so a crash or a concurrent reader never observes a
 * partially-written file.
 */
export async function writeRepoConfig(repoRoot: string, config: RepoAgentmanConfig): Promise<void> {
    await writeFileAtomic(getRepoConfigPath(repoRoot), JSON.stringify(config, null, 2) + "\n");
}

/**
 * Read-modify-write the repo config under an exclusive lock, so that a
 * concurrent agentman process cannot clobber changes made in between the
 * read and the write. `mutate` may mutate the config in place and return
 * nothing, or return a replacement config.
 */
export async function updateRepoConfig(
    repoRoot: string,
    mutate: (config: RepoAgentmanConfig, wasCreated: boolean) => RepoAgentmanConfig | void,
): Promise<RepoAgentmanConfig> {
    return withLock(getRepoConfigLockPath(repoRoot), async () => {
        const existing = await readRepoConfig(repoRoot);
        const config: RepoAgentmanConfig = existing ?? { installations: {} };
        const result = mutate(config, existing === null) ?? config;
        await writeRepoConfig(repoRoot, result);
        return result;
    });
}

/**
 * Record a skill installation in the repo config.
 * Creates the config file if it doesn't exist.
 *
 * bundleVersion is optional — pass it for bundle-sourced installs, omit it
 * for repo/artefact installs where version is tracked via sourcePin instead.
 */
export async function recordRepoInstall(
    repoRoot: string,
    toolId: string,
    skillName: string,
    record: Omit<RepoInstallRecord, 'bundleVersion'>,
    bundleVersion?: string,
): Promise<void> {
    await updateRepoConfig(repoRoot, (config, wasCreated) => {
        if (wasCreated && bundleVersion !== undefined) {
            config.bundleVersion = bundleVersion;
        }
        if (!config.installations[toolId]) {
            config.installations[toolId] = {};
        }
        const entry: RepoInstallRecord = { ...record };
        if (bundleVersion !== undefined) entry.bundleVersion = bundleVersion;
        config.installations[toolId][skillName] = entry;
    });
}

/**
 * Remove a skill installation record from the repo config.
 */
export async function removeRepoInstallRecord(repoRoot: string, toolId: string, skillName: string): Promise<void> {
    // Nothing to remove from a config that doesn't exist yet — and creating
    // one here would leave a stray .agentman.json where none existed before.
    const existing = await readRepoConfig(repoRoot);
    if (!existing) return;

    await updateRepoConfig(repoRoot, (config) => {
        if (config.installations[toolId]) {
            delete config.installations[toolId][skillName];
            // Clean up empty tool entries
            if (Object.keys(config.installations[toolId]).length === 0) {
                delete config.installations[toolId];
            }
        }
    });
}

/**
 * Update the pinned bundle version in the repo config.
 * Creates the config file if it doesn't exist.
 */
export async function pinRepoVersion(repoRoot: string, bundleVersion: string): Promise<void> {
    await updateRepoConfig(repoRoot, (config) => {
        config.bundleVersion = bundleVersion;
    });
}
