import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";

const ESC = String.fromCharCode(27);
const DOWN = `${ESC}[B`;
const ENTER = "\r";

interface PersistedConfig {
    installations: Record<string, unknown>;
    startupUpdateChecksDisabled?: boolean;
    telemetryDisabled?: boolean;
}

const persisted: PersistedConfig = { installations: {} };

vi.mock("../../../src/bundle/cache.js", () => ({
    readConfig: vi.fn(async () => ({ ...persisted })),
    updateConfig: vi.fn(async (mutate: (c: PersistedConfig) => void) => {
        mutate(persisted);
        return persisted;
    }),
}));

vi.mock("../../../src/telemetry.js", () => ({
    setTelemetryDisabledByConfig: vi.fn(),
}));

const { SettingsScreen } = await import("../../../src/components/SettingsScreen.js");
const { updateConfig } = await import("../../../src/bundle/cache.js");
const { setTelemetryDisabledByConfig } = await import("../../../src/telemetry.js");

async function flushInkInput(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
}

type Stdin = { write: (input: string) => void };

async function press(stdin: Stdin, input: string): Promise<void> {
    stdin.write(input);
    await flushInkInput();
}

beforeEach(() => {
    vi.clearAllMocks();
    delete persisted.startupUpdateChecksDisabled;
    delete persisted.telemetryDisabled;
});

describe("SettingsScreen", () => {
    it("shows both settings as enabled by default after loading", async () => {
        const { lastFrame } = render(<SettingsScreen onBack={() => {}} />);
        await vi.waitFor(() => {
            expect(lastFrame()).toContain("Startup update checks");
        });
        const frame = lastFrame()!;
        expect(frame).toContain("Startup update checks   enabled");
        expect(frame).toContain("Telemetry               enabled");
    });

    it("persists a startup-update-checks toggle to config", async () => {
        const { lastFrame, stdin } = render(<SettingsScreen onBack={() => {}} />);
        await vi.waitFor(() => {
            expect(lastFrame()).toContain("Startup update checks   enabled");
        });
        await flushInkInput();

        await press(stdin, ENTER);
        await vi.waitFor(() => {
            expect(lastFrame()).toContain("Startup update checks   disabled");
        });

        expect(updateConfig).toHaveBeenCalled();
        expect(persisted.startupUpdateChecksDisabled).toBe(true);
    });

    it("persists a telemetry toggle and applies it in-session", async () => {
        const { lastFrame, stdin } = render(<SettingsScreen onBack={() => {}} />);
        await vi.waitFor(() => {
            expect(lastFrame()).toContain("Telemetry               enabled");
        });
        await flushInkInput();

        await press(stdin, DOWN);
        await press(stdin, ENTER);
        await vi.waitFor(() => {
            expect(lastFrame()).toContain("Telemetry               disabled");
        });

        expect(persisted.telemetryDisabled).toBe(true);
        expect(setTelemetryDisabledByConfig).toHaveBeenCalledWith(true);
    });

    it("goes back on Escape", async () => {
        const onBack = vi.fn();
        const { lastFrame, stdin } = render(<SettingsScreen onBack={onBack} />);
        await vi.waitFor(() => {
            expect(lastFrame()).toContain("Startup update checks");
        });
        await flushInkInput();

        await press(stdin, ESC);
        await vi.waitFor(() => {
            expect(onBack).toHaveBeenCalled();
        });
    });
});
