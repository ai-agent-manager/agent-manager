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

const mainMenuState = vi.hoisted(() => ({
    props: null as null | { onSelect: (action: string) => void },
}));

const maintenanceMenuState = vi.hoisted(() => ({
    props: null as null | { onSelect: (action: string) => void },
}));

const scopeSelectorState = vi.hoisted(() => ({
    props: null as null | { onSelect: (scope: string, repoRoot: string | null) => void },
}));

const toolSelectorState = vi.hoisted(() => ({
    props: null as null | { onSelect: (toolIds: string[]) => void },
}));

const skillSelectorState = vi.hoisted(() => ({
    props: null as null | { toolId: string; onDone: () => void },
    mountEvents: [] as string[],
}));

const manageFlowState = vi.hoisted(() => ({
    props: null as null | {
        getAccessToken?: (
            contentUrl: string,
            options: { onAuthPrompt: (url: string) => void; signal: AbortSignal },
        ) => Promise<string | undefined>;
    },
}));

const urlInstallFlowState = vi.hoisted(() => ({
    initialSource: null as null | {
        type: "repo";
        repoUrl: string;
    },
}));

vi.mock("../../src/components/MainMenu.js", () => ({
    MainMenu: function MockMainMenu(props: { onSelect: (action: string) => void }) {
        mainMenuState.props = props;
        return null;
    },
}));

vi.mock("../../src/components/MaintenanceMenu.js", () => ({
    MaintenanceMenu: function MockMaintenanceMenu(props: { onSelect: (action: string) => void }) {
        maintenanceMenuState.props = props;
        return null;
    },
}));

vi.mock("../../src/components/ScopeSelector.js", () => ({
    ScopeSelector: function MockScopeSelector(props: { onSelect: (scope: string, repoRoot: string | null) => void }) {
        scopeSelectorState.props = props;
        return null;
    },
}));

vi.mock("../../src/components/ToolSelector.js", () => ({
    ToolSelector: function MockToolSelector(props: { onSelect: (toolIds: string[]) => void }) {
        toolSelectorState.props = props;
        return null;
    },
}));

vi.mock("../../src/components/SkillSelector.js", () => ({
    SkillSelector: function MockSkillSelector(props: { toolId: string; onDone: () => void }) {
        // Lazy initialiser only re-runs when React mounts a *new* instance (e.g.
        // when the `key` prop changes). If the parent reuses the same instance
        // across tools, `mountedForTool` keeps the first tool's value even
        // though `toolId` has moved on.
        const [mountedForTool] = React.useState(() => {
            skillSelectorState.mountEvents.push(props.toolId);
            return props.toolId;
        });
        skillSelectorState.props = props;
        return React.createElement(
            Text,
            null,
            `SkillSelector active=${props.toolId} mountedFor=${mountedForTool}`,
        );
    },
}));

