import { describe, expect, it, vi } from "vitest";
import { checkForStartupUpdates, shouldRunStartupUpdateChecks } from "../../../src/lib/startup-update-checks.js";

describe("checkForStartupUpdates", () => {
    it("returns notices for newer app and bundle versions", async () => {
        const result = await checkForStartupUpdates({
            source: { type: "url", baseUrl: "https://example.com" },
            currentBundleVersion: "1.0.0",
            currentAppVersion: "0.9.0",
            appUpdateChecker: vi.fn().mockResolvedValue({
                currentVersion: "0.9.0",
                latestVersion: "1.0.0",
                updateAvailable: true,
                channelLabel: "latest stable release",
            }),
            bundleIndexFetcher: vi.fn().mockResolvedValue({
                lastUpdated: "2026-04-13T10:00:00Z",
                agents: [
                    { version: "0.9.0", published: "2026-04-01T10:00:00Z" },
                    { version: "1.1.0", published: "2026-04-13T10:00:00Z" },
                ],
            }),
        });

        expect(result.errors).toEqual([]);
        expect(result.notices).toEqual([
            {
                kind: "app",
                message: "Agent Manager v1.0.0 is available (current: v0.9.0).",
                shortcutKey: "u",
                actionLabel: "Open the app updater",
            },
            {
                kind: "bundle",
                message: "Bundle v1.1.0 is available (current: v1.0.0).",
                shortcutKey: "b",
                actionLabel: "Download and switch to the latest bundle",
            },
        ]);
    });

    it("skips bundle checks for local directory sources", async () => {
        const bundleIndexFetcher = vi.fn();

        const result = await checkForStartupUpdates({
            source: { type: "directory", dirPath: "/tmp/bundle" },
            currentBundleVersion: "1.0.0",
            appUpdateChecker: vi.fn().mockResolvedValue({
                currentVersion: "1.0.0",
                latestVersion: "1.0.0",
                updateAvailable: false,
                channelLabel: "latest stable release",
            }),
            bundleIndexFetcher,
        });

        expect(bundleIndexFetcher).not.toHaveBeenCalled();
        expect(result.notices).toEqual([]);
        expect(result.errors).toEqual([]);
    });

    it("captures app and bundle check failures without throwing", async () => {
        const result = await checkForStartupUpdates({
            source: { type: "url", baseUrl: "https://example.com" },
            currentBundleVersion: "1.0.0",
            appUpdateChecker: vi.fn().mockRejectedValue(new Error("app lookup failed")),
            bundleIndexFetcher: vi.fn().mockRejectedValue(new Error("bundle lookup failed")),
        });

        expect(result.notices).toEqual([]);
        expect(result.errors).toHaveLength(2);
        expect(result.errors[0]?.kind).toBe("app");
        expect(result.errors[1]?.kind).toBe("bundle");
    });

    it("allows startup update checks by default", () => {
        expect(shouldRunStartupUpdateChecks(undefined, {})).toBe(true);
    });

    it("disables startup update checks when the config flag is set", () => {
        expect(shouldRunStartupUpdateChecks({ startupUpdateChecksDisabled: true }, {})).toBe(false);
    });

    it("disables startup update checks when the environment flag is set", () => {
        expect(shouldRunStartupUpdateChecks(undefined, { AGENTMAN_DISABLE_STARTUP_UPDATE_CHECKS: "1" })).toBe(false);
    });
});
