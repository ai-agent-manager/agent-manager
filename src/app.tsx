import React, { useEffect, useState, useCallback, useMemo } from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { APP_VERSION } from "./app-info.js";
import { AppUpdateManager } from "./components/AppUpdateManager.js";
import { AuthPrompt } from "./components/AuthPrompt.js";
import { ChromeExtensionInstall } from "./components/ChromeExtensionInstall.js";
import { ChromeExtensionServer } from "./components/ChromeExtensionServer.js";
import { MainMenu } from "./components/MainMenu.js";
import { MaintenanceMenu } from "./components/MaintenanceMenu.js";
import { ProjectsMenu } from "./components/ProjectsMenu.js";
import { SettingsScreen } from "./components/SettingsScreen.js";
import { ManageFlow } from "./components/ManageFlow.js";
import { SkillInstallFlow } from "./components/SkillInstallFlow.js";
import { SourceManager } from "./components/SourceManager.js";
import { UrlInstallFlow } from "./components/UrlInstallFlow.js";
import { RovoMenu } from "./components/RovoMenu.js";
import { RovoMethodMenu } from "./components/RovoMethodMenu.js";
import { ScopeSelector } from "./components/ScopeSelector.js";
import { SkillSelector } from "./components/SkillSelector.js";
import { SkillVersionManager } from "./components/SkillVersionManager.js";
import { LoadingSpinner } from "./components/Spinner.js";
import { StartupNoticePanel } from "./components/StartupNoticePanel.js";
import { StatusMessage } from "./components/StatusMessage.js";
import { ToolSelector } from "./components/ToolSelector.js";
import { VersionManager } from "./components/VersionManager.js";
import { getCurrentBundleVersion, readConfig, setCurrentBundle, updateConfig } from "./bundle/cache.js";
import { downloadBundle } from "./bundle/downloader.js";
import { extractBundle } from "./bundle/extractor.js";
import { importLocalBundle } from "./bundle/importer.js";
import type { BundleManifest } from "./bundle/manifest.js";
import { readRepoConfig } from "./bundle/repo-config.js";
import { scanBundle, type BundleContents, type RovoAgentInfo } from "./bundle/scanner.js";
import type { BundleSource } from "./bundle/source.js";
import { getBundleVersionDir } from "./config/paths.js";
import type { InstallScope } from "./config/scopes.js";
import type { StartupUpdateNotice } from "./lib/startup-update-checks.js";
import { checkForStartupUpdates, shouldRunStartupUpdateChecks } from "./lib/startup-update-checks.js";
import { getBundleSourceTelemetryProperties, setTelemetryDisabledByConfig, trackTelemetryError, trackTelemetryEvent, type TelemetryValue } from "./telemetry.js";
import { featureFlags } from "./lib/feature-flags.js";
import { resolveDiscoverySkills, type ResolvedSkill } from "./discovery/index.js";
import {
    buildPinForDirectorySource,
    buildSourcePin,
    type BundleSkillSource,
    type RepoSkillSource,
} from "./bundle/skill-source.js";
import {
    canAccessMyProjects,
    isApiAuthFailure,
    isApiTransientFailure,
    isProjectsExclusiveSource,
    listProjects,
    resolveApiBaseUrl,
    type Project,
} from "./api/index.js";
import {
    buildScopedCatalogue,
    resolveCatalogueScope,
    scopeCatalogueAssets,
    scopeSkills,
} from "./catalogue-scope/index.js";
import { authenticate, openInBrowser, createDiscoveryAccessTokenProvider, type AuthSession } from "./auth/index.js";

export type Screen =
    | "loading"
    | "auth"
    | "main-menu"
    | "my-projects"
    | "maintenance-menu"
    | "settings"
    | "skill-install"
    | "url-install"
    | "source-manager"
    | "manage-installed"
    | "scope-selector"
    | "tool-selector"
    | "skill-selector"
    | "version-manager"
    | "skill-version-manager"
    | "app-update"
    | "rovo-method"
    | "rovo-menu"
    | "chrome-extension"
    | "chrome-extension-install";

interface AppProps {
    source: BundleSource | undefined;
    directInstallSource?: RepoSkillSource;
    forceUpdate: boolean;
    sourceError?: string;
}

