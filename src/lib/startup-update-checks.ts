import { APP_VERSION } from "../app-info.js";
import type { AgentmanConfig } from "../bundle/cache.js";
import { fetchIndex, getLatestVersion, type AgentsIndex } from "../bundle/downloader.js";
import type { BundleSource } from "../bundle/source.js";
import { checkForAppUpdate, compareVersions, type AppUpdateCheckResult } from "./self-update.js";

export interface StartupUpdateNotice {
    kind: "app" | "bundle";
    message: string;
    shortcutKey: "u" | "b";
    actionLabel: string;
}

export interface StartupUpdateCheckError {
    kind: "app" | "bundle";
    error: unknown;
}

export interface StartupUpdateCheckResult {
    notices: StartupUpdateNotice[];
    errors: StartupUpdateCheckError[];
}

interface StartupUpdateCheckOptions {
    source: BundleSource;
    currentBundleVersion: string;
    currentAppVersion?: string;
    appUpdateChecker?: (appVersion?: string) => Promise<AppUpdateCheckResult>;
    bundleIndexFetcher?: (baseUrl: string) => Promise<AgentsIndex>;
}

function hasTruthyFlag(value: string | undefined): boolean {
    return /^(1|true|yes|on)$/i.test(value ?? "");
}

export function shouldRunStartupUpdateChecks(
    config: Pick<AgentmanConfig, "startupUpdateChecksDisabled"> | null | undefined,
    env: NodeJS.ProcessEnv = process.env,
): boolean {
    if (config?.startupUpdateChecksDisabled) {
        return false;
    }

    if (hasTruthyFlag(env.AGENTMAN_DISABLE_STARTUP_UPDATE_CHECKS)) {
        return false;
    }

    return true;
}

export async function checkForStartupUpdates({
    source,
    currentBundleVersion,
    currentAppVersion = APP_VERSION,
    appUpdateChecker = checkForAppUpdate,
    bundleIndexFetcher = fetchIndex,
}: StartupUpdateCheckOptions): Promise<StartupUpdateCheckResult> {
    const notices: StartupUpdateNotice[] = [];
    const errors: StartupUpdateCheckError[] = [];

    const checks: Array<Promise<void>> = [
        (async () => {
            try {
                const appUpdate = await appUpdateChecker(currentAppVersion);
                if (appUpdate.updateAvailable) {
                    notices.push({
                        kind: "app",
                        message: `Agent Manager v${appUpdate.latestVersion} is available (current: v${appUpdate.currentVersion}).`,
                        shortcutKey: "u",
                        actionLabel: "Open the app updater",
                    });
                }
            } catch (error) {
                errors.push({ kind: "app", error });
            }
        })(),
    ];

    if (source.type === "url") {
        checks.push(
            (async () => {
                try {
                    const index = await bundleIndexFetcher(source.baseUrl);
                    const latestBundleVersion = getLatestVersion(index);
                    if (compareVersions(latestBundleVersion, currentBundleVersion) > 0) {
                        notices.push({
                            kind: "bundle",
                            message: `Bundle v${latestBundleVersion} is available (current: v${currentBundleVersion}).`,
                            shortcutKey: "b",
                            actionLabel: "Download and switch to the latest bundle",
                        });
                    }
                } catch (error) {
                    errors.push({ kind: "bundle", error });
                }
            })(),
        );
    }

    await Promise.all(checks);

    return { notices, errors };
}
