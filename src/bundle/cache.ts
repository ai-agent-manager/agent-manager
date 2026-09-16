import { randomUUID } from 'node:crypto';
import { createLink } from '../lib/symlink.js';
import { assertSafeCacheSegment } from '../lib/path-segment.js';
import { OperationConflictError } from '../lib/mutation.js';
import { assertBundleVersion, assertCachePath, resolvePinnedBundle } from './version-identity.js';
import { assertBundleUnreferenced } from './references.js';
import { withMutation } from '../lib/mutation.js';
import { readdir, readFile, readlink, rm, symlink, mkdir, rename } from "node:fs/promises";
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
import { existsSync, statSync } from "node:fs";
import { parseGitRemoteInput, isGithubRepoShorthand } from "../discovery/git-probe.js";
import { type SkillSourcePin } from "./skill-source.js";

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
 * a different working directory. Git remotes are stored in a form that still
 * parses as a git remote on reload:
 * - GitHub / GHES → canonical HTTPS identity, with `/tree/<ref>` when pinned
 *   (so shorthand dedupes with the full URL and cwd cannot flip it to a local dir)
 * - Other hosts → clone URL (keeps `.git` / full path so reload does not become
 *   an HTTP discovery base)
 * Other URLs are stored verbatim.
 */
export function classifyStoredSource(input: string): StoredSource {
    // An existing local directory wins over GitHub `owner/repo` shorthand.
    if (isGithubRepoShorthand(input)) {
        try {
            const resolved = path.resolve(input);
            if (existsSync(resolved) && statSync(resolved).isDirectory()) {
                return { kind: "directory", value: resolved };
            }
        } catch {
            // Fall through to git remote classification.
        }
    }

    // Git remotes are stored as repo sources; resolveSource re-probes for a
    // discovery document on every resolve so adding/removing the file flips mode.
    const gitRemote = parseGitRemoteInput(input);
    if (gitRemote) {
        return { kind: "repo", value: persistedGitRemoteValue(gitRemote) };
    }
    return /^https?:\/\//i.test(input)
        ? { kind: "discovery", value: input }
        : { kind: "directory", value: path.resolve(input) };
}

/**
 * Value written to the source list for a parsed git remote.
 * Must round-trip through {@link parseGitRemoteInput} / {@link resolveSource}.
 */
export function persistedGitRemoteValue(remote: {
    identity: string;
    cloneUrl: string;
    ref?: string;
    refPinned: boolean;
    supportsDirectSkillInstall: boolean;
}): string {
    if (remote.supportsDirectSkillInstall) {
        if (remote.refPinned && remote.ref) {
            return `${remote.identity}/tree/${remote.ref}`;
        }
        return remote.identity;
    }
    return remote.cloneUrl;
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
    return withMutation(async () => {
        assertBundleVersion(version);
        const targetDir = getBundleVersionDir(version);
        await assertCachePath(targetDir);
        const linkPath = getCurrentBundleLink();
        const staged = `${linkPath}.stage-${randomUUID()}`;
        const backup = `${linkPath}.backup-${randomUUID()}`;
        let backedUp = false;
        try {
            await symlink(targetDir, staged, getPlatform() === "windows" ? "junction" : "dir");
            try { await rename(linkPath, backup); backedUp = true; }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
            await rename(staged, linkPath);
        } catch (error) {
            if (backedUp) await rename(backup, linkPath);
            throw error;
        } finally {
            await rm(staged, { force: true });
        }
        await rm(backup, { force: true });
    });
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
): Promise<{ success: boolean; error?: string; code?: string; statusCode?: number }> {
    try {
        return await withMutation(async () => {
            assertBundleVersion(newVersion);
            const scope = options?.scope ?? 'system';
            const repoRoot = options?.repoRoot;
            if (scope === 'repo' && !repoRoot) throw new OperationConflictError('repoRoot is required for repo-scoped skill updates');
            const config = scope === 'repo' ? await readRepoConfig(repoRoot!) : await readConfig();
            const record = config?.installations[toolId]?.[skillName];
            if (!record) throw new OperationConflictError(`Skill '${skillName}' is not installed for ${toolId} at ${scope} scope`);
            const bareName = skillName.split('/').at(-1)!;
            const linkName = record.linkName ?? bareName;
            assertSafeCacheSegment(bareName, 'Skill directory');
            assertSafeCacheSegment(linkName, 'Installed link name');
            const skillPathResult = await resolveInstalledSkillPath(toolId, scope, repoRoot, linkName);
            if (!skillPathResult.ok) throw new OperationConflictError(skillPathResult.error);
            // Both ends must be attested, not just the destination label.
            await resolvePinnedBundle(record.sourcePin, getRecordVersion(record));
            const candidate = await resolvePinnedBundle(record.sourcePin, newVersion);
            const contents = await scanBundle(candidate.bundleDir);
            const skill = contents.skills.find((item) => item.dirName === bareName);
            if (!skill) throw new OperationConflictError(`Skill '${bareName}' does not exist in version ${newVersion}`);
            await assertCachePath(skill.dirPath);
            const skillPath = skillPathResult.skillPath;
            const staged = `${skillPath}.stage-${randomUUID()}`;
            const backup = `${skillPath}.backup-${randomUUID()}`;
            let backedUp = false;
            let published = false;
            try {
                const link = await createLink(skill.dirPath, staged);
                try { await rename(skillPath, backup); backedUp = true; }
                catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
                await rename(staged, skillPath);
                published = true;
                const updated = { ...record, bundleVersion: newVersion,
                    sourcePin: { ...record.sourcePin!, bundleVersion: newVersion }, method: link.method };
                if (scope === 'repo') {
                    await updateRepoConfig(repoRoot!, (cfg) => { cfg.installations[toolId][skillName] = updated; });
                } else {
                    await updateConfig((cfg) => { cfg.installations[toolId][skillName] = updated; });
                }
            } catch (error) {
                if (published) await rm(skillPath, { recursive: true, force: true });
                if (backedUp) await rename(backup, skillPath);
                throw error;
            } finally {
                await rm(staged, { recursive: true, force: true });
            }
            await rm(backup, { recursive: true, force: true });
            return { success: true };
        });
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error),
            ...(error instanceof OperationConflictError ? { code: error.code, statusCode: error.statusCode } : {}) };
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
    return withMutation(async () => {
        assertBundleVersion(version);
        const current = await getCurrentBundleVersion();
        if (current === version) {
            throw new OperationConflictError("Cannot remove the currently active bundle. Switch to another version first.");
        }
        const dir = getBundleVersionDir(version);
        await assertCachePath(dir);
        await assertBundleUnreferenced(version, dir);
        await rm(dir, { recursive: true, force: true });
    });
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
    return withMutation(async () => {
        await mkdir(getAgentmanDir(), { recursive: true });
        const stamped: AgentmanConfig = { ...config, schemaVersion: CONFIG_SCHEMA_VERSION };
        await writeFileAtomic(getConfigPath(), JSON.stringify(stamped, null, 2));
    });
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
    return withMutation(async () => {
        return withLock(getConfigLockPath(), async () => {
            const config = await readConfig();
            const result = mutate(config) ?? config;
            await writeConfig(result);
            return result;
        });
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
