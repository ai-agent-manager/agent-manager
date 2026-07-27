import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "ink";

const startupNoticeState = vi.hoisted(() => ({
    props: null as null | {
        notices: Array<{ kind: "app" | "bundle" }>;
        onCheckBundleUpdates: () => void;
    },
}));

vi.mock("../../src/components/MainMenu.js", () => ({
    MainMenu: function MockMainMenu() {
        return null;
    },
}));

vi.mock("../../src/components/ScopeSelector.js", () => ({
    ScopeSelector: function MockScopeSelector() {
        return null;
    },
}));

vi.mock("../../src/components/ToolSelector.js", () => ({
    ToolSelector: function MockToolSelector() {
        return null;
    },
}));

vi.mock("../../src/components/SkillSelector.js", () => ({
    SkillSelector: function MockSkillSelector() {
        return null;
    },
}));

vi.mock("../../src/components/SkillVersionManager.js", () => ({
    SkillVersionManager: function MockSkillVersionManager() {
        return null;
    },
}));

vi.mock("../../src/components/VersionManager.js", () => ({
    VersionManager: function MockVersionManager() {
        return null;
    },
}));

vi.mock("../../src/components/AppUpdateManager.js", () => ({
    AppUpdateManager: function MockAppUpdateManager() {
        return null;
    },
}));

vi.mock("../../src/components/RovoMenu.js", () => ({
    RovoMenu: function MockRovoMenu() {
        return null;
    },
}));

vi.mock("../../src/components/Spinner.js", () => ({
    LoadingSpinner: function MockLoadingSpinner({ message }: { message: string }) {
        return <Text>{message}</Text>;
    },
}));

vi.mock("../../src/components/StatusMessage.js", () => ({
    StatusMessage: function MockStatusMessage({ message }: { message: string }) {
        return <Text>{message}</Text>;
    },
}));

vi.mock("../../src/components/StartupNoticePanel.js", () => ({
    StartupNoticePanel: function MockStartupNoticePanel(props: {
        notices: Array<{ kind: "app" | "bundle" }>;
        onCheckBundleUpdates: () => void;
    }) {
        startupNoticeState.props = props;
        return null;
    },
}));

vi.mock("../../src/bundle/downloader.js", () => ({
    downloadBundle: vi.fn(),
}));

vi.mock("../../src/bundle/extractor.js", () => ({
    extractBundle: vi.fn(),
}));

vi.mock("../../src/bundle/cache.js", () => ({
    getCurrentBundleVersion: vi.fn(),
    readConfig: vi.fn(),
    setCurrentBundle: vi.fn(),
    writeConfig: vi.fn(),
    updateConfig: vi.fn(),
}));

vi.mock("../../src/bundle/scanner.js", () => ({
    scanBundle: vi.fn(),
}));

vi.mock("../../src/lib/startup-update-checks.js", () => ({
    checkForStartupUpdates: vi.fn(),
    shouldRunStartupUpdateChecks: vi.fn(() => true),
}));

vi.mock("../../src/telemetry.js", () => ({
    getBundleSourceTelemetryProperties: vi.fn(() => ({ source: "url" })),
    setTelemetryDisabledByConfig: vi.fn(),
    trackTelemetryError: vi.fn(),
    trackTelemetryEvent: vi.fn(),
}));

import { App } from "../../src/app.js";
import { getCurrentBundleVersion, readConfig, setCurrentBundle, writeConfig, updateConfig } from "../../src/bundle/cache.js";
import { downloadBundle } from "../../src/bundle/downloader.js";
import { extractBundle } from "../../src/bundle/extractor.js";
import { scanBundle } from "../../src/bundle/scanner.js";
import { checkForStartupUpdates } from "../../src/lib/startup-update-checks.js";

describe("App", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        startupNoticeState.props = null;

        vi.mocked(readConfig).mockResolvedValue({ installations: {} });
        vi.mocked(writeConfig).mockResolvedValue(undefined);
        vi.mocked(updateConfig).mockResolvedValue({ installations: {} });
        vi.mocked(getCurrentBundleVersion).mockResolvedValue(null);

        vi.mocked(downloadBundle)
            .mockResolvedValueOnce({ zipPath: "/tmp/1.0.0.zip", version: "1.0.0", sha256: null })
            .mockResolvedValueOnce({ zipPath: "/tmp/1.1.0.zip", version: "1.1.0", sha256: null });

        vi.mocked(extractBundle)
            .mockResolvedValueOnce({
                manifest: { version: "1.0.0", published: "2026-04-01T10:00:00Z" },
                bundleDir: "/bundles/1.0.0",
                isNew: true,
            })
            .mockResolvedValueOnce({
                manifest: { version: "1.1.0", published: "2026-04-13T10:00:00Z" },
                bundleDir: "/bundles/1.1.0",
                isNew: false,
            });

        vi.mocked(scanBundle)
            .mockResolvedValueOnce({ skills: [], rovoAgents: [] })
            .mockResolvedValueOnce({ skills: [], rovoAgents: [] });

        vi.mocked(checkForStartupUpdates).mockResolvedValue({
            notices: [
                {
                    kind: "bundle",
                    message: "Bundle v1.1.0 is available (current: v1.0.0).",
                    shortcutKey: "b",
                    actionLabel: "Download and switch to the latest bundle",
                },
            ],
            errors: [],
        });
    });

    it("switches to the latest cached bundle when the startup B action is used", async () => {
        const { lastFrame } = render(
            <App source={{ type: "url", baseUrl: "https://example.com" }} forceUpdate={false} />,
        );

        await vi.waitFor(() => {
            expect(startupNoticeState.props).not.toBeNull();
            expect(startupNoticeState.props?.notices.length).toBe(1);
        });

        startupNoticeState.props?.onCheckBundleUpdates();

        await vi.waitFor(() => {
            expect(setCurrentBundle).toHaveBeenNthCalledWith(1, "1.0.0");
            expect(setCurrentBundle).toHaveBeenNthCalledWith(2, "1.1.0");
        });

        await vi.waitFor(() => {
            expect(lastFrame()).toContain("Bundle: v1.1.0");
        });
    });
});
