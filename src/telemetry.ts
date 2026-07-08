import { randomUUID } from "node:crypto";
import type { BundleSource } from "./bundle/source.js";
import type { DiscoveryTelemetry } from "./discovery/types.js";

const DEFAULT_TIMEOUT_MS = 1000;

export type TelemetryValue = string | number | boolean | null | undefined;

export interface TelemetryEvent {
    action: string;
    name?: string;
    properties?: Record<string, TelemetryValue>;
    value?: number;
}

export interface TelemetrySettings {
    enabled: boolean;
    endpoint: string;
    siteId: string;
    timeoutMs: number;
}

const LOCAL_DIRECTORY_BUNDLE_ENDPOINT = "local-directory";

interface TelemetryClientOptions {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
    stdinIsTTY?: boolean;
    stdoutIsTTY?: boolean;
    sessionId?: string;
    timeoutMs?: number;
}

function hasTruthyFlag(value: string | undefined): boolean {
    return /^(1|true|yes|on)$/i.test(value ?? "");
}

function stripTrailingSlashes(value: string): string {
    return value.trim().replace(/\/+$/, "");
}

export function getBundleEndpointTelemetryValue(baseUrl: string): string {
    return stripTrailingSlashes(baseUrl);
}

export function getBundleSourceTelemetryProperties(source: BundleSource): Record<string, TelemetryValue> {
    if (source.type === "url" || source.type === "discovery") {
        return {
            source: source.type,
            bundleEndpoint: getBundleEndpointTelemetryValue(source.baseUrl),
        };
    }

    return {
        source: source.type,
        bundleEndpoint: LOCAL_DIRECTORY_BUNDLE_ENDPOINT,
    };
}


function isCiEnvironment(env: NodeJS.ProcessEnv): boolean {
    return Boolean(
        env.CI || env.GITHUB_ACTIONS || env.BUILD_BUILDID || env.TF_BUILD || env.JENKINS_URL || env.TEAMCITY_VERSION,
    );
}

export function shouldDisableTelemetry(
    env: NodeJS.ProcessEnv = process.env,
    ttyState: { stdinIsTTY?: boolean; stdoutIsTTY?: boolean } = {
        stdinIsTTY: process.stdin.isTTY,
        stdoutIsTTY: process.stdout.isTTY,
    },
): boolean {
    if (
        hasTruthyFlag(env.DISABLE_TELEMETRY) ||
        hasTruthyFlag(env.DO_NOT_TRACK) ||
        hasTruthyFlag(env.AGENTMAN_TELEMETRY_DISABLED)
    ) {
        return true;
    }

    if (isCiEnvironment(env)) {
        return true;
    }

    if (ttyState.stdinIsTTY === false || ttyState.stdoutIsTTY === false) {
        return true;
    }

    return false;
}

export function buildTelemetryEndpoint(value: string): string {
    const trimmed = stripTrailingSlashes(value);
    if (trimmed.endsWith("/matomo.php")) {
        return trimmed;
    }

    return `${trimmed}/matomo.php`;
}

export function resolveTelemetrySettings(
    env: NodeJS.ProcessEnv = process.env,
    ttyState: { stdinIsTTY?: boolean; stdoutIsTTY?: boolean } = {
        stdinIsTTY: process.stdin.isTTY,
        stdoutIsTTY: process.stdout.isTTY,
    },
    discoveryTelemetry?: DiscoveryTelemetry,
): TelemetrySettings {
    // Env vars always take precedence over discovery config
    const rawUrl = env.AGENTMAN_TELEMETRY_URL ?? env.AGENTMAN_TELEMETRY_ENDPOINT ?? discoveryTelemetry?.url;
    const siteId = env.AGENTMAN_TELEMETRY_SITE_ID ?? discoveryTelemetry?.siteId;
    const timeoutMs = Number(env.AGENTMAN_TELEMETRY_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

    if (!rawUrl || !siteId || shouldDisableTelemetry(env, ttyState)) {
        return {
            enabled: false,
            endpoint: "",
            siteId: "",
            timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
        };
    }

    return {
        enabled: true,
        endpoint: buildTelemetryEndpoint(rawUrl),
        siteId,
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
    };
}

function sanitiseToken(value: string): string {
    return value
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^a-zA-Z0-9._:/=-]/g, "_")
        .slice(0, 80);
}