vi.mock("../../src/components/ManageFlow.js", () => ({
    ManageFlow: function MockManageFlow(props: {
        getAccessToken?: (contentUrl: string) => Promise<string | undefined>;
    }) {
        manageFlowState.props = props;
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

vi.mock("../../src/components/SourceManager.js", () => ({
    SourceManager: function MockSourceManager() {
        return <Text>Source Manager Screen</Text>;
    },
}));

vi.mock("../../src/components/UrlInstallFlow.js", () => ({
    UrlInstallFlow: function MockUrlInstallFlow(props: {
        initialSource?: { type: "repo"; repoUrl: string };
    }) {
        urlInstallFlowState.initialSource = props.initialSource ?? null;
        return <Text>URL Install Flow</Text>;
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

vi.mock("../../src/bundle/downloader.js", async () => {
    const actual = await vi.importActual<typeof import("../../src/bundle/downloader.js")>(
        "../../src/bundle/downloader.js",
    );
    return {
        ...actual,
        downloadBundle: vi.fn(),
    };
});

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

// Mock flow.js (not the barrel): both App and createDiscoveryAccessTokenProvider
// import authenticate from it, and the barrel re-exports the mock consistently.
vi.mock("../../src/auth/flow.js", () => {
    class AuthFlowError extends Error {}
    class AuthCancelledError extends AuthFlowError {}
    return {
        authenticate: vi.fn(),
        openInBrowser: vi.fn(),
        AuthFlowError,
        AuthCancelledError,
    };
});

vi.mock("../../src/discovery/index.js", async () => {
    const actual = await vi.importActual<typeof import("../../src/discovery/index.js")>(
        "../../src/discovery/index.js",
    );
    return {
        ...actual,
        resolveDiscoverySkills: vi.fn(),
    };
});

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
import { authenticate } from "../../src/auth/index.js";
import { resolveDiscoverySkills } from "../../src/discovery/index.js";

describe("App", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        startupNoticeState.props = null;
        mainMenuState.props = null;
        maintenanceMenuState.props = null;
        scopeSelectorState.props = null;
        toolSelectorState.props = null;
        skillSelectorState.props = null;
        skillSelectorState.mountEvents = [];
        manageFlowState.props = null;
        urlInstallFlowState.initialSource = null;

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
        vi.mocked(authenticate).mockResolvedValue({
            bearerToken: "discovery-token",
            fromCache: true,
        });
        vi.mocked(resolveDiscoverySkills).mockResolvedValue({
            skills: [],
            rovoAgents: [],
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

    it("mounts a fresh SkillSelector instance per tool during bulk sync (regression: stale state across tools)", async () => {
        const { lastFrame } = render(
            <App source={{ type: "url", baseUrl: "https://example.com" }} forceUpdate={false} />,
        );

        await vi.waitFor(() => {
            expect(mainMenuState.props).not.toBeNull();
        });

        mainMenuState.props?.onSelect("maintenance");

        await vi.waitFor(() => {
            expect(maintenanceMenuState.props).not.toBeNull();
        });

        maintenanceMenuState.props?.onSelect("bulk-sync");

        await vi.waitFor(() => {
            expect(scopeSelectorState.props).not.toBeNull();
        });

        scopeSelectorState.props?.onSelect("system", null);

        await vi.waitFor(() => {
            expect(toolSelectorState.props).not.toBeNull();
        });

        toolSelectorState.props?.onSelect(["tool-a", "tool-b"]);

        await vi.waitFor(() => {
            expect(skillSelectorState.props?.toolId).toBe("tool-a");
        });

        expect(skillSelectorState.mountEvents).toEqual(["tool-a"]);
        expect(lastFrame()).toContain("active=tool-a mountedFor=tool-a");

        skillSelectorState.props?.onDone();

        await vi.waitFor(() => {
            expect(skillSelectorState.props?.toolId).toBe("tool-b");
        });

        // A fresh instance must mount for the second tool. Without `key={toolsQueue[0]}`
        // on <SkillSelector>, React reuses the prior instance and `mountedFor` would
        // still read "tool-a" even though the `toolId` prop moved on to "tool-b".
        expect(skillSelectorState.mountEvents).toEqual(["tool-a", "tool-b"]);
        expect(lastFrame()).toContain("active=tool-b mountedFor=tool-b");
    });

    it("supplies the discovery token to managed updates only for listed content origins", async () => {
        render(
            <App
                source={{
                    type: "discovery",
                    baseUrl: "https://discovery.example.com",
                    discovery: {
                        version: "1",
                        auth: {
                            required: true,
                            oidcDiscoveryUrl: "https://identity.example.com/.well-known/openid-configuration",
                            clientId: "agentman",
                        },
                        sources: [
                            {
                                name: "protected-artefact",
                                type: "artefact",
                                url: "https://cdn.example.com/skills/tool.zip",
                            },
                        ],
                    },
                }}
                forceUpdate={false}
            />,
        );

        await vi.waitFor(() => {
            expect(mainMenuState.props).not.toBeNull();
        });
        mainMenuState.props?.onSelect("maintenance");
        await vi.waitFor(() => {
            expect(maintenanceMenuState.props).not.toBeNull();
        });

        // Startup already authenticated for the auth-required discovery source;
        // entering Manage Installed must not add to that count (auth is lazy now).
        const callsAfterStartup = vi.mocked(authenticate).mock.calls.length;

        maintenanceMenuState.props?.onSelect("manage-installed");
        await vi.waitFor(() => {
            expect(manageFlowState.props?.getAccessToken).toBeDefined();
        });
        expect(vi.mocked(authenticate).mock.calls.length).toBe(callsAfterStartup);

        const interactiveOptions = () => ({
            onAuthPrompt: () => {},
            signal: new AbortController().signal,
        });

        // The token is requested at the operation boundary — authenticate runs
        // now, freshly validating/refreshing via its own cache logic.
        await expect(
            manageFlowState.props?.getAccessToken?.(
                "https://cdn.example.com/skills/tool.zip",
                interactiveOptions(),
            ),
        ).resolves.toBe("discovery-token");
        expect(vi.mocked(authenticate).mock.calls.length).toBe(callsAfterStartup + 1);

        // Foreign origins are rejected before authentication — never a prompt.
        await expect(
            manageFlowState.props?.getAccessToken?.(
                "https://unlisted.example.com/tool.zip",
                interactiveOptions(),
            ),
        ).resolves.toBeUndefined();
        expect(vi.mocked(authenticate).mock.calls.length).toBe(callsAfterStartup + 1);
    });

    it("opens Source Management directly when no source is configured", async () => {
        const { lastFrame } = render(<App source={undefined} forceUpdate={false} />);

        await vi.waitFor(() => {
            expect(lastFrame()).toContain("Source Manager Screen");
        });

        expect(downloadBundle).not.toHaveBeenCalled();
        expect(scanBundle).not.toHaveBeenCalled();
    });

    it("opens the URL install flow for a direct GitHub repository source", async () => {
        const directInstallSource = {
            type: "repo" as const,
            repoUrl: "https://github.com/example-org/example-repo",
            defaultBranch: "main",
            ref: "main",
            installLayout: "namespaced" as const,
        };
        const { lastFrame } = render(
            <App
                source={undefined}
                directInstallSource={directInstallSource}
                forceUpdate={false}
            />,
        );

        await vi.waitFor(() => {
            expect(lastFrame()).toContain("URL Install Flow");
        });
        expect(urlInstallFlowState.initialSource).toEqual(directInstallSource);
    });

    it("opens Source Management with the failure reason when all configured sources fail to resolve", async () => {
        const { lastFrame } = render(
            <App source={undefined} forceUpdate={false} sourceError="None of the configured sources could be resolved: ..." />,
        );

        await vi.waitFor(() => {
            expect(lastFrame()).toContain("Source Manager Screen");
            expect(lastFrame()).toContain("Could not resolve any configured source");
            expect(lastFrame()).toContain("None of the configured sources could be resolved");
        });

        expect(downloadBundle).not.toHaveBeenCalled();
        expect(scanBundle).not.toHaveBeenCalled();
    });
});