async function acquireBundle(
    source: BundleSource,
    setLoadingMessage: (message: string) => void,
): Promise<{ manifest: BundleManifest; bundleDir: string; isNew: boolean; warning?: string }> {
    if (source.type === "url") {
        setLoadingMessage("Downloading agent bundle...");
        const { zipPath } = await downloadBundle(source.baseUrl);

        setLoadingMessage("Extracting bundle...");
        try {
            return await extractBundle(zipPath);
        } catch (error) {
            trackTelemetryError("bundle_extract_failed", error, getBundleSourceTelemetryProperties(source));
            throw error;
        }
    }

    if (source.type === "directory") {
        setLoadingMessage("Importing local bundle...");
        try {
            return await importLocalBundle(source.dirPath);
        } catch (error) {
            trackTelemetryError("bundle_import_failed", error, getBundleSourceTelemetryProperties(source));
            throw error;
        }
    }

    // type === "discovery" is handled separately via resolveDiscoverySkills
    throw new Error("Discovery sources are resolved via the discovery flow, not acquireBundle");
}

/**
 * Resolve skills from a discovery document, handling authentication if required.
 */
async function acquireDiscoverySkills(
    source: Extract<BundleSource, { type: 'discovery' }>,
    setLoadingMessage: (message: string) => void,
    onAuthPrompt: (authorizeUrl: string) => void,
): Promise<{
    skills: ResolvedSkill[];
    rovoAgents: RovoAgentInfo[];
    warnings: string[];
    bundleVersion?: string;
    manifest?: BundleManifest;
    bundleDir?: string;
    authSession?: AuthSession;
}> {
    const warnings: string[] = [];
    let authSession: AuthSession | undefined;

    // Handle authentication if required
    if (source.discovery.auth?.required) {
        setLoadingMessage("Authenticating...");
        const authResult = await authenticate(
            source.baseUrl,
            source.discovery.auth,
            onAuthPrompt,
            { interactiveMode: true, requestUrl: source.baseUrl },
        );
        authSession = {
            discoveryBaseUrl: source.baseUrl,
            auth: source.discovery.auth,
            interactiveMode: true,
        };
        if (authResult.fromEnv) {
            warnings.push("Using access token from AGENTMAN_ACCESS_TOKEN");
        } else if (!authResult.fromCache && authResult.backend === 'filesystem') {
            warnings.push("Tokens stored at ~/.agentman/auth/ (OS keychain unavailable, using filesystem with restricted permissions)");
        }
    }

    setLoadingMessage("Resolving skills from discovery document...");
    const result = await resolveDiscoverySkills(
        source.discovery,
        undefined,
        setLoadingMessage,
        authSession ? { authSession } : undefined,
    );

    for (const { source, error } of result.errors) {
        warnings.push(`Failed to resolve source '${source.name}': ${error}`);
    }

    return {
        skills: result.skills,
        rovoAgents: result.rovoAgents,
        warnings,
        bundleVersion: result.bundleVersion,
        manifest: result.manifest,
        bundleDir: result.bundleDir,
        authSession,
    };
}

