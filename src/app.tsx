import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { APP_VERSION } from "./app-info.js";
import { AppUpdateManager } from "./components/AppUpdateManager.js";
import { ChromeExtensionInstall } from "./components/ChromeExtensionInstall.js";
import { ChromeExtensionServer } from "./components/ChromeExtensionServer.js";
import { MainMenu } from "./components/MainMenu.js";
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
import { getCurrentBundleVersion, readConfig, setCurrentBundle, writeConfig } from "./bundle/cache.js";
import { downloadBundle } from "./bundle/downloader.js";
import { extractBundle } from "./bundle/extractor.js";
import { importLocalBundle } from "./bundle/importer.js";
import type { BundleManifest } from "./bundle/manifest.js";
import { readRepoConfig } from "./bundle/repo-config.js";
import { scanBundle, type BundleContents, type SkillInfo } from "./bundle/scanner.js";
import type { BundleSource } from "./bundle/source.js";
import { getBundleVersionDir } from "./config/paths.js";
import type { InstallScope } from "./config/scopes.js";
import type { StartupUpdateNotice } from "./lib/startup-update-checks.js";
import { checkForStartupUpdates, shouldRunStartupUpdateChecks } from "./lib/startup-update-checks.js";
import { getBundleSourceTelemetryProperties, trackTelemetryError, trackTelemetryEvent } from "./telemetry.js";
import { featureFlags } from "./lib/feature-flags.js";
import { resolveDiscoverySkills } from "./discovery/index.js";

export type Screen =
    | "loading"
    | "main-menu"
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
    source: BundleSource;
    forceUpdate: boolean;
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
 * Resolve skills from a discovery document.
 */
async function acquireDiscoverySkills(
    source: Extract<BundleSource, { type: 'discovery' }>,
    setLoadingMessage: (message: string) => void,
) {
    const warnings: string[] = [];

    setLoadingMessage("Resolving skills from discovery document...");
    const result = await resolveDiscoverySkills(
        source.discovery,
        undefined,
        setLoadingMessage,
    );

    for (const { source, error } of result.errors) {
        warnings.push(`Failed to resolve source '${source.name}': ${error}`);
    }

    return { skills: result.skills, rovoAgents: result.rovoAgents, warnings };
}