function buildEventLabel(name?: string, properties?: Record<string, TelemetryValue>): string | undefined {
    const parts: string[] = [];

    if (name) {
        parts.push(sanitiseToken(name));
    }

    if (properties) {
        for (const [key, value] of Object.entries(properties).sort(([left], [right]) => left.localeCompare(right))) {
            if (value === null || value === undefined) {
                continue;
            }

            parts.push(`${sanitiseToken(key)}=${sanitiseToken(String(value))}`);
        }
    }

    if (parts.length === 0) {
        return undefined;
    }

    return parts.join(";").slice(0, 255);
}

export function categoriseError(error: unknown): string {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();

    if (message.includes("timeout")) {
        return "timeout";
    }

    if (message.includes("auth") || message.includes("login") || message.includes("unauthor")) {
        return "auth";
    }

    if (message.includes("playwright") || message.includes("browser")) {
        return "browser";
    }

    if (
        message.includes("fetch") ||
        message.includes("network") ||
        message.includes("econn") ||
        message.includes("enotfound") ||
        /\b\d{3}\b/.test(message)
    ) {
        return "network";
    }

    if (message.includes("eacces") || message.includes("permission")) {
        return "permission";
    }

    if (message.includes("enoent") || message.includes("file") || message.includes("directory")) {
        return "filesystem";
    }

    if (message.includes("invalid") || message.includes("validation")) {
        return "validation";
    }

    return "unknown";
}

export function createTelemetryClient(options: TelemetryClientOptions = {}) {
    const env = options.env ?? process.env;
    const settings = resolveTelemetrySettings(env, {
        stdinIsTTY: options.stdinIsTTY ?? process.stdin.isTTY,
        stdoutIsTTY: options.stdoutIsTTY ?? process.stdout.isTTY,
    });
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const sessionId = (options.sessionId ?? randomUUID()).replace(/-/g, "").slice(0, 16);

    async function send(event: TelemetryEvent): Promise<Response | undefined> {
        if (!settings.enabled) {
            return;
        }

        const payload = new URLSearchParams({
            idsite: settings.siteId,
            rec: "1",
            apiv: "1",
            rand: `${Date.now()}`,
            cid: sessionId,
            e_c: "agent-manager",
            e_a: sanitiseToken(event.action),
        });

        const label = buildEventLabel(event.name, event.properties);
        if (label) {
            payload.set("e_n", label);
        }

        if (typeof event.value === "number" && Number.isFinite(event.value)) {
            payload.set("e_v", `${event.value}`);
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? settings.timeoutMs);

        try {
            return await fetchImpl(settings.endpoint, {
                method: "POST",
                headers: { "content-type": "application/x-www-form-urlencoded" },
                body: payload.toString(),
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timeout);
        }
    }

    return {
        isEnabled(): boolean {
            return settings.enabled;
        },
        send(event: TelemetryEvent): Promise<Response | undefined> {
            return send(event);
        },
        track(event: TelemetryEvent): void {
            void send(event).catch(() => {
                // Telemetry must never block or fail the CLI.
            });
        },
    };
}

const telemetryClient = createTelemetryClient();

export function trackTelemetryEvent(event: TelemetryEvent): void {
    telemetryClient.track(event);
}

export function trackTelemetryError(action: string, error: unknown, properties?: Record<string, TelemetryValue>): void {
    telemetryClient.track({
        action,
        properties: {
            ...properties,
            errorCategory: categoriseError(error),
        },
    });
}
