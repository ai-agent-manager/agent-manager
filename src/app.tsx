import { toCatalogueSkills, loadRepositoryBundle } from "./operations/catalogue.js";
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
import { setCurrentBundle } from "./bundle/cache.js";
import { acquireBundle, loadSession, loadSessionMembership, loadBundleVersion, runStartupChecks } from "./operations/session.js";
import type { BundleManifest } from "./bundle/manifest.js";
import { scanBundle, type BundleContents, type RovoAgentInfo } from "./bundle/scanner.js";
import type { BundleSource } from "./bundle/source.js";
import type { InstallScope } from "./config/scopes.js";
import type { StartupUpdateNotice } from "./lib/startup-update-checks.js";
import { getBundleSourceTelemetryProperties, trackTelemetryError, trackTelemetryEvent, type TelemetryValue } from "./telemetry.js";
import { featureFlags } from "./lib/feature-flags.js";
import { type ResolvedSkill } from "./discovery/index.js";
import {
    type RepoSkillSource,
} from "./bundle/skill-source.js";
import {
    canAccessMyProjects,
    isProjectsExclusiveSource,
    resolveApiBaseUrl,
    type Project,
} from "./api/index.js";
import {
    buildScopedCatalogue,
    resolveCatalogueScope,
    scopeCatalogueAssets,
    scopeSkills,
} from "./catalogue-scope/index.js";
import { openInBrowser, createDiscoveryAccessTokenProvider, type AuthSession } from "./auth/index.js";

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
            return openInBrowser(authorizeUrl);
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
        const controller = new AbortController();
        const active = () => !controller.signal.aborted;
        let published = false;
        const onWarning = (message: string) => { if (active()) setWarning(message); };
        void (async () => {
            try {
                const session = await loadSession({ source, directInstallSource, sourceError }, {
                    forceUpdate, signal: controller.signal, deferMembership: true,
                    onProgress: (message) => { if (active()) setLoadingMessage(message); },
                    onAuthPrompt: (url) => { if (active()) handleAuthPrompt(url); },
                    onWarning,
                });
                if (!active()) return;
                setWarning(session.warnings.length ? session.warnings.join("\n") : null);
                setManifest(session.manifest ?? null);
                setBundleContents(session.bundleContents ?? null);
                setBundleDir(session.bundleDir ?? "");
                setDiscoverySkills(session.discoverySkills ?? null);
                setDiscoveryBundleVersion(session.discoveryBundleVersion ?? null);
                setAuthSession(session.authSession ?? null);
                published = true;
                setScreen(session.directInstallSource ? "url-install" : session.source ? "main-menu" : "source-manager");

                // Preserve the TUI's responsive menu while membership loads. The
                // catalogue remains fail-closed; completion never changes screens.
                await loadSessionMembership(session, { signal: controller.signal, onWarning });
                if (!active()) return;
                setMembershipProjects(session.membership.state === "not-required" ? null : session.membership.projects);
                const result = await runStartupChecks(session);
                if (active() && result.notices.length) setStartupNotices(result.notices);
            } catch (initialiseError) {
                if (!active()) return;
                setError(initialiseError instanceof Error ? initialiseError.message : String(initialiseError));
                if (!published) setScreen("main-menu");
            }
        })();
        return () => controller.abort();
    }, []);

    const handleScopeSelect = async (scope: InstallScope, selectedRepoRoot: string | null) => {
        setInstallScope(scope);
        setRepoRoot(selectedRepoRoot);
        setRepoBundleContents(null);
        setRepoBundleVersion(null);

        if (scope === "repo" && selectedRepoRoot) {
            try {
                const pinned = await loadRepositoryBundle({
                    source, manifest: manifest ?? undefined,
                    discoverySkills: discoverySkills ?? undefined,
                    bundleContents: bundleContents ?? undefined,
                }, selectedRepoRoot);
                if (pinned) {
                    setRepoBundleContents(pinned.contents);
                    setRepoBundleVersion(pinned.version);
                }
            } catch (loadError) {
                trackTelemetryError("repo_pinned_bundle_load_failed", loadError, bundleTelemetryProps);
                setError(loadError instanceof Error ? loadError.message : String(loadError));
                setScreen("main-menu");
                return;
            }
        }

        setScreen("tool-selector");
    };

    const handleVersionChanged = (newVersion: string) => {
        (async () => {
            try {
                const loaded = await loadBundleVersion(newVersion, { source });
                setManifest(loaded.manifest);
                setBundleContents(loaded.bundleContents);
                setBundleDir(loaded.bundleDir);
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

    const catalogueSkills = toCatalogueSkills({
        source, manifest: manifest ?? undefined, discoverySkills: discoverySkills ?? undefined,
        discoveryBundleVersion: discoveryBundleVersion ?? undefined, bundleContents: bundleContents ?? undefined,
    }, { scope: installScope, repoBundle: repoBundleContents && repoBundleVersion
        ? { contents: repoBundleContents, version: repoBundleVersion } : undefined });
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
    const bulkSyncSkills = scopeSkills(catalogueSkills, catalogueScope);

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
