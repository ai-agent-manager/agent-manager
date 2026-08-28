import { readdir, readFile, readlink, rm, symlink, unlink, mkdir, rename, lstat } from "node:fs/promises";
import path from "node:path";
import {
    getAgentmanDir,
    getBundlesDir,
    getBundleVersionDir,
    getCurrentBundleLink,
    getConfigPath,
    getConfigLockPath,
} from "../config/paths.js";
import { parseManifest } from "./manifest.js";
import { readRepoConfig, updateRepoConfig } from "./repo-config.js";
import { scanBundle } from "./scanner.js";
import { getPlatform } from "../lib/platform.js";
import { writeFileAtomic } from "../lib/fs.js";
import { withLock } from "../lib/file-lock.js";
import { isGithubRepoUrl, type SkillSourcePin } from "./skill-source.js";

const CONFIG_SCHEMA_VERSION = 2;

/**
 * A source agentman resolves at startup. The kind is persisted for display and
 * source management; resolution still validates the value so legacy GitHub
 * URLs stored as discovery sources continue to work.
 */
export type StoredSourceKind = "discovery" | "repo" | "directory";

export interface StoredSource {
    kind: StoredSourceKind;
    value: string;
}

/**
 * Classify a raw source string for persistence. Directory sources are resolved
 * to an absolute path so they keep working when a later invocation starts from
 * a different working directory. URLs are stored verbatim.
 */
export function classifyStoredSource(input: string): StoredSource {
    if (isGithubRepoUrl(input)) {
        return { kind: "repo", value: input };
    }
    return /^https?:\/\//i.test(input)
        ? { kind: "discovery", value: input }
        : { kind: "directory", value: path.resolve(input) };
}

function sameStoredSource(a: StoredSource, b: StoredSource): boolean {
    return a.kind === b.kind && a.value === b.value;
}

export interface CachedBundle {
    version: string;
    published: string;
    bundleDir: string;
    isCurrent: boolean;
}

export interface AgentmanConfig {
    /** Format version of this config file, stamped on every write. Absent on files written before this field existed. */
    schemaVersion?: number;
    baseUrl?: string;
    startupUpdateChecksDisabled?: boolean;
    /** Persisted telemetry opt-out. Only ever disables — env vars still take precedence. */
    telemetryDisabled?: boolean;
    /** Sources the user has added — resolved to build the catalogue. */
    sources?: StoredSource[];
    /** The source a bare `agentman` invocation resolves first. */
    activeSource?: StoredSource;
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
            await updateRepoConfig(repoRoot, (cfg) => {
                if (!cfg.installations[toolId]) cfg.installations[toolId] = {};
                cfg.installations[toolId][skillName] = {
                    ...cfg.installations[toolId][skillName],
                    bundleVersion: newVersion,
                    method: "symlink",
                };
            });

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

