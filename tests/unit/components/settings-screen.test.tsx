import React from "react";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
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

// Keep the real resolveTelemetryMode so the label logic is exercised; mock only
// the function that mutates the process-wide client.
vi.mock("../../../src/telemetry.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../src/telemetry.js")>();
    return {
        ...actual,
        setTelemetryDisabledByConfig: vi.fn(),
    };
});

const { SettingsScreen } = await import("../../../src/components/SettingsScreen.js");
const { updateConfig } = await import("../../../src/bundle/cache.js");
const { setTelemetryDisabledByConfig } = await import("../../../src/telemetry.js");

/** Telemetry block as declared in the active source's discovery file. */
const discoveryTelemetry = { url: "https://telemetry.example.com", siteId: "acme-skills" };

// Env vars that would change the resolved telemetry mode; stubbed so the
// component tests are deterministic (in particular under CI, where CI is set).
const TELEMETRY_ENV_VARS = [
    "CI",
    "GITHUB_ACTIONS",
    "BUILD_BUILDID",
    "TF_BUILD",
    "JENKINS_URL",
    "TEAMCITY_VERSION",
    "DISABLE_TELEMETRY",
    "DO_NOT_TRACK",
    "AGENTMAN_TELEMETRY_DISABLED",
    "AGENTMAN_TELEMETRY_URL",
    "AGENTMAN_TELEMETRY_ENDPOINT",
    "AGENTMAN_TELEMETRY_SITE_ID",
];

const originalStdinTTY = process.stdin.isTTY;
const originalStdoutTTY = process.stdout.isTTY;

function setTty(stdin: boolean, stdout: boolean): void {
    Object.defineProperty(process.stdin, "isTTY", { value: stdin, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: stdout, configurable: true });
}

afterAll(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: originalStdinTTY, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: originalStdoutTTY, configurable: true });
});

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
    vi.unstubAllEnvs();
    for (const key of TELEMETRY_ENV_VARS) {
        vi.stubEnv(key, undefined);
    }
    setTty(true, true);
    delete persisted.startupUpdateChecksDisabled;
    delete persisted.telemetryDisabled;
});

describe("SettingsScreen", () => {
    it("shows both settings loaded and telemetry not configured when the active source has no discovery telemetry", async () => {
        // Issue #95: the active source does not explicitly enable telemetry, so
        // the mode must report off rather than the old hard-coded "enabled".
        const { lastFrame } = render(<SettingsScreen onBack={() => {}} />);
        await vi.waitFor(() => {
            expect(lastFrame()).toContain("Startup update checks");
        });
        const frame = lastFrame()!;
        expect(frame).toContain("Startup update checks   enabled");
        expect(frame).toContain("Telemetry               not configured");
    });

    it("shows telemetry enabled when the active source's discovery file enables it", async () => {
        const { lastFrame } = render(<SettingsScreen onBack={() => {}} discoveryTelemetry={discoveryTelemetry} />);
        await vi.waitFor(() => {
            expect(lastFrame()).toContain("Telemetry               enabled");
        });
    });

    it("shows telemetry enabled from env vars alone", async () => {
        vi.stubEnv("AGENTMAN_TELEMETRY_URL", "https://example.com/metrics");
        vi.stubEnv("AGENTMAN_TELEMETRY_SITE_ID", "42");
        const { lastFrame } = render(<SettingsScreen onBack={() => {}} />);
        await vi.waitFor(() => {
            expect(lastFrame()).toContain("Telemetry               enabled");
        });
    });

    it("shows telemetry disabled when the active source enables it but the run is non-interactive", async () => {
        setTty(true, false);
        const { lastFrame } = render(<SettingsScreen onBack={() => {}} discoveryTelemetry={discoveryTelemetry} />);
        await vi.waitFor(() => {
            expect(lastFrame()).toContain("Telemetry               disabled");
        });
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
        const { lastFrame, stdin } = render(<SettingsScreen onBack={() => {}} discoveryTelemetry={discoveryTelemetry} />);
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

    it("respects a persisted telemetry opt-out on load", async () => {
        persisted.telemetryDisabled = true;
        const { lastFrame } = render(<SettingsScreen onBack={() => {}} discoveryTelemetry={discoveryTelemetry} />);
        await vi.waitFor(() => {
            expect(lastFrame()).toContain("Telemetry               disabled");
        });
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
