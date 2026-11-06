import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";

// The process-wide telemetry client is created when telemetry.js is first
// imported, so fetch and the environment must be stubbed before the dynamic
// import in the test. This file is therefore kept separate from
// telemetry.test.ts, which imports the module statically at the top.

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

const fetchMock = vi.fn().mockResolvedValue({ ok: true });
const originalStdinTTY = process.stdin.isTTY;
const originalStdoutTTY = process.stdout.isTTY;

describe("applyActiveSourceTelemetry (process-wide client)", () => {
    beforeAll(async () => {
        // Interactive, non-CI environment with no telemetry env vars, so the
        // resolved mode depends only on the discovery telemetry block.
        for (const key of TELEMETRY_ENV_VARS) {
            vi.stubEnv(key, undefined);
        }
        Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
        Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
        vi.stubGlobal("fetch", fetchMock);
    });

    afterAll(() => {
        Object.defineProperty(process.stdin, "isTTY", { value: originalStdinTTY, configurable: true });
        Object.defineProperty(process.stdout, "isTTY", { value: originalStdoutTTY, configurable: true });
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it("sends nothing until the active source's discovery telemetry has been applied", async () => {
        const telemetry = await import("../../../src/telemetry.js");

        telemetry.trackTelemetryEvent({ action: "agentman_started" });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(fetchMock).not.toHaveBeenCalled();

        telemetry.applyActiveSourceTelemetry({ url: "https://telemetry.example.com", siteId: "13" });

        telemetry.trackTelemetryEvent({ action: "agentman_started" });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [endpoint, options] = fetchMock.mock.calls[0];
        expect(endpoint).toBe("https://telemetry.example.com/matomo.php");
        expect(new URLSearchParams(options.body as string).get("idsite")).toBe("13");
    });
});
