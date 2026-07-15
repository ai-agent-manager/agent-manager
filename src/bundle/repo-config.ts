import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SkillSourcePin } from "./skill-source.js";

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

/**
 * Read the per-repo `.agentman.json` config.
 * Returns `null` if the file does not exist.
 */
export async function readRepoConfig(repoRoot: string): Promise<RepoAgentmanConfig | null> {
    try {
        const raw = await readFile(getRepoConfigPath(repoRoot), "utf-8");
        return JSON.parse(raw) as RepoAgentmanConfig;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return null;
        }

        throw error;
    }
}

/**
 * Write the per-repo `.agentman.json` config.
 */
export async function writeRepoConfig(repoRoot: string, config: RepoAgentmanConfig): Promise<void> {
    await writeFile(getRepoConfigPath(repoRoot), JSON.stringify(config, null, 2) + "\n");
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
    let config = await readRepoConfig(repoRoot);
    if (!config) {
        config = { ...(bundleVersion !== undefined && { bundleVersion }), installations: {} };
    }

    if (!config.installations[toolId]) {
        config.installations[toolId] = {};
    }
    const entry: RepoInstallRecord = { ...record };
    if (bundleVersion !== undefined) entry.bundleVersion = bundleVersion;
    config.installations[toolId][skillName] = entry;
    await writeRepoConfig(repoRoot, config);
}

/**
 * Remove a skill installation record from the repo config.
 */
export async function removeRepoInstallRecord(repoRoot: string, toolId: string, skillName: string): Promise<void> {
    const config = await readRepoConfig(repoRoot);
    if (!config) return;

    if (config.installations[toolId]) {
        delete config.installations[toolId][skillName];
        // Clean up empty tool entries
        if (Object.keys(config.installations[toolId]).length === 0) {
            delete config.installations[toolId];
        }
    }
    await writeRepoConfig(repoRoot, config);
}

/**
 * Update the pinned bundle version in the repo config.
 * Creates the config file if it doesn't exist.
 */
export async function pinRepoVersion(repoRoot: string, bundleVersion: string): Promise<void> {
    let config = await readRepoConfig(repoRoot);
    if (!config) {
        config = { bundleVersion, installations: {} };
    } else {
        config.bundleVersion = bundleVersion;
    }
    await writeRepoConfig(repoRoot, config);
}