        await updateConfig((cfg) => {
            if (!cfg.installations[toolId]) {
                cfg.installations[toolId] = {};
            }
            cfg.installations[toolId][skillName] = {
                ...cfg.installations[toolId][skillName],
                bundleVersion: newVersion,
                method: "symlink",
            };
        });

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
 *
 * A missing file is the normal first-run case and resolves to a default,
 * empty config. A file that exists but fails to parse as JSON is corrupt —
 * it is backed up alongside itself (so nothing is silently discarded) and a
 * warning is printed; the caller still gets a default, empty config so the
 * app can proceed. Any other read error (e.g. permissions) propagates.
 */
export async function readConfig(): Promise<AgentmanConfig> {
    const configPath = getConfigPath();
    let raw: string;
    try {
        raw = await readFile(configPath, "utf-8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return { installations: {} };
        }
        throw error;
    }

    try {
        return migrateConfig(JSON.parse(raw) as AgentmanConfig);
    } catch {
        const backupPath = `${configPath}.corrupt-${Date.now()}`;
        await rename(configPath, backupPath).catch(() => {});
        console.warn(
            `Warning: config file at ${configPath} was corrupt and has been backed up to ${backupPath}. Starting with an empty config.`,
        );
        return { installations: {} };
    }
}

/**
 * Bring an on-disk config forward to the current schema. Runs on every read and
 * is idempotent. The v1→v2 step seeds the sources list from the legacy scalar
 * `baseUrl` so an existing single-source config keeps working and a bare
 * `agentman` invocation resolves what the user last pointed at. `baseUrl` is
 * left in place for backward compatibility.
 */
function migrateConfig(config: AgentmanConfig): AgentmanConfig {
    if (config.sources === undefined && config.baseUrl) {
        const seeded: StoredSource = { kind: "discovery", value: config.baseUrl };
        config.sources = [seeded];
        if (config.activeSource === undefined) {
            config.activeSource = seeded;
        }
    }
    return config;
}

/**
 * Write the agentman config file. Writes via a temp file + rename so a crash
 * or a concurrent reader never observes a partially-written file.
 */
export async function writeConfig(config: AgentmanConfig): Promise<void> {
    await mkdir(getAgentmanDir(), { recursive: true });
    const stamped: AgentmanConfig = { ...config, schemaVersion: CONFIG_SCHEMA_VERSION };
    await writeFileAtomic(getConfigPath(), JSON.stringify(stamped, null, 2));
}

/**
 * Read-modify-write the agentman config under an exclusive lock, so that a
 * concurrent agentman process (e.g. the one-liner running alongside an open
 * TUI session) cannot clobber changes made in between the read and the write.
 * `mutate` may mutate `config` in place and return nothing, or return a
 * replacement config.
 */
export async function updateConfig(
    mutate: (config: AgentmanConfig) => AgentmanConfig | void,
): Promise<AgentmanConfig> {
    return withLock(getConfigLockPath(), async () => {
        const config = await readConfig();
        const result = mutate(config) ?? config;
        await writeConfig(result);
        return result;
    });
}

/**
 * Add a source to the persisted list, idempotently. Re-adding a known source is
 * a no-op for the list (never duplicated); `setActive` still repoints the
 * active source so re-running the one-liner with a known URL makes it current.
 */
export async function addSource(source: StoredSource, options: { setActive?: boolean } = {}): Promise<void> {
    await updateConfig((config) => {
        const sources = config.sources ?? [];
        if (!sources.some((s) => sameStoredSource(s, source))) {
            sources.push(source);
        }
        config.sources = sources;
        if (options.setActive) {
            config.activeSource = source;
        }
    });
}

/**
 * Remove a source from the persisted list. If it was the active source, the
 * active pointer moves to the first remaining source (or is cleared).
 */
export async function removeSource(source: StoredSource): Promise<void> {
    await updateConfig((config) => {
        config.sources = (config.sources ?? []).filter((s) => !sameStoredSource(s, source));
        if (config.activeSource && sameStoredSource(config.activeSource, source)) {
            config.activeSource = config.sources[0];
        }
    });
}

/** Point the active source (what a bare `agentman` invocation resolves) at `source`. */
export async function setActiveSource(source: StoredSource): Promise<void> {
    await updateConfig((config) => {
        config.activeSource = source;
        const sources = config.sources ?? [];
        if (!sources.some((s) => sameStoredSource(s, source))) {
            sources.push(source);
        }
        config.sources = sources;
    });
}

/**
 * The persisted sources ordered for resolution: the active source first, then
 * the rest. A bare `agentman` invocation tries them in this order.
 */
export function orderedSources(config: AgentmanConfig): StoredSource[] {
    const sources = config.sources ?? [];
    const active = config.activeSource;
    if (!active) return sources;
    return [active, ...sources.filter((s) => !sameStoredSource(s, active))];
}

/**
 * Record an installation in the config.
 */
export async function recordInstall(toolId: string, skillName: string, record: InstallRecord): Promise<void> {
    await updateConfig((config) => {
        if (!config.installations[toolId]) {
            config.installations[toolId] = {};
        }
        config.installations[toolId][skillName] = record;
    });
}

/**
 * Remove an installation record from the config.
 */
export async function removeInstallRecord(toolId: string, skillName: string): Promise<void> {
    await updateConfig((config) => {
        if (config.installations[toolId]) {
            delete config.installations[toolId][skillName];
        }
    });
}
