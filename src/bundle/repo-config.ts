import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** Name of the per-repo config file */
export const REPO_CONFIG_FILENAME = ".agentman.json";

export interface RepoInstallRecord {
    bundleVersion: string;
    installedAt: string;
    method: "symlink" | "copy";
}

export interface RepoAgentmanConfig {
    /** Pinned bundle version hash for this repository */
    bundleVersion: string;
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
 * Creates the config file if it doesn't exist, using the provided `bundleVersion`.
 */
export async function recordRepoInstall(
    repoRoot: string,
    toolId: string,
    skillName: string,
    record: Omit<RepoInstallRecord, 'bundleVersion'>,
    bundleVersion: string,
): Promise<void> {
    let config = await readRepoConfig(repoRoot);
    if (!config) {
        config = { bundleVersion, installations: {} };
    }

    if (!config.installations[toolId]) {
        config.installations[toolId] = {};
    }
    config.installations[toolId][skillName] = { ...record, bundleVersion };
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
