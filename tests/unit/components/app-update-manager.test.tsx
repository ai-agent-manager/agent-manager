import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";

type SelectItem = { value: string };

const selectState = vi.hoisted(() => ({
    items: [] as SelectItem[],
    onSelect: null as null | ((item: SelectItem) => void),
}));

vi.mock("ink-select-input", async () => {
    return {
        default: function MockSelectInput({
            items,
            onSelect,
        }: {
            items: SelectItem[];
            onSelect: (item: SelectItem) => void;
        }) {
            selectState.items = items;
            selectState.onSelect = onSelect;
            return null;
        },
    };
});

vi.mock("../../../src/lib/self-update.js", () => ({
    createSelfUpdatePlan: vi.fn(() => ({
        packageSpec: "@ai-agent-manager/cli@latest",
        command: "npm install --global @ai-agent-manager/cli@latest",
        channelLabel: "latest stable release",
    })),
    runSelfUpdate: vi.fn(),
}));

vi.mock("../../../src/telemetry.js", () => ({
    trackTelemetryEvent: vi.fn(),
    trackTelemetryError: vi.fn(),
}));

import { AppUpdateManager } from "../../../src/components/AppUpdateManager.js";
import { runSelfUpdate } from "../../../src/lib/self-update.js";

describe("AppUpdateManager", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        selectState.items = [];
        selectState.onSelect = null;
    });

    it("exits the app after a successful self-update", async () => {
        const onBack = vi.fn();
        const onExit = vi.fn();
        vi.mocked(runSelfUpdate).mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

        const { lastFrame } = render(<AppUpdateManager onBack={onBack} onExit={onExit} />);

        await vi.waitFor(() => {
            expect(lastFrame()).toContain("Update Agent Manager application");
        });

        expect(selectState.items[0]?.value).toBe("update");
        selectState.onSelect?.(selectState.items[0]!);

        await vi.waitFor(() => {
            expect(runSelfUpdate).toHaveBeenCalledTimes(1);
            expect(onExit).toHaveBeenCalledWith(
                "Agent Manager updated. Restart agentman to use the new application version.",
            );
        });
    });
});