export function App({ source, directInstallSource, forceUpdate, sourceError }: AppProps) {
    const [screen, setScreen] = useState<Screen>(directInstallSource ? "url-install" : "loading");
    const [manifest, setManifest] = useState<BundleManifest | null>(null);
    const [bundleContents, setBundleContents] = useState<BundleContents | null>(null);
    const [bundleDir, setBundleDir] = useState<string>("");
    const [toolsQueue, setToolsQueue] = useState<string[]>([]);
    const [toolsQueueTotal, setToolsQueueTotal] = useState(0);
    const [installScope, setInstallScope] = useState<InstallScope>("system");
    const [repoRoot, setRepoRoot] = useState<string | null>(null);
    const [loadingMessage, setLoadingMessage] = useState("Initializing...");
    const [error, setError] = useState<string | null>(null);
    const [warning, setWarning] = useState<string | null>(null);
    const [startupNotices, setStartupNotices] = useState<StartupUpdateNotice[]>([]);
    const [repoBundleContents, setRepoBundleContents] = useState<BundleContents | null>(null);
    const [repoBundleVersion, setRepoBundleVersion] = useState<string | null>(null);
    const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
    const [discoverySkills, setDiscoverySkills] = useState<ResolvedSkill[] | null>(null);
    const [discoveryBundleVersion, setDiscoveryBundleVersion] = useState<string | null>(null);
    // Set when a Rovo agent is picked from the unified catalogue; scopes the Rovo
    // flow to that one agent. Null when Rovo is entered via the standalone menu.
    const [selectedRovoAgent, setSelectedRovoAgent] = useState<RovoAgentInfo | null>(null);
    const [authSession, setAuthSession] = useState<AuthSession | null>(null);
    /** When set, skill/agent install flows are filtered by the project's allowlists. */
    const [projectContext, setProjectContext] = useState<Project | null>(null);
    /** Re-open this project detail after returning from a project-scoped install. */
    const [resumeProjectId, setResumeProjectId] = useState<string | null>(null);
    /**
     * Membership projects for `projects.exclusiveSource` filtering of global
     * Search & Install. Null until loaded (or when exclusiveSource is off).
     */
    const [membershipProjects, setMembershipProjects] = useState<Project[] | null>(null);

    const bundleTelemetryProps: Record<string, TelemetryValue> = source ? getBundleSourceTelemetryProperties(source) : {};

    const returnToProjects = useCallback(() => {
        setResumeProjectId(projectContext?.id ?? null);
        setProjectContext(null);
        setSelectedRovoAgent(null);
        setScreen("my-projects");
    }, [projectContext]);

    const returnToMainMenu = useCallback(() => {
        setResumeProjectId(null);
        setProjectContext(null);
        setSelectedRovoAgent(null);
        setScreen("main-menu");
    }, []);

    const discoveryProjectsConfig =
        source?.type === "discovery" ? source.discovery.projects : undefined;
    const exclusiveSource = isProjectsExclusiveSource(discoveryProjectsConfig);
    const apiBaseUrl =
        source?.type === "discovery"
            ? resolveApiBaseUrl(source.discovery.api?.baseUrl)
            : undefined;

    useEffect(() => {
        if (!exclusiveSource || !apiBaseUrl || !authSession) {
            setMembershipProjects(null);
            return;
        }

        let cancelled = false;
        (async () => {
            try {
                const projects = await listProjects(apiBaseUrl, authSession);
                if (!cancelled) {
                    setMembershipProjects(projects);
                }
            } catch (error) {
                if (!cancelled) {
                    setMembershipProjects([]);
                    const detail =
                        error instanceof Error ? error.message : String(error);
                    let warning: string;
                    if (isApiAuthFailure(error)) {
                        warning =
                            `Authentication failed while loading project memberships. Sign in again and retry.\n${detail}`;
                    } else if (isApiTransientFailure(error)) {
                        warning =
                            `Temporarily unable to load project memberships for exclusive catalogue filtering. The catalogue is empty until this succeeds.\n${detail}`;
                    } else {
                        warning =
                            `Could not load project memberships for exclusive catalogue filtering:\n${detail}`;
                    }
                    setWarning(warning);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [exclusiveSource, apiBaseUrl, authSession]);

    const leaveInstallFlow = useCallback(() => {
        if (projectContext) {
            returnToProjects();
            return;
        }
        returnToMainMenu();
    }, [projectContext, returnToProjects, returnToMainMenu]);

    const startBundleUpdateCheck = () => {
        // Startup notices (which trigger this) are only ever populated once a
        // source has resolved, so this is unreachable without one.
        if (!source) return;

        setScreen("loading");
        setLoadingMessage("Checking for updates...");
        trackTelemetryEvent({
            action: "update_check_started",
            properties: bundleTelemetryProps,
        });
        (async () => {
            try {
                const result = await acquireBundle(source, setLoadingMessage);
                const shouldActivateBundle = manifest?.version !== result.manifest.version;

                if (result.isNew || shouldActivateBundle) {
                    await setCurrentBundle(result.manifest.version);

                    let contents: BundleContents;
                    try {
                        contents = await scanBundle(result.bundleDir, result.manifest.agents);
                    } catch (scanError) {
                        trackTelemetryError("bundle_scan_failed", scanError, {
                            ...bundleTelemetryProps,
                            version: result.manifest.version,
                        });
                        throw scanError;
                    }

                    setManifest(result.manifest);
                    setBundleContents(contents);
                    setBundleDir(result.bundleDir);
                    setError(null);
                    setStartupNotices((current) => current.filter((notice) => notice.kind !== "bundle"));
                } else {
                    setError(null);
                }

                trackTelemetryEvent({
                    action: "update_check_completed",
                    properties: {
                        ...bundleTelemetryProps,
                        status: result.isNew ? "updated" : shouldActivateBundle ? "switched" : "no_change",
                        version: result.manifest.version,
                    },
                });

                if (result.warning) {
                    setWarning(result.warning);
                }

                setScreen("main-menu");
            } catch (updateError) {
                trackTelemetryError("update_check_failed", updateError, bundleTelemetryProps);
                setError(updateError instanceof Error ? updateError.message : String(updateError));
                setScreen("main-menu");
            }
        })();
    };

    const handleAuthPrompt = useCallback((url: string) => {
        setAuthorizeUrl(url);
        setScreen("auth");
    }, []);

    const handleAuthOpen = useCallback(() => {
        if (authorizeUrl) {
            openInBrowser(authorizeUrl);
        }
    }, [authorizeUrl]);

    // Lazy, origin-scoped token provisioning: authentication happens at the
    // protected operation boundary (an Update requesting a token), never at
    // screen entry — so list/info/remove are never gated behind a login and
    // the token is validated or refreshed immediately before the download.
    const provideAccessToken = useMemo(
        () =>
            createDiscoveryAccessTokenProvider(
                source?.type === "discovery"
                    ? { baseUrl: source.baseUrl, document: source.discovery }
                    : null,
            ),
        [source],
    );

    useEffect(() => {
        if (directInstallSource) {
            setScreen("url-install");
            return;
        }

        if (!source) {
            // No usable source: skip bundle/discovery resolution entirely and land
            // straight on Source Management instead of a dead end. This covers both
            // "nothing configured yet" and "configured sources all failed to resolve".
            setWarning(
                sourceError
                    ? `Could not resolve any configured source:\n${sourceError}`
                    : "No source configured yet. Add one from Source Management to get started.",
            );
            setScreen("source-manager");
            return;
        }

        (async () => {
            try {
                const startupConfig = await readConfig();
                setTelemetryDisabledByConfig(startupConfig.telemetryDisabled ?? false);

                if (source.type === "discovery" || source.type === "url") {
                    await updateConfig((config) => {
                        if (config.baseUrl !== source.baseUrl) {
                            config.baseUrl = source.baseUrl;
                        }
                    });
                }

                // --- Discovery source: resolve skills from discovery document ---
                if (source.type === "discovery") {
                    const {
                        skills,
                        rovoAgents,
                        warnings,
                        bundleVersion: discoveredVersion,
                        manifest: discoveredManifest,
                        bundleDir: discoveredBundleDir,
                        authSession: session,
                    } = await acquireDiscoverySkills(
                        source,
                        setLoadingMessage,
                        handleAuthPrompt,
                    );

                    if (warnings.length > 0) {
                        setWarning(warnings.join("\n"));
                    }

                    setDiscoverySkills(skills);
                    if (discoveredVersion) setDiscoveryBundleVersion(discoveredVersion);
                    if (discoveredManifest) setManifest(discoveredManifest);
                    if (discoveredBundleDir) setBundleDir(discoveredBundleDir);
                    setBundleContents({ skills, rovoAgents });
                    setAuthSession(session ?? null);
                    setScreen("main-menu");
                    return;
                }

                // --- Legacy bundle source (directory) ---

                const currentVersion = await getCurrentBundleVersion();
                let bundleVersionDir: string;
                let loadedManifest: BundleManifest;

                if (!currentVersion || forceUpdate || source.type === "directory") {
                    const result = await acquireBundle(source, setLoadingMessage);
                    loadedManifest = result.manifest;
                    bundleVersionDir = result.bundleDir;

                    if (result.warning) {
                        setWarning(result.warning);
                    }

                    if (result.isNew) {
                        setLoadingMessage("Setting up new bundle version...");
                    }

                    await setCurrentBundle(loadedManifest.version);
                } else {
                    bundleVersionDir = getBundleVersionDir(currentVersion);
                    try {
                        const { readFile } = await import("node:fs/promises");
                        const raw = await readFile(`${bundleVersionDir}/manifest.json`, "utf-8");
                        const { parseManifest } = await import("./bundle/manifest.js");
                        loadedManifest = parseManifest(raw);
                    } catch (loadError) {
                        trackTelemetryError("bundle_manifest_load_failed", loadError, {
                            ...bundleTelemetryProps,
                            version: currentVersion,
                        });
                        throw loadError;
                    }
                }

                setLoadingMessage("Scanning bundle contents...");

                let scannedContents: BundleContents;
                try {
                    scannedContents = await scanBundle(bundleVersionDir, loadedManifest.agents);
                } catch (scanError) {
                    trackTelemetryError("bundle_scan_failed", scanError, {
                        ...bundleTelemetryProps,
                        version: loadedManifest.version,
                    });
                    throw scanError;
                }

                setManifest(loadedManifest);
                setBundleContents(scannedContents);
                setBundleDir(bundleVersionDir);
                setScreen("main-menu");

                const config = await readConfig();
                if (shouldRunStartupUpdateChecks(config)) {
                    void (async () => {
                        const result = await checkForStartupUpdates({
                            source,
                            currentBundleVersion: loadedManifest.version,
                        });

                        if (result.notices.length > 0) {
                            setStartupNotices(result.notices);
                        }

                        for (const startupError of result.errors) {
                            trackTelemetryError(
                                startupError.kind === "app"
                                    ? "startup_app_update_check_failed"
                                    : "startup_bundle_update_check_failed",
                                startupError.error,
                                bundleTelemetryProps,
                            );
                        }

                        trackTelemetryEvent({
                            action: "startup_update_check_completed",
                            properties: {
                                ...bundleTelemetryProps,
                                appUpdateAvailable: result.notices.some((notice) => notice.kind === "app"),
                                bundleUpdateAvailable: result.notices.some((notice) => notice.kind === "bundle"),
                                startupCheckErrors: result.errors.length,
                            },
                        });
                    })();
                }
            } catch (initialiseError) {
                setError(initialiseError instanceof Error ? initialiseError.message : String(initialiseError));
                setScreen("main-menu");
            }
        })();
    }, []);

    const handleScopeSelect = async (scope: InstallScope, selectedRepoRoot: string | null) => {
        setInstallScope(scope);
        setRepoRoot(selectedRepoRoot);
        setRepoBundleContents(null);
        setRepoBundleVersion(null);

        if (scope === "repo" && selectedRepoRoot) {
            let repoConfig;
            try {
                repoConfig = await readRepoConfig(selectedRepoRoot);
            } catch (readError) {
                trackTelemetryError("repo_config_read_failed", readError, bundleTelemetryProps);
                setError(readError instanceof Error ? readError.message : String(readError));
                setScreen("main-menu");
                return;
            }

            if (repoConfig?.bundleVersion && repoConfig.bundleVersion !== manifest?.version) {
                const pinnedDir = getBundleVersionDir(repoConfig.bundleVersion);

                try {
                    const { readFile } = await import("node:fs/promises");
                    const { parseManifest } = await import("./bundle/manifest.js");
                    const pinnedManifestRaw = await readFile(`${pinnedDir}/manifest.json`, "utf-8");
                    const pinnedManifest = parseManifest(pinnedManifestRaw);
                    const contents = await scanBundle(pinnedDir, pinnedManifest.agents);
                    setRepoBundleContents(contents);
                    setRepoBundleVersion(repoConfig.bundleVersion);
                } catch (loadError) {
                    trackTelemetryError("repo_pinned_bundle_load_failed", loadError, {
                        ...bundleTelemetryProps,
                        version: repoConfig.bundleVersion,
                    });
                }
            }
        }

        setScreen("tool-selector");
    };

    const handleVersionChanged = (newVersion: string) => {
        (async () => {
            try {
                const bundleVersionDir = getBundleVersionDir(newVersion);
                const { readFile } = await import("node:fs/promises");
                const raw = await readFile(`${bundleVersionDir}/manifest.json`, "utf-8");
                const { parseManifest } = await import("./bundle/manifest.js");
                const loadedManifest = parseManifest(raw);
                const contents = await scanBundle(bundleVersionDir, loadedManifest.agents);

                setManifest(loadedManifest);
                setBundleContents(contents);
                setBundleDir(bundleVersionDir);
                setError(null);
            } catch (loadError) {
                trackTelemetryError("bundle_version_reload_failed", loadError, {
                    ...bundleTelemetryProps,
                    version: newVersion,
                });
                setError(loadError instanceof Error ? loadError.message : String(loadError));
            }
        })();
    };

    const effectiveContents = installScope === "repo" && repoBundleContents ? repoBundleContents : bundleContents;
    const effectiveVersion =
        installScope === "repo" && repoBundleVersion ? repoBundleVersion : (manifest?.version ?? discoveryBundleVersion ?? "unknown");

    // Discovery skills carry real source metadata; legacy bundle/directory
    // skills get a synthesised bundle source so the skill-first flow still works.
    // The same bundle pin the headless path records is attached here so a skill
    // installed interactively from a directory/bundle gets an identical record
    // (and the update path reports the accurate "local directory" reason).
    const legacyBundlePin =
        source?.type === "directory"
            ? buildPinForDirectorySource(source.dirPath, effectiveVersion)
            : source?.type === "url"
                ? buildSourcePin({ type: "bundle", baseUrl: source.baseUrl, installLayout: "flat" } as BundleSkillSource, effectiveVersion)
                : undefined;
    const catalogueSkills: ResolvedSkill[] =
        discoverySkills ??
        (bundleContents?.skills ?? []).map((skill) => ({
            ...skill,
            sourcePin: skill.sourcePin ?? legacyBundlePin,
            sourceName: "bundle",
            sourceType: "http" as const,
        }));
    const allRovoAgents = bundleContents?.rovoAgents ?? [];

    const catalogueScope = resolveCatalogueScope({
        projectContext,
        exclusiveSource,
        membershipProjects,
    });
    const { skills: scopedSkills, agents: scopedAgents } = scopeCatalogueAssets(
        catalogueSkills,
        allRovoAgents,
        catalogueScope,
    );
    const catalogueEntries = buildScopedCatalogue(catalogueSkills, allRovoAgents, catalogueScope);
    const bulkSyncSkills = scopeSkills(effectiveContents?.skills ?? [], catalogueScope);

    const hasProjectsAccess =
        source?.type === "discovery" &&
        canAccessMyProjects({
            authRequired: source.discovery.auth?.required,
            projects: source.discovery.projects,
            apiBaseUrl,
            authSession,
        });

    if (screen === "loading") {
        return (
            <Box flexDirection="column">
                <LoadingSpinner message={loadingMessage} />
            </Box>
        );
    }

    if (screen === "auth" && authorizeUrl) {
        return (
            <Box flexDirection="column">
                <AuthPrompt authorizeUrl={authorizeUrl} onOpen={handleAuthOpen} />
            </Box>
        );
    }

    return (
        <Box flexDirection="column">
            <Text dimColor>
                {manifest
                    ? `  Agent Manager: v${APP_VERSION} | Bundle: v${manifest.version} (${manifest.published.slice(0, 10)})`
                    : discoverySkills
                        ? `  Agent Manager: v${APP_VERSION} | Discovery: ${source?.type === "discovery" ? new URL(source.baseUrl).hostname : "local"}`
                        : `  Agent Manager: v${APP_VERSION}`}
                {manifest && bundleContents
                    ? ` | ${bundleContents.skills.length} skill${bundleContents.skills.length !== 1 ? "s" : ""}, ${bundleContents.rovoAgents.length} rovo agent${bundleContents.rovoAgents.length !== 1 ? "s" : ""}`
                    : discoverySkills
                        ? ` | ${discoverySkills.length} skill${discoverySkills.length !== 1 ? "s" : ""}`
                        : ""}
            </Text>

            {warning && <StatusMessage type="warning" message={warning} />}
            {error && <StatusMessage type="error" message={error} />}

            {screen === "main-menu" && (
                <StartupNoticePanel
                    notices={startupNotices}
                    enabled={screen === "main-menu"}
                    onOpenAppUpdate={() => setScreen("app-update")}
                    onCheckBundleUpdates={startBundleUpdateCheck}
                />
            )}

            {screen === "main-menu" && (
                <MainMenu
                    hasBundleContents={!!bundleContents}
                    hasProjectsAccess={!!hasProjectsAccess}
                    onSelect={(action) => {
                        setProjectContext(null);
                        setResumeProjectId(null);
                        setSelectedRovoAgent(null);
                        switch (action) {
                            case "my-projects":
                                setScreen("my-projects");
                                break;
                            case "search-install":
                                setScreen("skill-install");
                                break;
                            case "maintenance":
                                setScreen("maintenance-menu");
                                break;
                            case "source-management":
                                setScreen("source-manager");
                                break;
                            case "settings":
                                setScreen("settings");
                                break;
                            case "exit":
                                process.exit(0);
                        }
                    }}
                />
            )}

            {screen === "my-projects" && apiBaseUrl && authSession && (
                <ProjectsMenu
                    apiBaseUrl={apiBaseUrl}
                    authSession={authSession}
                    hasSkills={catalogueSkills.length > 0}
                    hasRovoAgents={(bundleContents?.rovoAgents.length ?? 0) > 0}
                    initialProjectId={resumeProjectId}
                    onBack={returnToMainMenu}
                    onInstallSkills={(project) => {
                        setResumeProjectId(null);
                        setSelectedRovoAgent(null);
                        setProjectContext(project);
                        setScreen("skill-install");
                    }}
                    onProvisionAgents={(project) => {
                        setResumeProjectId(null);
                        setSelectedRovoAgent(null);
                        setProjectContext(project);
                        setScreen(featureFlags.chromeExtension ? "rovo-method" : "rovo-menu");
                    }}
                />
            )}

            {screen === "maintenance-menu" && (
                <MaintenanceMenu
                    hasBundleContents={!!bundleContents}
                    hasSource={!!source}
                    onSelect={(action) => {
                        switch (action) {
                            case "bulk-sync":
                                setScreen("scope-selector");
                                break;
                            case "skill-versions":
                                setScreen("skill-version-manager");
                                break;
                            case "manage-installed":
                                setScreen("manage-installed");
                                break;
                            case "bundle-versions":
                                setScreen("version-manager");
                                break;
                            case "update-app":
                                setScreen("app-update");
                                break;
                            case "back":
                                setScreen("main-menu");
                        }
                    }}
                    onBack={() => setScreen("main-menu")}
                />
            )}

            {screen === "skill-install" && (
                <SkillInstallFlow
                    entries={catalogueEntries}
                    bundleVersion={effectiveVersion}
                    onSelectRovoAgent={(agent) => {
                        setSelectedRovoAgent(agent);
                        setScreen(featureFlags.chromeExtension ? "rovo-method" : "rovo-menu");
                    }}
                    onBack={leaveInstallFlow}
                />
            )}

            {screen === "url-install" && directInstallSource && (
                <UrlInstallFlow
                    initialSource={directInstallSource}
                    onBack={() => setScreen("source-manager")}
                />
            )}

            {screen === "source-manager" && <SourceManager onBack={() => setScreen("main-menu")} />}

            {screen === "settings" && <SettingsScreen onBack={() => setScreen("main-menu")} />}

            {screen === "manage-installed" && (
                <ManageFlow
                    onBack={() => setScreen("maintenance-menu")}
                    getAccessToken={provideAccessToken}
                />
            )}

            {screen === "scope-selector" && (
                <ScopeSelector onSelect={handleScopeSelect} onBack={() => setScreen("maintenance-menu")} />
            )}

            {screen === "tool-selector" && (
                <ToolSelector
                    scope={installScope}
                    repoRoot={repoRoot}
                    onSelect={(toolIds) => {
                        trackTelemetryEvent({
                            action: "tool_selected",
                            properties: {
                                ...bundleTelemetryProps,
                                tool: toolIds.join(":"),
                                scope: installScope,
                            },
                        });
                        setToolsQueue(toolIds);
                        setToolsQueueTotal(toolIds.length);
                        setScreen("skill-selector");
                    }}
                    onBack={() => setScreen("scope-selector")}
                />
            )}

            {screen === "skill-selector" && effectiveContents && toolsQueue.length > 0 && (
                <SkillSelector
                    key={toolsQueue[0]}
                    toolId={toolsQueue[0]!}
                    toolProgress={
                        toolsQueueTotal > 1
                            ? { index: toolsQueueTotal - toolsQueue.length + 1, total: toolsQueueTotal }
                            : undefined
                    }
                    skills={bulkSyncSkills}
                    bundleVersion={effectiveVersion}
                    scope={installScope}
                    repoRoot={repoRoot}
                    bundleTelemetryProps={bundleTelemetryProps}
                    onBack={() => setScreen("tool-selector")}
                    onDone={() => {
                        const [, ...remaining] = toolsQueue;
                        if (remaining.length > 0) {
                            setToolsQueue(remaining);
                        } else {
                            setToolsQueue([]);
                            setScreen("maintenance-menu");
                        }
                    }}
                />
            )}

            {screen === "version-manager" && source && (
                <VersionManager
                    currentVersion={manifest?.version ?? null}
                    source={source}
                    authSession={authSession}
                    onBack={() => setScreen("maintenance-menu")}
                    onVersionChanged={handleVersionChanged}
                />
            )}

            {screen === "skill-version-manager" && <SkillVersionManager onBack={() => setScreen("maintenance-menu")} />}

            {screen === "app-update" && (
                <AppUpdateManager
                    onBack={() => setScreen("maintenance-menu")}
                    onExit={(message) => {
                        console.log(`\n  ${message}\n`);
                        process.exit(0);
                    }}
                />
            )}

            {screen === "rovo-method" && (
                <RovoMethodMenu
                    onSelect={(method) => {
                        if (method === "chrome-extension") {
                            setScreen("chrome-extension");
                        } else if (method === "install-chrome-extension") {
                            setScreen("chrome-extension-install");
                        } else {
                            setScreen("rovo-menu");
                        }
                    }}
                    onBack={() => {
                        if (projectContext && !selectedRovoAgent) {
                            leaveInstallFlow();
                            return;
                        }
                        setScreen("skill-install");
                    }}
                />
            )}

            {screen === "rovo-menu" && bundleContents && (
                <RovoMenu
                    rovoAgents={
                        selectedRovoAgent
                            ? [selectedRovoAgent]
                            : scopedAgents
                    }
                    bundleTelemetryProps={bundleTelemetryProps}
                    onBack={() => {
                        if (featureFlags.chromeExtension) {
                            setScreen("rovo-method");
                            return;
                        }
                        if (projectContext && !selectedRovoAgent) {
                            leaveInstallFlow();
                            return;
                        }
                        setScreen("skill-install");
                    }}
                />
            )}

            {screen === "chrome-extension" && bundleContents && manifest && (
                <ChromeExtensionServer
                    bundleContents={{
                        skills: scopedSkills,
                        rovoAgents: scopedAgents,
                    }}
                    manifest={manifest}
                    bundleDir={bundleDir}
                    onBack={() => setScreen("rovo-method")}
                />
            )}

            {screen === "chrome-extension" && (!bundleContents || !manifest) && (
                <Box flexDirection="column" marginLeft={2}>
                    <Text bold>Chrome Extension Bridge</Text>
                    <Text> </Text>
                    <StatusMessage
                        type="error"
                        message="Cannot start the Chrome Extension bridge: no local bundle is available for this source."
                    />
                    <Text> </Text>
                    <Text dimColor>
                        Discovery sources need an HTTP bundle that includes Rovo agents. Use &quot;Install from the command line&quot; instead, or switch to a bundle URL/directory source.
                    </Text>
                    <Text> </Text>
                    <SelectInput
                        items={[{ label: "\u2190 Back to menu", value: "back" }]}
                        onSelect={() => setScreen("rovo-method")}
                    />
                </Box>
            )}

            {screen === "chrome-extension-install" && (
                <ChromeExtensionInstall
                    onBack={() =>
                        setScreen(featureFlags.chromeExtension ? "rovo-method" : "skill-install")
                    }
                />
            )}
        </Box>
    );
}
