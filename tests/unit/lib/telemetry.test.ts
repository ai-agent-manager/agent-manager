import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
    buildTelemetryEndpoint,
    categoriseError,
    createTelemetryClient,
    getBundleEndpointTelemetryValue,
    getBundleSourceTelemetryProperties,
    resolveTelemetrySettings,
    setTelemetryDisabledByConfig,
    shouldDisableTelemetry,
} from "../../../src/telemetry.js";

describe("shouldDisableTelemetry", () => {
    it("disables telemetry when the user opts out explicitly", () => {
        expect(shouldDisableTelemetry({ DISABLE_TELEMETRY: "1" }, { stdinIsTTY: true, stdoutIsTTY: true })).toBe(true);
    });

    it("disables telemetry in CI environments", () => {
        expect(shouldDisableTelemetry({ CI: "true" }, { stdinIsTTY: true, stdoutIsTTY: true })).toBe(true);
    });

    it("disables telemetry when the CLI is not interactive", () => {
        expect(shouldDisableTelemetry({}, { stdinIsTTY: true, stdoutIsTTY: false })).toBe(true);
    });

    it("leaves telemetry enabled for interactive local runs", () => {
        expect(shouldDisableTelemetry({}, { stdinIsTTY: true, stdoutIsTTY: true })).toBe(false);
    });
});

describe("buildTelemetryEndpoint", () => {
    it("appends matomo.php to a base URL", () => {
        expect(buildTelemetryEndpoint("https://example.com/telemetry")).toBe(
            "https://example.com/telemetry/matomo.php",
        );
    });

    it("preserves a fully qualified endpoint", () => {
        expect(buildTelemetryEndpoint("https://example.com/custom/matomo.php")).toBe(
            "https://example.com/custom/matomo.php",
        );
    });
});

describe("bundle source telemetry helpers", () => {
    it("normalises remote bundle endpoint values", () => {
        expect(getBundleEndpointTelemetryValue("https://example.com/skills///")).toBe("https://example.com/skills");
    });

    it("returns url bundle telemetry properties for remote sources", () => {
        expect(getBundleSourceTelemetryProperties({ type: "url", baseUrl: "https://example.com/skills/" })).toEqual({
            source: "url",
            bundleEndpoint: "https://example.com/skills",
        });
    });

    it("uses a fixed token for local directory sources", () => {
        expect(getBundleSourceTelemetryProperties({ type: "directory", dirPath: "/tmp/example" })).toEqual({
            source: "directory",
            bundleEndpoint: "local-directory",
        });
    });
});

describe("resolveTelemetrySettings", () => {
    it("disables telemetry when no URL is configured", () => {
        expect(resolveTelemetrySettings({}, { stdinIsTTY: true, stdoutIsTTY: true })).toMatchObject({
            enabled: false,
        });
    });

    it("disables telemetry when a URL is set but no site ID", () => {
        expect(
            resolveTelemetrySettings(
                { AGENTMAN_TELEMETRY_URL: "https://example.com/metrics" },
                { stdinIsTTY: true, stdoutIsTTY: true },
            ),
        ).toMatchObject({ enabled: false });
    });

    it("enables telemetry when a URL and site ID are configured", () => {
        expect(
            resolveTelemetrySettings(
                { AGENTMAN_TELEMETRY_URL: "https://example.com/metrics", AGENTMAN_TELEMETRY_SITE_ID: "42" },
                { stdinIsTTY: true, stdoutIsTTY: true },
            ),
        ).toMatchObject({
            enabled: true,
            endpoint: "https://example.com/metrics/matomo.php",
            siteId: "42",
        });
    });

    it("uses environment overrides when present", () => {
        expect(
            resolveTelemetrySettings(
                {
                    AGENTMAN_TELEMETRY_URL: "https://example.com/metrics",
                    AGENTMAN_TELEMETRY_SITE_ID: "99",
                    AGENTMAN_TELEMETRY_TIMEOUT_MS: "2500",
                },
                { stdinIsTTY: true, stdoutIsTTY: true },
            ),
        ).toMatchObject({
            endpoint: "https://example.com/metrics/matomo.php",
            siteId: "99",
            timeoutMs: 2500,
        });
    });

    it("enables telemetry from discovery config when no env vars are set", () => {
        expect(
            resolveTelemetrySettings(
                {},
                { stdinIsTTY: true, stdoutIsTTY: true },
                { url: "https://telemetry.example.com", siteId: "discovery-site" },
            ),
        ).toMatchObject({
            enabled: true,
            endpoint: "https://telemetry.example.com/matomo.php",
            siteId: "discovery-site",
        });
    });

    it("prefers env vars over discovery config for URL", () => {
        expect(
            resolveTelemetrySettings(
                {
                    AGENTMAN_TELEMETRY_URL: "https://override.example.com",
                    AGENTMAN_TELEMETRY_SITE_ID: "env-site",
                },
                { stdinIsTTY: true, stdoutIsTTY: true },
                { url: "https://telemetry.example.com", siteId: "discovery-site" },
            ),
        ).toMatchObject({
            enabled: true,
            endpoint: "https://override.example.com/matomo.php",
            siteId: "env-site",
        });
    });

    it("prefers env var site ID over discovery config", () => {
        expect(
            resolveTelemetrySettings(
                { AGENTMAN_TELEMETRY_SITE_ID: "env-site" },
                { stdinIsTTY: true, stdoutIsTTY: true },
                { url: "https://telemetry.example.com", siteId: "discovery-site" },
            ),
        ).toMatchObject({
            enabled: true,
            siteId: "env-site",
        });
    });

    it("prefers env var URL over discovery config URL", () => {
        expect(
            resolveTelemetrySettings(
                { AGENTMAN_TELEMETRY_URL: "https://override.example.com" },
                { stdinIsTTY: true, stdoutIsTTY: true },
                { url: "https://telemetry.example.com", siteId: "discovery-site" },
            ),
        ).toMatchObject({
            enabled: true,
            endpoint: "https://override.example.com/matomo.php",
            siteId: "discovery-site",
        });
    });

    it("still disables telemetry from discovery config when opt-out env var is set", () => {
        expect(
            resolveTelemetrySettings(
                { AGENTMAN_TELEMETRY_DISABLED: "1" },
                { stdinIsTTY: true, stdoutIsTTY: true },
                { url: "https://telemetry.example.com", siteId: "discovery-site" },
            ),
        ).toMatchObject({ enabled: false });
    });
});