export function App({ source, forceUpdate }: AppProps) {
    const [screen, setScreen] = useState<Screen>("loading");
    const [manifest, setManifest] = useState<BundleManifest | null>(null);
    const [bundleContents, setBundleContents] = useState<BundleContents | null>(null);
    const [bundleDir, setBundleDir] = useState<string>("");
    const [selectedToolId, setSelectedToolId] = useState("");
    const [installScope, setInstallScope] = useState<InstallScope>("system");
    const [repoRoot, setRepoRoot] = useState<string | null>(null);
    const [loadingMessage, setLoadingMessage] = useState("Initializing...");
    const [error, setError] = useState<string | null>(null);
    const [warning, setWarning] = useState<string | null>(null);
    const [startupNotices, setStartupNotices] = useState<StartupUpdateNotice[]>([]);
    const [repoBundleContents, setRepoBundleContents] = useState<BundleContents | null>(null);
    const [repoBundleVersion, setRepoBundleVersion] = useState<string | null>(null);
    const [discoverySkills, setDiscoverySkills] = useState<SkillInfo[] | null>(null);

    const bundleTelemetryProps = getBundleSourceTelemetryProperties(source);

    const startBundleUpdateCheck = () => {
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

    useEffect(() => {
        (async () => {
            try {
                const config = await readConfig();
                if (source.type === "discovery" || source.type === "url") {
                    config.baseUrl = source.baseUrl;
                }
                await writeConfig(config);

                // --- Discovery source: resolve skills from discovery document ---
                if (source.type === "discovery") {
                    const { skills, rovoAgents, warnings } = await acquireDiscoverySkills(
                        source,
                        setLoadingMessage,
                    );

                    if (warnings.length > 0) {
                        setWarning(warnings.join("\n"));
                    }

                    setDiscoverySkills(skills);
                    // Wrap discovery skills and agents in a BundleContents-compatible shape
                    setBundleContents({ skills, rovoAgents });
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
        installScope === "repo" && repoBundleVersion ? repoBundleVersion : (manifest?.version ?? "unknown");

    if (screen === "loading") {
        return (
            <Box flexDirection="column">
                <LoadingSpinner message={loadingMessage} />
            </Box>
        );
    }

    return (
        <Box flexDirection="column">
            <Text dimColor>
                {manifest
                    ? `  Agent Manager: v${APP_VERSION} | Bundle: v${manifest.version} (${manifest.published.slice(0, 10)})`
                    : discoverySkills
                        ? `  Agent Manager: v${APP_VERSION} | Discovery: ${source.type === "discovery" ? new URL(source.baseUrl).hostname : "local"}`
                        : `  Agent Manager: v${APP_VERSION}`}
                {manifest && bundleContents
                    ? ` | ${bundleContents.skills.length} skill${bundleContents.skills.length !== 1 ? "s" : ""}, ${bundleContents.rovoAgents.length} rovo agent${bundleContents.rovoAgents.length !== 1 ? "s" : ""}`
                    : discoverySkills
                        ? ` | ${discoverySkills.length} skill${discoverySkills.length !== 1 ? "s" : ""}${bundleContents && bundleContents.rovoAgents.length > 0 ? `, ${bundleContents.rovoAgents.length} rovo agent${bundleContents.rovoAgents.length !== 1 ? "s" : ""}` : ""}`
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
                    hasRovoAgents={!!bundleContents && bundleContents.rovoAgents.length > 0}
                    onSelect={(action) => {
                        switch (action) {
                            case "install-skills":
                                setScreen("scope-selector");
                                break;
                            case "manage-skill-versions":
                                setScreen("skill-version-manager");
                                break;
                            case "rovo-agents":
                                setScreen(featureFlags.chromeExtension ? "rovo-method" : "rovo-menu");
                                break;
                            case "manage-versions":
                                setScreen("version-manager");
                                break;
                            case "update-app":
                                setScreen("app-update");
                                break;
                            case "exit":
                                process.exit(0);
                        }
                    }}
                />
            )}

            {screen === "scope-selector" && (
                <ScopeSelector onSelect={handleScopeSelect} onBack={() => setScreen("main-menu")} />
            )}

            {screen === "tool-selector" && (
                <ToolSelector
                    scope={installScope}
                    repoRoot={repoRoot}
                    onSelect={(toolId) => {
                        trackTelemetryEvent({
                            action: "tool_selected",
                            properties: {
                                ...bundleTelemetryProps,
                                tool: toolId,
                                scope: installScope,
                            },
                        });
                        setSelectedToolId(toolId);
                        setScreen("skill-selector");
                    }}
                    onBack={() => setScreen("scope-selector")}
                />
            )}

            {screen === "skill-selector" && effectiveContents && (
                <SkillSelector
                    toolId={selectedToolId}
                    skills={effectiveContents.skills}
                    bundleVersion={effectiveVersion}
                    scope={installScope}
                    repoRoot={repoRoot}
                    bundleTelemetryProps={bundleTelemetryProps}
                    onBack={() => setScreen("tool-selector")}
                    onDone={() => setScreen("main-menu")}
                />
            )}

            {screen === "version-manager" && (
                <VersionManager
                    currentVersion={manifest?.version ?? null}
                    source={source}
                    onBack={() => setScreen("main-menu")}
                    onVersionChanged={handleVersionChanged}
                />
            )}

            {screen === "skill-version-manager" && <SkillVersionManager onBack={() => setScreen("main-menu")} />}

            {screen === "app-update" && (
                <AppUpdateManager
                    onBack={() => setScreen("main-menu")}
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
                    onBack={() => setScreen("main-menu")}
                />
            )}

            {screen === "rovo-menu" && bundleContents && (
                <RovoMenu
                    rovoAgents={bundleContents.rovoAgents}
                    bundleTelemetryProps={bundleTelemetryProps}
                    onBack={() => setScreen(featureFlags.chromeExtension ? "rovo-method" : "main-menu")}
                />
            )}

            {screen === "chrome-extension" && bundleContents && manifest && (
                <ChromeExtensionServer
                    bundleContents={bundleContents}
                    manifest={manifest}
                    bundleDir={bundleDir}
                    onBack={() => setScreen("rovo-method")}
                />
            )}

            {screen === "chrome-extension-install" && (
                <ChromeExtensionInstall onBack={() => setScreen(featureFlags.chromeExtension ? "rovo-method" : "main-menu")} />
            )}
        </Box>
    );
}
