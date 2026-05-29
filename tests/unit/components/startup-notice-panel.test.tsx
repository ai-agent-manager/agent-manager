import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";

const inputState = vi.hoisted(() => ({
    handler: null as null | ((input: string) => void),
}));

vi.mock("ink", async () => {
    const actual = await vi.importActual<typeof import("ink")>("ink");

    return {
        ...actual,
        useInput: (handler: (input: string) => void) => {
            inputState.handler = handler;
        },
    };
});

import { StartupNoticePanel } from "../../../src/components/StartupNoticePanel.js";

describe("StartupNoticePanel", () => {
    beforeEach(() => {
        inputState.handler = null;
    });

    it("renders a bordered update section with shortcut hints", () => {
        const { lastFrame } = render(
            <StartupNoticePanel
                notices={[
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
                ]}
                enabled={true}
                onOpenAppUpdate={vi.fn()}
                onCheckBundleUpdates={vi.fn()}
            />,
        );

        expect(lastFrame()).toContain("Updates Available");
        expect(lastFrame()).toContain("Agent Manager v1.0.0 is available");
        expect(lastFrame()).toContain("Press U to open the app updater.");
        expect(lastFrame()).toContain("Press B to download and switch to the latest bundle.");
    });

    it("triggers the app update shortcut when U is pressed", () => {
        const onOpenAppUpdate = vi.fn();

        render(
            <StartupNoticePanel
                notices={[
                    {
                        kind: "app",
                        message: "Agent Manager v1.0.0 is available (current: v0.9.0).",
                        shortcutKey: "u",
                        actionLabel: "Open the app updater",
                    },
                ]}
                enabled={true}
                onOpenAppUpdate={onOpenAppUpdate}
                onCheckBundleUpdates={vi.fn()}
            />,
        );

        inputState.handler?.("u");

        expect(onOpenAppUpdate).toHaveBeenCalledTimes(1);
    });

    it("triggers the bundle update shortcut when B is pressed", () => {
        const onCheckBundleUpdates = vi.fn();

        render(
            <StartupNoticePanel
                notices={[
                    {
                        kind: "bundle",
                        message: "Bundle v1.1.0 is available (current: v1.0.0).",
                        shortcutKey: "b",
                        actionLabel: "Download and switch to the latest bundle",
                    },
                ]}
                enabled={true}
                onOpenAppUpdate={vi.fn()}
                onCheckBundleUpdates={onCheckBundleUpdates}
            />,
        );

        inputState.handler?.("b");

        expect(onCheckBundleUpdates).toHaveBeenCalledTimes(1);
    });
});