describe("categoriseError", () => {
    it("classifies network-style failures", () => {
        expect(categoriseError(new Error("Failed to fetch index: 404 Not Found"))).toBe("network");
    });

    it("classifies browser automation failures", () => {
        expect(categoriseError(new Error("Playwright browser crashed"))).toBe("browser");
    });

    it("falls back to unknown for unmatched failures", () => {
        expect(categoriseError(new Error("Something odd happened"))).toBe("unknown");
    });
});

describe("createTelemetryClient", () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn().mockResolvedValue({ ok: true });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("posts encoded Matomo events for enabled interactive runs", async () => {
        const telemetryUrl = "https://example.com/telemetry";
        const client = createTelemetryClient({
            env: { AGENTMAN_TELEMETRY_URL: telemetryUrl, AGENTMAN_TELEMETRY_SITE_ID: "13" },
            fetchImpl: fetchMock as typeof fetch,
            stdinIsTTY: true,
            stdoutIsTTY: true,
            sessionId: "session1234567890",
            timeoutMs: 500,
        });

        const response = await client.send({
            action: "tool_selected",
            properties: { tool: "github-copilot", scope: "repo" },
        });

        expect(response).toEqual({ ok: true });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const [endpoint, options] = fetchMock.mock.calls[0];
        expect(endpoint).toBe(`${telemetryUrl}/matomo.php`);
        expect(options.method).toBe("POST");
        expect(options.headers).toEqual({ "content-type": "application/x-www-form-urlencoded" });

        const payload = new URLSearchParams(options.body as string);
        expect(payload.get("idsite")).toBe("13");
        expect(payload.get("e_c")).toBe("agent-manager");
        expect(payload.get("e_a")).toBe("tool_selected");
        expect(payload.get("e_n")).toBe("scope=repo;tool=github-copilot");
    });

    it("skips network calls when telemetry is disabled", async () => {
        const client = createTelemetryClient({
            env: { DO_NOT_TRACK: "1" },
            fetchImpl: fetchMock as typeof fetch,
            stdinIsTTY: true,
            stdoutIsTTY: true,
        });

        const response = await client.send({ action: "agentman_started" });

        expect(response).toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("swallows transport failures", async () => {
        const client = createTelemetryClient({
            env: { AGENTMAN_TELEMETRY_URL: "https://example.com/telemetry", AGENTMAN_TELEMETRY_SITE_ID: "13" },
            fetchImpl: vi.fn().mockRejectedValue(new Error("network down")) as typeof fetch,
            stdinIsTTY: true,
            stdoutIsTTY: true,
        });

        expect(() => client.track({ action: "agentman_started" })).not.toThrow();
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
});

describe("setTelemetryDisabledByConfig", () => {
    afterEach(() => {
        // Module-level flag — reset so it never leaks into the process-wide client.
        setTelemetryDisabledByConfig(false);
    });

    it("suppresses sends on an otherwise-enabled client, and env-based disable is independent", async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true });
        const client = createTelemetryClient({
            env: { AGENTMAN_TELEMETRY_URL: "https://example.com/telemetry", AGENTMAN_TELEMETRY_SITE_ID: "13" },
            fetchImpl: fetchMock as typeof fetch,
            stdinIsTTY: true,
            stdoutIsTTY: true,
        });

        expect(client.isEnabled()).toBe(true);
        await client.send({ action: "agentman_started" });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        setTelemetryDisabledByConfig(true);
        expect(client.isEnabled()).toBe(false);
        await client.send({ action: "agentman_started" });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        setTelemetryDisabledByConfig(false);
        expect(client.isEnabled()).toBe(true);
    });
});
